import { describe, it, expect } from "vitest";
import {
  duplicateInstanceIndices,
  instanceDesignator,
  instanceDisplayMode,
  instancePartId,
  pinBelongsToInstance,
} from "./part-pins.js";
import { altiumHandler, parseAltium } from "./index.js";
import { discoverAltiumDesigns } from "./discovery.js";
import { validateUniversalNetlist } from "../universal/reader.js";
import type { PinEntry } from "../../types.js";
import type { AltiumRecord, AltiumSchematic } from "./types.js";
import { fixturePath, hasFixtures } from "../../../test/utils.js";

const part = (
  index: number,
  designator: string,
  fields: Record<string, unknown> = {}
): AltiumRecord => ({
  index,
  RECORD: "1",
  ...fields,
  children: [{ index: index + 1, RECORD: "34", OwnerIndex: String(index), Text: designator }],
});

const schematic = (...parts: AltiumRecord[]): AltiumSchematic => ({ header: [], records: parts });

const netOf = (entry: PinEntry): string => (typeof entry === "string" ? entry : entry.net);

describe("pinBelongsToInstance", () => {
  it("keeps a pin of the drawn part and the default display mode", () => {
    const instance = part(0, "U1", { CURRENTPARTID: "2" });
    expect(pinBelongsToInstance({ index: 5, RECORD: "2", OwnerPartId: "2" }, instance)).toBe(true);
    expect(
      pinBelongsToInstance(
        { index: 5, RECORD: "2", OwnerPartId: "2", OwnerPartDisplayMode: "0" },
        instance
      )
    ).toBe(true);
  });

  it("drops a pin of another part", () => {
    const instance = part(0, "U1", { CURRENTPARTID: "2" });
    expect(pinBelongsToInstance({ index: 5, RECORD: "2", OwnerPartId: "1" }, instance)).toBe(false);
  });

  it("keeps a pin when either side says nothing about the part", () => {
    expect(
      pinBelongsToInstance({ index: 5, RECORD: "2" }, part(0, "R1", { CURRENTPARTID: "1" }))
    ).toBe(true);
    expect(pinBelongsToInstance({ index: 5, RECORD: "2", OwnerPartId: "1" }, part(0, "R1"))).toBe(
      true
    );
  });

  it("drops a pin of a display mode the instance does not draw", () => {
    const drawnInDefault = part(0, "P1");
    expect(
      pinBelongsToInstance({ index: 5, RECORD: "2", OwnerPartDisplayMode: "1" }, drawnInDefault)
    ).toBe(false);

    const drawnInAlternate = part(0, "P1", { DISPLAYMODE: "1" });
    expect(
      pinBelongsToInstance({ index: 5, RECORD: "2", OwnerPartDisplayMode: "1" }, drawnInAlternate)
    ).toBe(true);
    expect(pinBelongsToInstance({ index: 5, RECORD: "2" }, drawnInAlternate)).toBe(false);
  });

  it("reads both spellings of the fields", () => {
    const instance = part(0, "U1", { CurrentPartId: "1", DisplayMode: "1" });
    expect(instancePartId(instance)).toBe("1");
    expect(instanceDisplayMode(instance)).toBe("1");
    expect(
      pinBelongsToInstance(
        { index: 5, RECORD: "2", OWNERPARTID: "1", OWNERPARTDISPLAYMODE: "1" },
        instance
      )
    ).toBe(true);
  });
});

describe("duplicateInstanceIndices", () => {
  it("marks a second instance of the same designator and part, not the first", () => {
    const first = part(0, "J1");
    const second = part(10, "J1");
    expect(duplicateInstanceIndices(schematic(first, second))).toEqual(new Set([10]));
  });

  it("does not mark the parts of a multi-part component", () => {
    const a = part(0, "U1", { CURRENTPARTID: "1" });
    const b = part(10, "U1", { CURRENTPARTID: "2" });
    expect(duplicateInstanceIndices(schematic(a, b))).toEqual(new Set());
  });

  it("marks a repeated part of a multi-part component", () => {
    const a = part(0, "U1", { CURRENTPARTID: "1" });
    const b = part(10, "U1", { CURRENTPARTID: "1" });
    const c = part(20, "U1", { CURRENTPARTID: "2" });
    expect(duplicateInstanceIndices(schematic(a, b, c))).toEqual(new Set([10]));
  });

  it("ignores instances with no designator", () => {
    const anonymous: AltiumRecord = { index: 0, RECORD: "1", children: [] };
    expect(instanceDesignator(anonymous)).toBeUndefined();
    expect(duplicateInstanceIndices(schematic(anonymous, { index: 5, RECORD: "1" }))).toEqual(
      new Set()
    );
  });
});

/**
 * The invariant every tool depends on: `nets` and `components` are exact
 * inverses. The Universal Netlist reader checks that, so every Altium fixture
 * must pass it, sheet by sheet and as a project.
 */
describe.skipIf(!hasFixtures)("every Altium fixture parses into a consistent netlist", () => {
  it("as a project", async () => {
    const designs = await discoverAltiumDesigns(fixturePath("altium"));
    expect(designs.length).toBeGreaterThan(0);
    for (const design of designs) {
      const netlist = await altiumHandler.parse(design.sourcePath);
      expect(() => validateUniversalNetlist(netlist, design.name)).not.toThrow();
    }
  }, 120_000);
});

describe.skipIf(!hasFixtures)("display modes and duplicate designators on real sheets", () => {
  const pca = (sheet: string) =>
    fixturePath(
      "altium",
      "nRF52840-Development-Kit",
      "PCA10056-nRF52840 Development Board 3_0_3",
      "Altium Designer files",
      sheet
    );

  it("a header drawn in its default mode does not connect through its alternate mode's pins", async () => {
    // P13 has two display modes. The alternate mode's pins sat on the GND
    // rail and used to put pins 2, 4, 6 and 8 on GND as well as their nets.
    const netlist = await parseAltium(pca("pca10056_sheet5_connectors.SchDoc"));
    const p13 = netlist.components.P13.pins;
    expect(netOf(p13["2"])).toBe("VIO");
    expect(netOf(p13["4"])).toBe("VIO");
    expect(netOf(p13["6"])).toBe("RESET_PIN");
    expect(netOf(p13["8"])).toBe("VIO");
    for (const [pin, entry] of Object.entries(p13)) {
      const listing = Object.entries(netlist.nets).filter(([, m]) => m.P13?.includes(pin));
      expect(
        listing.map(([n]) => n),
        `P13.${pin}`
      ).toEqual([netOf(entry)]);
    }
  });

  it("a capacitor whose alternate mode swaps its pins is read in the drawn mode", async () => {
    const netlist = await parseAltium(
      fixturePath(
        "altium",
        "heron-hardware",
        "Microphone-Boards",
        "Microphone-Boards_V1.0_GMA3526H10.SchDoc"
      )
    );
    expect(netOf(netlist.components.C4.pins["1"])).toBe("GND");
    expect(netOf(netlist.components.C4.pins["2"])).toBe("3V3");
  });

  it("a multi-part component drawn on two sheets declares every part's pins once", async () => {
    const netlist = await altiumHandler.parse(
      fixturePath(
        "altium",
        "nRF52840-Development-Kit",
        "PCA10056-nRF52840 Development Board 3_0_3",
        "Altium Designer files",
        "pca10056.PrjPCB"
      )
    );
    const u19 = netlist.components.U19.pins;
    expect(Object.keys(u19).sort()).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
    expect(netOf(u19["4"])).toBe("GND");
    expect(netOf(u19["8"])).toBe("V5V");
  });

  it("a duplicate designator keeps the first instance and ignores the rest", async () => {
    // REAR_LOOM_CONN is drawn twice on one sheet; PDM_CAN_CONN twice on
    // another. One part cannot have one pin on two nets.
    const bulkhead = await parseAltium(
      fixturePath("altium", "qfsae-harness", "q23-harness", "REAR_LOOM_BULKHEAD.SchDoc")
    );
    const pin23 = netOf(bulkhead.components.REAR_LOOM_CONN.pins["23"]);
    const listing = Object.entries(bulkhead.nets).filter(([, m]) =>
      m.REAR_LOOM_CONN?.includes("23")
    );
    expect(listing.map(([n]) => n)).toEqual([pin23]);

    const pdm = await parseAltium(
      fixturePath("altium", "qfsae-harness", "q23-harness", "PDM.SchDoc")
    );
    expect(Object.values(pdm.components.PDM_CAN_CONN.pins).map(netOf)).toEqual([
      "PDM_CAN_P",
      "PDM_CAN_N",
    ]);
  });
});
