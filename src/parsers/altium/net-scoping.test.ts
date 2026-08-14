import { describe, it, expect } from "vitest";
import {
  isSheetBound,
  planLocalNetRenames,
  applyNetRenames,
  noNetIdentifiers,
} from "./net-scoping.js";
import type { NetIdentifierKinds, SheetNetScope } from "./net-scoping.js";
import type { ParsedNetlist } from "../../types.js";

const kinds = (over: Partial<NetIdentifierKinds> = {}): NetIdentifierKinds => ({
  ...noNetIdentifiers(),
  ...over,
});

/** A sheet drawing the given nets, each with the identifiers named. */
const sheet = (
  sheetNumber: string | undefined,
  nets: Record<string, Partial<NetIdentifierKinds>>
): SheetNetScope => ({
  sheetNumber,
  netIdentifiers: new Map(Object.entries(nets).map(([name, k]) => [name, kinds(k)])),
});

describe("isSheetBound", () => {
  it("lets a port or sheet entry carry a net off its sheet under every scope", () => {
    for (const scope of ["global", "flat", "hierarchical", "strict-hierarchical"] as const) {
      expect(isSheetBound(kinds({ portOrEntry: true }), scope)).toBe(false);
    }
  });

  it("keeps a net named only by a label on its sheet unless the scope is Global", () => {
    expect(isSheetBound(kinds({ label: true }), "hierarchical")).toBe(true);
    expect(isSheetBound(kinds({ label: true }), "flat")).toBe(true);
    expect(isSheetBound(kinds({ label: true }), "strict-hierarchical")).toBe(true);
    expect(isSheetBound(kinds({ label: true }), "global")).toBe(false);
  });

  it("treats a power port as global everywhere but Strict Hierarchical", () => {
    expect(isSheetBound(kinds({ powerPort: true }), "hierarchical")).toBe(false);
    expect(isSheetBound(kinds({ powerPort: true }), "strict-hierarchical")).toBe(true);
  });

  it("leaves a harness member alone, since it is matched across sheets by key", () => {
    expect(isSheetBound(kinds({ harness: true }), "hierarchical")).toBe(false);
  });

  it("treats a net with no identifier at all, named from a pin, as its sheet's own", () => {
    expect(isSheetBound(noNetIdentifiers(), "hierarchical")).toBe(true);
  });
});

describe("planLocalNetRenames", () => {
  it("takes apart a local name two sheets both claim", () => {
    const plans = planLocalNetRenames(
      [sheet("1", { SCL: { label: true } }), sheet("2", { SCL: { label: true } })],
      "hierarchical"
    );
    expect(plans[0].get("SCL")).toBe("SCL_1");
    expect(plans[1].get("SCL")).toBe("SCL_2");
  });

  it("numbers a sheet's own net even where no other sheet reuses the name", () => {
    // Altium suffixes because the net is the sheet's own, not because it
    // collides: the MiSKo3 board carries `VBAT_8` for a label drawn on sheet 8
    // alone.
    const plans = planLocalNetRenames(
      [sheet("8", { VBAT: { label: true } }), sheet("2", { SDA: { label: true } })],
      "hierarchical"
    );
    expect(plans[0].get("VBAT")).toBe("VBAT_8");
    expect(plans[1].get("SDA")).toBe("SDA_2");
  });

  it("leaves a net named after one of its own pins alone, being unique already", () => {
    const plans = planLocalNetRenames([sheet("3", { NetC3_1: {} })], "hierarchical");
    expect(plans[0].size).toBe(0);
  });

  it("leaves a name shared through ports alone, because it is one net", () => {
    const plans = planLocalNetRenames(
      [
        sheet("1", { RESET: { label: true, portOrEntry: true } }),
        sheet("2", { RESET: { label: true, portOrEntry: true } }),
      ],
      "hierarchical"
    );
    expect(plans[0].size).toBe(0);
    expect(plans[1].size).toBe(0);
  });

  it("leaves labels alone under Global, where they do reach across sheets", () => {
    const plans = planLocalNetRenames(
      [sheet("1", { SCL: { label: true } }), sheet("2", { SCL: { label: true } })],
      "global"
    );
    expect(plans[0].size).toBe(0);
    expect(plans[1].size).toBe(0);
  });

  it("splits a power net under Strict Hierarchical, where power ports are local too", () => {
    const plans = planLocalNetRenames(
      [sheet("1", { GND: { powerPort: true } }), sheet("2", { GND: { powerPort: true } })],
      "strict-hierarchical"
    );
    expect(plans[0].get("GND")).toBe("GND_1");
    expect(plans[1].get("GND")).toBe("GND_2");
  });

  it("leaves an unnumbered sheet's nets alone, having nothing to suffix with", () => {
    const plans = planLocalNetRenames(
      [sheet(undefined, { SCL: { label: true } }), sheet("2", { SCL: { label: true } })],
      "hierarchical"
    );
    expect(plans[0].size).toBe(0);
    expect(plans[1].get("SCL")).toBe("SCL_2");
  });

  it("does not fold a renamed net into a net the sheet already calls by that name", () => {
    // Sheet 2 draws both `SCL` and, separately, a net actually named `SCL_2`.
    // Renaming the first onto the second would invent a connection.
    const plans = planLocalNetRenames(
      [
        sheet("1", { SCL: { label: true } }),
        sheet("2", { SCL: { label: true }, SCL_2: { label: true } }),
      ],
      "hierarchical"
    );
    expect(plans[0].get("SCL")).toBe("SCL_1");
    expect(plans[1].has("SCL")).toBe(false);
  });

  it("counts three sheets claiming one name and numbers each by its own sheet", () => {
    const plans = planLocalNetRenames(
      [
        sheet("3", { I3C1_SCL: { label: true } }),
        sheet("4", { I3C1_SCL: { label: true } }),
        sheet("7", { I3C1_SCL: { label: true } }),
      ],
      "hierarchical"
    );
    expect(plans.map((p) => p.get("I3C1_SCL"))).toEqual([
      "I3C1_SCL_3",
      "I3C1_SCL_4",
      "I3C1_SCL_7",
    ]);
  });
});

describe("applyNetRenames", () => {
  const netlist = (): ParsedNetlist => ({
    nets: { SCL: { U2: ["14"], R11: ["1"] }, SDA: { U2: ["15"] } },
    components: {
      U2: { pins: { "14": { name: "SCL", net: "SCL" }, "15": { name: "SDA", net: "SDA" } } },
      R11: { pins: { "1": { name: "1", net: "SCL" } } },
    },
  });

  it("renames the net and every pin that referenced it", () => {
    const parsed = netlist();
    applyNetRenames(parsed, new Map([["SCL", "SCL_3"]]));

    expect(parsed.nets.SCL).toBeUndefined();
    expect(parsed.nets.SCL_3).toEqual({ U2: ["14"], R11: ["1"] });
    expect(parsed.components.U2.pins["14"]).toEqual({ name: "SCL", net: "SCL_3" });
    expect(parsed.components.R11.pins["1"]).toEqual({ name: "1", net: "SCL_3" });
  });

  it("leaves nets it was not asked about untouched", () => {
    const parsed = netlist();
    applyNetRenames(parsed, new Map([["SCL", "SCL_3"]]));

    expect(parsed.nets.SDA).toEqual({ U2: ["15"] });
    expect(parsed.components.U2.pins["15"]).toEqual({ name: "SDA", net: "SDA" });
  });

  it("does nothing when there is nothing to rename", () => {
    const parsed = netlist();
    applyNetRenames(parsed, new Map());
    expect(parsed).toEqual(netlist());
  });
});

describe("planLocalNetRenames collision guard", () => {
  it("leaves the name alone when another sheet already draws the suffixed net", () => {
    // Sheet 5 draws a net genuinely named `SCL_1`. Renaming sheet 1's local
    // `SCL` to `SCL_1` would merge into it once the sheets are merged by name.
    const plans = planLocalNetRenames(
      [
        sheet("1", { SCL: { label: true } }),
        sheet("2", { SCL: { label: true } }),
        sheet("5", { SCL_1: { label: true, portOrEntry: true } }),
      ],
      "hierarchical"
    );
    expect(plans[0].has("SCL")).toBe(false);
    expect(plans[1].get("SCL")).toBe("SCL_2");
  });
});
