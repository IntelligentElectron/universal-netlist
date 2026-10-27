/**
 * Replays the golden decision tables in docs/decision-tables/dsn-net-assignment
 * against the code, one test per cell, so the tables and the code cannot drift:
 * which root views the hierarchy expander reads, and which section's pin map a
 * placed instance of a multi-section package resolves to.
 */
import path from "path";
import { describe, expect, it } from "vitest";
import { expandHierarchy } from "./hierarchy-expander.js";
import { findPinMap } from "./pin-resolver.js";
import type { BlockOccurrence, HierarchyScope, HierarchyStream } from "./hierarchy-parser.js";
import type { PageData } from "./page-parser.js";
import type { DrawnInstance, PlacedInstance } from "./structures.js";
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
});

const drawn = (dbId: number): DrawnInstance => ({
  dbId,
  reference: `BLK${dbId}`,
  ports: [],
  pins: [],
  locX: 0,
  locY: 0,
});

const page = (name: string, drawnInstances: DrawnInstance[] = []): PageData => ({
  name,
  netTable: new Map(),
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
