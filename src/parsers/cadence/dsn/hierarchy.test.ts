/**
 * Hierarchical designs end to end: a block drawn once and placed several
 * times reports one component per placement, wired into the parent.
 *
 * Three fixtures: one places ten blocks at a single level and ships the BOM its
 * refdes were checked against, one nests a block placed four times inside a
 * block, and one nests three deep and is annotated by occurrence. Expected
 * values come from the designs' own Hierarchy streams, BOMs and, for the last,
 * the Allegro netlist its upstream ships, not from an earlier run of this parser.
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
const SENSOR = join(fixturePath("cadence", "pintowin-sensor-board"), "SENSOR_BOARD.DSN");

const hasCarrier = hasFixtures && existsSync(CARRIER);
const hasModule = hasFixtures && existsSync(MODULE);
const hasSensor = hasFixtures && existsSync(SENSOR);

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

  it("joins a bus port's member to the parent's member of the bus wired to the block", () => {
    // The east link's clock bus enters the link block as `LCLK_IN_N[3:0]` from
    // the top level's `EA_LCLK_IN_N[3:0]`; member 2 reaches the host
    // connector on the top level and the two link connectors inside the block.
    expect(netlist.nets.EA_LCLK_IN_N2).toEqual({ P1: ["K26"], J6: ["119"], J4: ["119"] });
    // The west link's bus is not broken out on the top level, so its members
    // carry the top level's name with only the block's pins.
    expect(netlist.nets.WE_LCLK_IN_N2).toEqual({ J3: ["121"], J15: ["121"] });
    expect(Object.keys(netlist.nets).filter((n) => /^LCLK_IN_N\d_LINK4/.test(n))).toEqual([]);
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

  it("keeps a pin sitting on a port symbol with no wire on that placement's net", () => {
    // Each DSP's chip id pin sits on a port symbol inside the DSP block; each
    // corner's port reaches its own top-level net, on the CPLD.
    expect(netlist.nets.UL_XID3).toEqual({ U3: ["E7"], U9: ["54"] });
    expect(netlist.nets.UR_XID3).toEqual({ U4: ["E7"], U9: ["68"] });
    expect(netlist.nets.LL_XID3).toEqual({ U7: ["E7"], U9: ["82"] });
    expect(netlist.nets.LR_XID3).toEqual({ U8: ["E7"], U9: ["90"] });
    expect(netlist.nets.XID3).toBeUndefined();
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

describe.skipIf(!hasSensor)(
  "hierarchical design nested three deep, annotated by occurrence",
  () => {
    const netlist = parseDsnFile(SENSOR);
    const tree = readTree(SENSOR);

    it("reports every component the Allegro export lists, once per placement", () => {
      // 212 parts in the export: 88 diode-resistor pairs from one drawn sensor
      // unit, placed eight times in a column placed eleven times in the matrix.
      expect(Object.keys(netlist.components)).toHaveLength(212);
      const units = [...walkBlockOccurrences(tree.scope)].filter(
        (b) => b.schematic === "LDR-D-Unit"
      );
      expect(units).toHaveLength(88);
    });

    it("names the block path after the occurrences, whose drawings are unannotated", () => {
      // The drawings read `m?`, `col?` and `R-D?`; the occurrence tree names each
      // placement, and the export joins the path outermost first with `_`.
      const local = Object.keys(netlist.nets).filter((n) => n.startsWith("N00105_"));
      expect(local).toHaveLength(88);
      expect(new Set(local.map((n) => n.split("_").length))).toEqual(new Set([4]));
      expect(local.every((n) => /^N00105_M1_COL\d+_R-D\d+$/.test(n))).toBe(true);
      expect(Object.keys(netlist.nets).some((n) => n.includes("?"))).toBe(false);
    });

    it("follows a top-level net through three levels of ports to the parts", () => {
      // The export's own pin list for this net: the controller and a test pad
      // on the top level, and one resistor inside eight of the sensor units.
      expect(netlist.nets.COL_SELECT_8).toEqual({
        U1: ["15"],
        TP16: ["1"],
        R10: ["1"],
        R21: ["1"],
        R32: ["1"],
        R43: ["1"],
        R54: ["1"],
        R65: ["1"],
        R76: ["1"],
        R87: ["1"],
      });
    });
  }
);
