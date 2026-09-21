/**
 * Hierarchical designs end to end: a block drawn once and placed several
 * times reports one component per placement, wired into the parent.
 *
 * Two fixtures: one places ten blocks at a single level and ships the BOM its
 * refdes were checked against, the other nests a block placed four times
 * inside a block. Expected values come from the designs' own Hierarchy
 * streams and BOMs, not from an earlier run of this parser.
 */

import { describe, expect, it } from "vitest";
import { existsSync } from "fs";
import { join } from "path";
import { parseDsnFile } from "./dsn-parser.js";
import { DsnReader } from "./dsn-reader.js";
import { parseHierarchyStream, walkBlockOccurrences } from "./hierarchy-parser.js";
import { fixturePath, hasFixtures } from "../../../../test/utils.js";

const CARRIER = join(
  fixturePath("cadence", "parallella-meta-carrier"),
  "meta_carrier_sch_rev1.dsn"
);
const MODULE = join(fixturePath("cadence", "parallella-aafm"), "HB1A-AAFM.DSN");

const hasCarrier = hasFixtures && existsSync(CARRIER);
const hasModule = hasFixtures && existsSync(MODULE);

function readTree(dsnPath: string) {
  const ole = new DsnReader(dsnPath);
  const entry = ole.listAllEntries().find((e) => /Hierarchy\/Hierarchy$/.test(e.path))!;
  return parseHierarchyStream(ole.readStreamByPath(entry.path));
}

describe.skipIf(!hasCarrier)("hierarchical design with blocks placed at one level", () => {
  const netlist = parseDsnFile(CARRIER);
  const tree = readTree(CARRIER);

  it("reports every component the released BOM lists, once per placement", () => {
    // 451 references on the BOM; ten of the parts are drawn once each inside
    // a block and placed two or four times.
    expect(Object.keys(netlist.components)).toHaveLength(451);
  });

  it("reports each occurrence of a part drawn once under the refdes its placement annotates", () => {
    const placements = [...walkBlockOccurrences(tree.scope)].filter(
      (b) => b.schematic === "TILE_TPS65400"
    );
    expect(placements).toHaveLength(4);

    // The same instance, one refdes per placement.
    const first = placements.map((b) => b.scope.parts[0]);
    expect(new Set(first.map((p) => p.dbId)).size).toBe(1);
    const refdes = first.map((p) => p.reference);
    expect(new Set(refdes).size).toBe(4);
    for (const ref of refdes) expect(netlist.components[ref]).toBeDefined();
  });

  it("joins a placement's hierarchical port to the parent page's net", () => {
    // A clock-control net leaves two connectors on the top level and enters
    // both placements of the clock tile through the same port.
    expect(netlist.nets.CLKPDB).toMatchObject({
      J14: ["9"],
      R114: ["1"],
      U7: ["15"],
      U10: ["15"],
    });
  });

  it("keeps a placement's local nets apart from the other placements'", () => {
    const local = Object.keys(netlist.nets).filter((n) => n.endsWith("_CLOCK0"));
    const twin = Object.keys(netlist.nets).filter((n) => n.endsWith("_CLOCK1"));
    expect(local.length).toBeGreaterThan(0);
    expect(local.map((n) => n.replace(/_CLOCK0$/, "_CLOCK1")).sort()).toEqual(twin.sort());
  });

  it("keeps a power net one net across the whole design", () => {
    const suffixed = Object.keys(netlist.nets).filter((n) => /^GND_/.test(n));
    expect(suffixed).toEqual([]);
    expect(Object.keys(netlist.nets.GND).length).toBeGreaterThan(200);
  });
});

describe.skipIf(!hasModule)("hierarchical design with a block nested in a block", () => {
  const netlist = parseDsnFile(MODULE);
  const tree = readTree(MODULE);

  it("expands the inner block once per placement of the outer one", () => {
    const outer = [...walkBlockOccurrences(tree.scope)].filter(
      (b) => b.schematic === "ANEMONE-TOP"
    );
    expect(outer).toHaveLength(1);
    const inner = outer[0].scope.blocks;
    expect(inner).toHaveLength(4);

    for (const placement of inner) {
      const annotated = placement.scope.parts.find((p) => p.reference !== "");
      expect(annotated).toBeDefined();
      expect(netlist.components[annotated!.reference]).toBeDefined();
    }
    expect(Object.keys(netlist.components)).toHaveLength(611);
  });

  it("names a nested placement's local nets by the whole instance path", () => {
    const nested = Object.keys(netlist.nets).filter((n) => n.endsWith("_QUAD ANEMONE_DSP LL"));
    expect(nested.length).toBeGreaterThan(0);
    for (const corner of ["DSP LR", "DSP UL", "DSP UR"]) {
      const twin = Object.keys(netlist.nets).filter((n) => n.endsWith(`_QUAD ANEMONE_${corner}`));
      expect(twin).toHaveLength(nested.length);
    }
  });
});
