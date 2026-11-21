/**
 * Replays the golden decision tables in docs/decision-tables/dsn-net-assignment
 * against the code, one test per cell, so the tables and the code cannot drift:
 * which root views the hierarchy expander reads, and which section's pin map a
 * placed instance of a multi-section package resolves to, where a pin's net
 * comes from, and whether an ignored pin reaches a net.
 */
import path from "path";
import { describe, expect, it } from "vitest";
import { expandHierarchy } from "./hierarchy-expander.js";
import { buildNetConnectivity } from "./net-builder.js";
import { pinNetSource } from "./net-pins.js";
import { findPinMap } from "./pin-resolver.js";
import type { BlockOccurrence, HierarchyScope, HierarchyStream } from "./hierarchy-parser.js";
import type { PageData } from "./page-parser.js";
import type { PinMapData } from "./structure-types.js";
import type { DrawnInstance, PlacedInstance, T0x10, Wire } from "./structures.js";
import { cellName, readTable } from "../../../../test/helpers/decision-table.js";

const TABLES = path.resolve(__dirname, "../../../../docs/decision-tables/dsn-net-assignment");

const instance = (dbId: number, reference: string, sourcePackage = "R"): PlacedInstance => ({
  pkgName: `${sourcePackage}.Normal`,
  dbId,
  reference,
  sourcePackage,
  partValueIdx: 0,
  prefixProperties: [],
  locX: 0,
  locY: 0,
  symbolDisplayProps: [],
  t0x10s: [],
  sectionIndex: 0,
  box: { x1: 0, y1: 0, x2: 0, y2: 0 },
  rotation: 0,
  mirrored: false,
});

const drawn = (dbId: number): DrawnInstance => ({
  dbId,
  reference: `BLK${dbId}`,
  ports: [],
  pins: [],
  locX: 0,
  locY: 0,
  box: { x1: 0, y1: 0, x2: 0, y2: 0 },
});

const page = (name: string, drawnInstances: DrawnInstance[] = []): PageData => ({
  name,
  netTable: new Map(),
  sizeName: "A",
  widthInches: 11,
  heightInches: 8.5,
  busEntries: [],
  graphics: [],
  wires: [],
  placedInstances: [instance(1, name)],
  drawnInstances,
  ports: [],
  globals: [],
  offPageConnectors: [],
});

const scope = (blocks: BlockOccurrence[] = []): HierarchyScope => ({ nets: [], parts: [], blocks });

const places = (dbId: number, schematic: string): BlockOccurrence => ({
  occurrenceId: dbId,
  dbId,
  schematic,
  reference: "",
  scope: scope(),
});

describe("golden table: root-views", () => {
  const dims = ["named_root", "other_roots"];

  /**
   * One design per cell. `NAMED` is the root the Library stream names, `OTHER`
   * another unplaced root, and `STRAY` a sheet no tree reaches, which only a
   * flat read reports. A placement's page copy reports under its drawing's
   * page name, so `N1` is the named root's page however it is reached.
   */
  const design = (named: string, others: string) => {
    const pages = new Map<string, PageData[]>([["stray", [page("S1")]]]);
    const roots: HierarchyStream[] = [];
    const unplaced: string[] = [];
    if (named === "block") {
      // PLACER's tree places NAMED. With no other root, NAMED places PLACER
      // back, so neither is unplaced.
      pages.set("named", [page("N1", others === "0" ? [drawn(18)] : [])]);
      pages.set("placer", [page("P1", [drawn(17)])]);
      roots.push({
        schematic: "NAMED",
        scope: scope(others === "0" ? [places(18, "PLACER")] : []),
      });
      roots.push({ schematic: "PLACER", scope: scope([places(17, "NAMED")]) });
      if (others !== "0") unplaced.push("P1", "N1");
    } else if (named === "unplaced-root") {
      pages.set("named", [page("N1")]);
      roots.push({ schematic: "NAMED", scope: scope() });
    } else if (named === "no-pages") {
      roots.push({ schematic: "NAMED", scope: scope() });
    } else if (named === "no-hierarchy") {
      pages.set("named", [page("N1")]);
    }
    if (others === "1+") {
      pages.set("other", [page("O1")]);
      roots.push({ schematic: "OTHER", scope: scope() });
      unplaced.push("O1");
    }
    const all = [...pages.values()].flat().map((p) => p.name);
    return { pages, roots, rootSchematic: named === "none" ? undefined : "Named", unplaced, all };
  };

  for (const row of readTable(TABLES, "root-views").filter((r) => r.outcome !== "n/a")) {
    it(cellName(row, dims), () => {
      const { pages, roots, rootSchematic, unplaced, all } = design(
        row.named_root,
        row.other_roots
      );
      const expected = {
        "read the named root": ["N1"],
        "read every unplaced root": unplaced,
        "read every page as it is": all,
      }[row.outcome];
      expect(expected, `unknown outcome ${row.outcome}`).toBeDefined();

      const { pages: out } = expandHierarchy(roots, pages, [], rootSchematic);

      expect(out.map((p) => p.name).sort()).toEqual([...expected!].sort());
    });
  }
});

describe("golden table: section-pin-map", () => {
  const dims = ["unit_suffix", "section_index", "sections_listed_under", "a_map_under"];
  const SECTION_A = ["a"];
  const SECTION_B = ["b"];
  // `PKG_0` is the source package; `PKG` is its _N-stripped name.
  const nameOf = { source: "PKG_0", stripped: "PKG" } as Record<string, string>;
  const indexOf = { "in-range": 1, "out-of-range": 5, unknown: undefined } as Record<
    string,
    number | undefined
  >;

  for (const row of readTable(TABLES, "section-pin-map").filter((r) => r.outcome !== "n/a")) {
    it(cellName(row, dims), () => {
      const inst = instance(1, "U1", "PKG_0");
      const maps = new Map<string, (string | null)[]>();
      const unitRefs = new Map<string, string[]>();
      if (row.unit_suffix === "yes") {
        inst.pkgName = "PKG_0B.Normal";
        maps.set("PKG_0B", SECTION_B);
      }
      if (row.sections_listed_under !== "none") {
        const listed = nameOf[row.sections_listed_under];
        unitRefs.set(listed, ["A", "B"]);
        maps.set(listed + "B", SECTION_B);
      }
      if (row.a_map_under !== "none") maps.set(nameOf[row.a_map_under] + "A", SECTION_A);

      const expected = {
        "the section its suffix names": SECTION_B,
        "the section at its index": SECTION_B,
        "section A": SECTION_A,
        "no map": undefined,
      }[row.outcome];
      if (row.outcome !== "no map") {
        expect(expected, `unknown outcome ${row.outcome}`).toBeDefined();
      }

      expect(findPinMap(inst, maps, unitRefs, indexOf[row.section_index])).toEqual(expected);
    });
  }
});

describe("pin-net: where a pin's net comes from", () => {
  const dims = ["wire_id", "net_id", "net_at_point", "net_on_a_wire"] as const;
  const wireIdOf: Record<string, number> = { wire: 4242, zero: 0, sentinel: 0xffffffff };
  const sourceOf: Record<string, string> = {
    "the net at its point": "point",
    "the net a wire with its net id carries": "wire-net",
    "its own net shared with pins of the same net id": "net-id",
    "a pin-to-pin net named from the Hierarchy": "hierarchy",
    "no connect": "no-connect",
  };

  for (const row of readTable(TABLES, "pin-net").filter((r) => r.outcome !== "n/a")) {
    it(cellName(row, dims), () => {
      expect(sourceOf[row.outcome], `unknown outcome ${row.outcome}`).toBeDefined();
      const source = pinNetSource(
        wireIdOf[row.wire_id],
        row.net_id === "zero" ? 0 : 777,
        row.net_at_point === "yes",
        row.net_on_a_wire === "yes"
      );
      expect(source).toBe(sourceOf[row.outcome]);
    });
  }
});

describe("pin-ignore: whether an ignored pin reaches a net", () => {
  const dims = ["pin_ignored", "named_in_pack_short", "group_has_placed_pin"] as const;
  const pin = (pinIndex: number, x: number, wireId: number): T0x10 => ({
    pinIndex,
    pointX: x,
    pointY: 0,
    wireId,
    netId: 0,
    symbolDisplayProps: [],
  });
  const wire = (segmentId: number, x1: number, x2: number): Wire => ({
    id: segmentId,
    segmentId,
    startX: x1,
    startY: 0,
    endX: x2,
    endY: 0,
    aliases: [],
    bus: false,
    junctions: 0,
  });

  for (const row of readTable(TABLES, "pin-ignore").filter((r) => r.outcome !== "n/a")) {
    it(cellName(row, dims), () => {
      // Q1 pin 2 is the pin under test, wired to R2; pin 1 is the other member
      // of its group, wired to R1, and is ignored when the group has no placed pin.
      const q1 = { ...instance(3, "Q1", "Q"), t0x10s: [pin(1, 100, 1), pin(2, 200, 2)] };
      if (row.named_in_pack_short === "yes") q1.packShort = [[1, 2]];
      const r1 = { ...instance(1, "R1"), t0x10s: [pin(1, 0, 1)] };
      const r2 = { ...instance(2, "R2"), t0x10s: [pin(1, 300, 2)] };
      const pmd: PinMapData = {
        pinMaps: new Map([["Q", ["1", "2"]]]),
        cachePinMaps: new Map(),
        deviceUnitRefs: new Map(),
        pinIgnores: new Map([
          ["Q", [row.group_has_placed_pin === "no", row.pin_ignored === "yes"]],
        ]),
        cachePinIgnores: new Map(),
      };
      const sheet = { ...page("P"), wires: [wire(1, 0, 100), wire(2, 200, 300)] };
      sheet.placedInstances = [r1, r2, q1];
      const { nets } = buildNetConnectivity([sheet], new Set(), pmd, new Map(), []);
      const netOf = (ref: string) => Object.keys(nets).find((n) => nets[n][ref]?.includes("1"));
      const q1Pin2 = Object.keys(nets).find((n) => nets[n].Q1?.includes("2"));

      const outcomes: Record<string, string | undefined> = {
        "its own net": netOf("R2"),
        "the net of its group's placed pin": netOf("R1"),
        "left out": undefined,
      };
      expect(outcomes, `unknown outcome ${row.outcome}`).toHaveProperty([row.outcome]);
      expect(q1Pin2).toBe(outcomes[row.outcome]);
    });
  }
});
