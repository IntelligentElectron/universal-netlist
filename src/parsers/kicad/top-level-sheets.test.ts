/**
 * A KiCad 10 project with several top-level sheets: each is a page of its own,
 * listed in the project's `schematic.top_level_sheets`, and no sheet symbol
 * links them.
 *
 * e-ink-proto-one (test/fixtures/kicad) lists eight: Root, whose file holds no
 * parts, then Main Computer, Power, EC and four empty pages. Its .net is the
 * export of kicad-cli 10.0.8. Reading the root file alone finds no nets.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { fixturePath, hasFixtures } from "../../../test/utils.js";
import { nodeFileReader, readText } from "../context.js";
import { createNetlistService } from "../../service/index.js";
import { netlistDifferences } from "../../../test/helpers/netlist-compare.js";
import { kicadRootSchematics, readKicadProjectSchematic } from "./discovery.js";
import { parseKicadNetlist } from "./netlist-parser.js";
import { readKicadSchematicNetlist } from "./schematic/index.js";
import { readSchematicHierarchy } from "./variants.js";

const DIR = fixturePath("kicad", "e-ink-proto-one");
const PROJECT = path.join(DIR, "proto_one.kicad_pro");
const ROOT = path.join(DIR, "proto_one.kicad_sch");
const PAGES = [
  ["Root", "proto_one.kicad_sch"],
  ["Main Computer", "main_computer.kicad_sch"],
  ["Power", "power.kicad_sch"],
  ["EC", "ec.kicad_sch"],
  ["Display", "display.kicad_sch"],
  ["Touch", "touch.kicad_sch"],
  ["Pen", "pen.kicad_sch"],
  ["Sensors", "sensors.kicad_sch"],
];

const saved = async () =>
  parseKicadNetlist(await readText(nodeFileReader, path.join(DIR, "proto_one.net")));
const raw = (project = PROJECT, root = ROOT) =>
  readKicadSchematicNetlist(root, nodeFileReader, project);

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** A copy of a fixture directory without its saved export, `edit` applied to it. */
const copyOf = (fixture: string, edit: (dir: string) => void = () => {}): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "un-top-level-"));
  scratch.push(dir);
  cpSync(fixturePath("kicad", fixture), dir, {
    recursive: true,
    filter: (source) => !source.endsWith(".net"),
  });
  edit(dir);
  return dir;
};

/** Rewrite the project's `schematic.top_level_sheets` in a copy. */
const editSheets =
  (change: (sheets: Record<string, unknown>[]) => Record<string, unknown>[]) => (dir: string) => {
    const project = path.join(dir, "proto_one.kicad_pro");
    const json = JSON.parse(readFileSync(project, "utf8"));
    json.schematic.top_level_sheets = change(json.schematic.top_level_sheets);
    writeFileSync(project, JSON.stringify(json));
  };

describe.skipIf(!hasFixtures)(
  "KiCad project with several top-level sheets (e-ink-proto-one)",
  () => {
    it("lists the project's top-level sheets, and starts the hierarchy from each", async () => {
      const { topLevelSheets } = await readKicadProjectSchematic(PROJECT);
      expect(topLevelSheets.map((sheet) => [sheet.name, sheet.filename])).toEqual(PAGES);
      const roots = await kicadRootSchematics(PROJECT, ROOT);
      expect(roots).toEqual(PAGES.map(([, file]) => path.join(DIR, file)));
      expect(await readSchematicHierarchy(roots)).toHaveLength(PAGES.length);
    });

    it("reads every page from the schematics, as kicad-cli exports them", async () => {
      const [expected, actual] = [await saved(), await raw()];
      expect(Object.keys(actual.components)).toHaveLength(69);
      expect(Object.keys(actual.nets).length).toBeGreaterThan(0);
      expect(netlistDifferences(expected, actual)).toEqual([]);
    });

    it("reads every page through the service, from the project or its root schematic", async () => {
      const service = createNetlistService();
      const withExport = await service.listNets({ design: PROJECT });
      const dir = copyOf("e-ink-proto-one");
      expect(await service.listNets({ design: path.join(dir, "proto_one.kicad_pro") })).toEqual(
        withExport
      );
      expect(await service.listNets({ design: path.join(dir, "proto_one.kicad_sch") })).toEqual(
        withExport
      );
    });

    it("reads the root schematic alone when the project lists one top-level sheet", async () => {
      const dir = copyOf(
        "e-ink-proto-one",
        editSheets((sheets) => sheets.slice(0, 1))
      );
      const project = path.join(dir, "proto_one.kicad_pro");
      const root = path.join(dir, "proto_one.kicad_sch");
      expect((await readKicadProjectSchematic(project)).topLevelSheets).toEqual([]);
      expect(await kicadRootSchematics(project, root)).toEqual([root]);
      // The root page holds no parts.
      expect(Object.keys((await raw(project, root)).components)).toEqual([]);
    });

    it("keeps reading the other pages when one listed entry is malformed", async () => {
      // Power's entry loses its uuid: Power (X1 among its parts) is dropped, the rest read.
      const dir = copyOf(
        "e-ink-proto-one",
        editSheets((sheets) =>
          sheets.map((sheet) => {
            if (sheet.name !== "Power") return sheet;
            const { uuid: _dropped, ...rest } = sheet;
            return rest;
          })
        )
      );
      const netlist = await raw(
        path.join(dir, "proto_one.kicad_pro"),
        path.join(dir, "proto_one.kicad_sch")
      );
      const all = Object.keys((await saved()).components);
      expect(Object.hasOwn(netlist.components, "X1")).toBe(false);
      expect(Object.keys(netlist.components).length).toBeGreaterThan(0);
      expect(Object.keys(netlist.components).length).toBeLessThan(all.length);
    });

    it("writes a / in a sheet name as {slash}, as kicad-cli 10.0.8 does", async () => {
      // cm5-minima with its CM5 sheet renamed CM/5: kicad-cli names the net /CM{slash}5/GLOBAL_EN.
      const dir = copyOf("cm5-minima", (copy) => {
        const root = path.join(copy, "CM5_MINIMA_3.kicad_sch");
        writeFileSync(
          root,
          readFileSync(root, "utf8").replace('"Sheetname" "CM5"', '"Sheetname" "CM/5"')
        );
      });
      const netlist = await raw(
        path.join(dir, "CM5_MINIMA_3.kicad_pro"),
        path.join(dir, "CM5_MINIMA_3.kicad_sch")
      );
      expect(netlist.nets["/CM{slash}5/GLOBAL_EN"]).toEqual({ Module301: ["99"] });
      expect(Object.keys(netlist.nets).filter((name) => name.startsWith("/CM/"))).toEqual([]);
    });
  }
);
