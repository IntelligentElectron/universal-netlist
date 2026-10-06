/**
 * Net names with leading or trailing whitespace, end to end (issue #235).
 *
 * No public design has one, so this builds one from a real file: a copy of the
 * multio fixture with two of its net names rewritten in place. Every
 * length-prefixed occurrence of the name is replaced by text of the same
 * length, so the file's structure, wiring and pins are untouched:
 *
 * - `SCL` becomes `"SC "`, a trailing space with no trimmed sibling: the case
 *   the issue reports, where the netlister writes `SC`.
 * - `RSTN` becomes `" SDA"`, a leading space on a net that reads the same as
 *   the design's own `SDA` once trimmed: two separate nets the netlister has
 *   to rename apart.
 *
 * Every tool then runs through the real Cadence handler on the copy.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fixturePath, hasFixtures } from "../../../test/utils.js";
import { isErrorResult, type NetNameWarning } from "../../types.js";
import { listNets } from "./list-nets.js";
import { searchNets } from "./search-nets.js";
import { queryComponent } from "./query-component.js";
import { queryXnetByNetName, queryXnetByPinName } from "./query-xnet.js";
import { runErc } from "./run-erc.js";
import { parseDsnFile } from "../../parsers/cadence/dsn/dsn-parser.js";

const MULTIO = fixturePath("cadence", "multio", "MULTIO.DSN");
const hasMultio = hasFixtures && existsSync(MULTIO);

/** Rewrite every length-prefixed, NUL-terminated occurrence of a name. */
function renameInPlace(buffer: Buffer, from: string, to: string): number {
  expect(to.length).toBe(from.length);
  const encode = (s: string) =>
    Buffer.concat([Buffer.from([s.length, 0]), Buffer.from(s + "\0", "latin1")]);
  const needle = encode(from);
  const replacement = encode(to);
  let count = 0;
  for (let i = buffer.indexOf(needle); i >= 0; i = buffer.indexOf(needle, i + 1)) {
    replacement.copy(buffer, i);
    count++;
  }
  return count;
}

const ok = <T>(result: T): Exclude<T, { error: string }> => {
  if (isErrorResult(result)) throw new Error(result.error);
  return result as Exclude<T, { error: string }>;
};

const warningOf = (warnings: NetNameWarning[] | undefined, net: string) =>
  warnings?.find((w) => w.net === net);

describe.skipIf(!hasMultio)("net names with leading or trailing whitespace", () => {
  let dir: string;
  let design: string;
  const original = hasMultio ? parseDsnFile(MULTIO) : undefined;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "net-name-warnings-"));
    design = join(dir, "MULTIO.DSN");
    copyFileSync(MULTIO, design);
    const bytes = readFileSync(design);
    expect(renameInPlace(bytes, "SCL", "SC ")).toBe(16);
    expect(renameInPlace(bytes, "RSTN", " SDA")).toBe(3);
    writeFileSync(design, bytes);
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("keeps each renamed net's pins and reports it under the schematic's text", () => {
    const parsed = parseDsnFile(design);
    expect(parsed.nets["SC "]).toEqual(original!.nets["SCL"]);
    expect(parsed.nets[" SDA"]).toEqual(original!.nets["RSTN"]);
    expect(parsed.nets["SDA"]).toEqual(original!.nets["SDA"]);
    expect(parsed.nets["SC"]).toBeUndefined();
  });

  it("records the objects that name a padded net, on both pages", () => {
    const sources = parseDsnFile(design).netLabelSources!["SC "];
    expect(new Set(sources.map((s) => s.page))).toEqual(new Set(["P1: PI ", "P2: I/O"]));
    expect(sources.some((s) => s.kind === "net_alias")).toBe(true);
    for (const s of sources) {
      expect(Number.isInteger(s.x) && Number.isInteger(s.y)).toBe(true);
    }
  });

  it("list_nets warns on every padded net", async () => {
    const result = ok(await listNets(design));
    expect(result.nets).toEqual(expect.arrayContaining(["SC ", " SDA", "SDA"]));
    expect(result.net_name_warnings?.map((w) => w.net)).toEqual([" SDA", "SC "]);
    expect(warningOf(result.net_name_warnings, "SC ")).toMatchObject({
      netlist_name: "SC",
      problem: "trailing_whitespace",
    });
    expect(warningOf(result.net_name_warnings, " SDA")).toMatchObject({
      problem: "leading_whitespace",
      same_name_after_trim: ["SDA"],
    });
    expect(warningOf(result.net_name_warnings, " SDA")?.netlist_name).toBeUndefined();
  });

  it("search_nets finds a padded net with an anchored pattern", async () => {
    const result = ok(await searchNets("^SC$", design));
    expect(result.results["MULTIO"]).toEqual(["SC "]);
    expect(warningOf(result.net_name_warnings, "SC ")?.netlist_name).toBe("SC");
  });

  it("query_component warns on the pin's padded net", async () => {
    const pin = Object.entries(original!.nets["SCL"])[0];
    const result = ok(await queryComponent(design, pin[0]));
    expect(warningOf(result.net_name_warnings, "SC ")?.sources?.length).toBeGreaterThan(0);
  });

  it("query_xnet_by_net_name finds the net by the name the netlister writes", async () => {
    const result = ok(await queryXnetByNetName(design, "SC"));
    // starting_point keeps the name asked for; net names the net it matched.
    expect(result.starting_point).toBe("SC");
    expect(result.net).toBe("SC ");
    expect(result.notes?.[0]).toContain("differs from it only by whitespace");
    expect(warningOf(result.net_name_warnings, "SC ")?.netlist_name).toBe("SC");
    const exact = ok(await queryXnetByNetName(design, "SC "));
    expect(exact.circuit_hash).toBe(result.circuit_hash);
    expect(exact.notes).toBeUndefined();
  });

  it("query_xnet_by_net_name keeps an exact name on its own net", async () => {
    // The traversal itself may reach " SDA": both nets pull up through 2K7
    // resistors to V_POW, which is traversed like a signal. The query starts
    // on SDA, matched exactly.
    const result = ok(await queryXnetByNetName(design, "SDA"));
    expect(result.starting_point).toBe("SDA");
    expect(result.net).toBeUndefined();
    expect(result.notes).toBeUndefined();
  });

  it("query_xnet_by_net_name refuses a name that could mean two nets", async () => {
    const result = await queryXnetByNetName(design, "SDA ");
    expect(isErrorResult(result) && result.error).toContain('" SDA", "SDA"');
  });

  it("query_xnet_by_pin_name warns on the pin's padded net", async () => {
    const [refdes, pins] = Object.entries(original!.nets["SCL"])[0];
    const result = ok(await queryXnetByPinName(design, `${refdes}.${pins[0]}`));
    expect(result.net).toBe("SC ");
    expect(warningOf(result.net_name_warnings, "SC ")?.netlist_name).toBe("SC");
  });

  it("run_erc reports both padded nets and the collision", async () => {
    const result = ok(await runErc(design));
    const padded = result.warnings?.["net.whitespace_in_name"] as Record<string, string[]>;
    expect(Object.keys(padded)).toEqual([" SDA", "SC "]);
    expect(padded["SC "]).toHaveLength(Object.values(original!.nets["SCL"]).flat().length);
    const collision = result.errors?.["net.whitespace_name_collision"] as Record<string, string[]>;
    expect(Object.keys(collision)).toEqual([" SDA", "SDA"]);
  });

  it("finds nothing on the unmodified design", async () => {
    const erc = ok(await runErc(MULTIO));
    expect(erc.warnings?.["net.whitespace_in_name"]).toBeUndefined();
    expect(erc.errors?.["net.whitespace_name_collision"]).toBeUndefined();
    expect(ok(await listNets(MULTIO)).net_name_warnings).toBeUndefined();
    expect(parseDsnFile(MULTIO).netLabelSources).toBeUndefined();
  });
});

const J202 = fixturePath(
  "cadence",
  "OSHW-Jetson-Series",
  "reComputer Jetson carrier board",
  "reComputer J202",
  "Schematic",
  "reComputer J202_V1.0.DSN"
);

describe.skipIf(!(hasFixtures && existsSync(J202)))("net names with inner spaces", () => {
  // Its Allegro export writes `TYPE C_USB_DP` and its siblings unchanged, so a
  // space inside a name is no rename and needs no warning.
  it("are neither warned about nor flagged by ERC", { timeout: 30_000 }, async () => {
    const nets = ok(await listNets(J202));
    expect(nets.nets).toContain("TYPE C_USB_DP");
    expect(nets.net_name_warnings).toBeUndefined();
    const erc = ok(await runErc(J202));
    expect(erc.warnings?.["net.whitespace_in_name"]).toBeUndefined();
    expect(erc.errors?.["net.whitespace_name_collision"]).toBeUndefined();
  });
});

const AAFM = fixturePath("cadence", "parallella-aafm", "HB1A-AAFM.DSN");

describe.skipIf(!(hasFixtures && existsSync(AAFM)))(
  "a padded label inside a placed block",
  { timeout: 60_000 },
  () => {
    // aafm draws the DSP block once and places it four times. Its local net
    // MVDD is reported once per placement, as `MVDD_QUAD ANEMONE_DSP LL` and so
    // on. Rewriting the label to "MVD " puts the whitespace inside each reported
    // name, ahead of the placement suffix: "MVD _QUAD ANEMONE_DSP LL".
    let dir: string;
    let design: string;
    const original = hasFixtures && existsSync(AAFM) ? parseDsnFile(AAFM) : undefined;
    const placements = Object.keys(original?.nets ?? {}).filter((n) => n.startsWith("MVDD_"));
    const padded = placements.map((n) => "MVD " + n.slice("MVDD".length));

    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), "net-name-block-"));
      design = join(dir, "HB1A-AAFM.DSN");
      copyFileSync(AAFM, design);
      const bytes = readFileSync(design);
      expect(renameInPlace(bytes, "MVDD", "MVD ")).toBe(8);
      writeFileSync(design, bytes);
    });

    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it("keeps each placement's net and records the label on the block page", () => {
      expect(placements).toHaveLength(4);
      const parsed = parseDsnFile(design);
      placements.forEach((name, i) => {
        expect(parsed.nets[padded[i]]).toEqual(original!.nets[name]);
        const sources = parsed.netLabelSources?.[padded[i]];
        expect(sources?.length).toBeGreaterThan(0);
        for (const s of sources!) {
          expect(s.text).toBe("MVD ");
          expect(s.page).toContain("(");
        }
      });
    });

    it("warns on every placement's net, finds it without the whitespace, and flags it in ERC", async () => {
      const nets = ok(await listNets(design));
      for (const name of padded) {
        expect(warningOf(nets.net_name_warnings, name)).toMatchObject({
          problem: "whitespace_before_block_suffix",
        });
        expect(warningOf(nets.net_name_warnings, name)?.netlist_name).toBeUndefined();
      }

      const lookup = ok(await queryXnetByNetName(design, padded[0].replace("MVD ", "MVD")));
      expect(lookup.net).toBe(padded[0]);

      const erc = ok(await runErc(design, { includeRules: ["net.whitespace_in_name"] }));
      const flagged = erc.warnings?.["net.whitespace_in_name"] as Record<string, string[]>;
      expect(Object.keys(flagged).sort()).toEqual([...padded].sort());
    });
  }
);
