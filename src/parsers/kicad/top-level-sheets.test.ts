/**
 * A KiCad 10 project with several top-level sheets: each is a page of its own,
 * listed in the project's `schematic.top_level_sheets`, and no sheet symbol
 * links them.
 *
 * test/kicad/top-level-sheets is a small hand-drawn design, and its .net is the
 * export of kicad-cli 10.0.8:
 * - Alpha (the root file): R1.1 and R2.1 on the local label SIG (`/Alpha/SIG`),
 *   R1.2 on the global label G, R2.2 on a no-connect flag;
 * - Beta: R3.1 alone on its own local label SIG (`/Beta/SIG`), R3.2 and R5.2 on
 *   G, R5.1 through a sheet pin to the child sheet Gamma;
 * - Gamma (a sheet of Beta): R4.1 on the hierarchical label H (`/Beta/Gamma/H`),
 *   R4.2 on a no-connect flag.
 */
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { nodeFileReader, readText } from "../context.js";
import { createNetlistService } from "../../service/index.js";
import { netlistDifferences } from "../../../test/helpers/netlist-compare.js";
import { exportNetlist, isKicadCliAvailable } from "./cli.js";
import { kicadRootSchematics, readKicadProjectSchematic } from "./discovery.js";
import { parseKicadNetlist } from "./netlist-parser.js";
import { readKicadSchematicNetlist } from "./schematic/index.js";
import { readSchematicHierarchy } from "./variants.js";

const DIR = path.resolve(__dirname, "../../../test/kicad/top-level-sheets");
const PROJECT = path.join(DIR, "top-level-sheets.kicad_pro");
const ROOT = path.join(DIR, "top-level-sheets.kicad_sch");
const SHEETS = ["top-level-sheets.kicad_sch", "beta.kicad_sch", "gamma.kicad_sch"];

const saved = async () =>
  parseKicadNetlist(await readText(nodeFileReader, path.join(DIR, "top-level-sheets.net")));
const raw = () => readKicadSchematicNetlist(ROOT, nodeFileReader, PROJECT);

// The same design with no saved export, so the service reads the schematics itself.
const schematicOnly = mkdtempSync(path.join(tmpdir(), "un-top-level-sheets-"));
for (const file of ["top-level-sheets.kicad_pro", ...SHEETS]) {
  copyFileSync(path.join(DIR, file), path.join(schematicOnly, file));
}
afterAll(() => rmSync(schematicOnly, { recursive: true, force: true }));

const NETS = {
  "/Alpha/SIG": { R1: ["1"], R2: ["1"] },
  "/Beta/SIG": { R3: ["1"] },
  "/Beta/Gamma/H": { R4: ["1"], R5: ["1"] },
  G: { R1: ["2"], R3: ["2"], R5: ["2"] },
};

describe("KiCad project with several top-level sheets", () => {
  it("lists the project's top-level sheets, and starts the hierarchy from each", async () => {
    const { topLevelSheets } = await readKicadProjectSchematic(PROJECT);
    expect(topLevelSheets.map((sheet) => [sheet.name, sheet.filename])).toEqual([
      ["Alpha", "top-level-sheets.kicad_sch"],
      ["Beta", "beta.kicad_sch"],
    ]);
    const roots = await kicadRootSchematics(PROJECT, ROOT);
    expect(roots).toEqual([ROOT, path.join(DIR, "beta.kicad_sch")]);
    expect(await readSchematicHierarchy(roots)).toHaveLength(SHEETS.length);
  });

  it.each([
    ["the saved .net", saved],
    ["the raw schematic reader", raw],
  ])("reads every page from %s", async (_source, read) => {
    const netlist = await read();
    expect(Object.keys(netlist.components).sort()).toEqual(["R1", "R2", "R3", "R4", "R5"]);
    expect(netlist.nets).toEqual(NETS);
    expect(netlist.components.R2.pins["2"]).toBe("");
    expect(netlist.components.R4.pins["2"]).toBe("");
  });

  it("reads the schematics as kicad-cli exports them", async () => {
    expect(netlistDifferences(await saved(), await raw())).toEqual([]);
  });

  it.each([
    ["with its saved .net", PROJECT],
    ["from its schematics alone", path.join(schematicOnly, "top-level-sheets.kicad_pro")],
  ])("run_erc checks every page, %s", async (_source, design) => {
    const service = createNetlistService();
    expect(await service.listNets({ design })).toMatchObject({ nets: Object.keys(NETS).sort() });
    // R3.1 is the one open pin with no flag; R2.2 and R4.2 sit on flags.
    expect(await service.runErc({ design, include_rules: ["net.single_pin"] })).toMatchObject({
      errors: { "net.single_pin": { "/Beta/SIG": ["R3.1"] } },
    });
  });

  it("reads every page when the design is given as its root schematic", async () => {
    const service = createNetlistService();
    const design = path.join(schematicOnly, "top-level-sheets.kicad_sch");
    expect(await service.listNets({ design })).toMatchObject({ nets: Object.keys(NETS).sort() });
  });

  it("names a project file's top-level sheets only when it lists two or more", async () => {
    const one = mkdtempSync(path.join(tmpdir(), "un-one-top-level-sheet-"));
    try {
      const project = path.join(one, "single.kicad_pro");
      copyFileSync(PROJECT, project);
      const listed = JSON.parse(await readText(nodeFileReader, project));
      listed.schematic.top_level_sheets = listed.schematic.top_level_sheets.slice(0, 1);
      writeFileSync(project, JSON.stringify(listed));
      expect((await readKicadProjectSchematic(project)).topLevelSheets).toEqual([]);
      expect(await kicadRootSchematics(project, ROOT)).toEqual([ROOT]);
    } finally {
      rmSync(one, { recursive: true, force: true });
    }
  });

  /** The fixture's schematics in a fresh directory, under a project file `edit` rewrites. */
  const withProject = async <T>(
    edit: (schematic: { top_level_sheets: Record<string, unknown>[] }) => void,
    run: (project: string, dir: string) => Promise<T>
  ): Promise<T> => {
    const dir = mkdtempSync(path.join(tmpdir(), "un-top-level-edit-"));
    try {
      for (const file of SHEETS) copyFileSync(path.join(DIR, file), path.join(dir, file));
      const listed = JSON.parse(await readText(nodeFileReader, PROJECT));
      edit(listed.schematic);
      const project = path.join(dir, "top-level-sheets.kicad_pro");
      writeFileSync(project, JSON.stringify(listed));
      return await run(project, dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it("writes a / in a sheet name as {slash}, as kicad-cli 10.0.8 does", async () => {
    // kicad-cli names these nets /Be{slash}ta/SIG and /Be{slash}ta/Gamma/H.
    const nets = await withProject(
      (schematic) => (schematic.top_level_sheets[1].name = "Be/ta"),
      async (project, dir) =>
        Object.keys(
          (
            await readKicadSchematicNetlist(
              path.join(dir, "top-level-sheets.kicad_sch"),
              nodeFileReader,
              project
            )
          ).nets
        ).sort()
    );
    expect(nets).toEqual(["/Alpha/SIG", "/Be{slash}ta/Gamma/H", "/Be{slash}ta/SIG", "G"]);
  });

  it("keeps reading the other pages when one listed entry is malformed", async () => {
    const nets = await withProject(
      (schematic) => {
        delete schematic.top_level_sheets[0].uuid;
      },
      async (project, dir) =>
        Object.keys(
          (
            await readKicadSchematicNetlist(
              path.join(dir, "top-level-sheets.kicad_sch"),
              nodeFileReader,
              project
            )
          ).nets
        ).sort()
    );
    expect(nets).toEqual(["/Beta/Gamma/H", "/Beta/SIG", "G"]);
  });
});

describe.skipIf(process.env.KICAD_PARITY !== "live")(
  "KiCad project with several top-level sheets, against a live kicad-cli export",
  () => {
    it("matches kicad-cli exporting the root sheet", async () => {
      if (!(await isKicadCliAvailable())) throw new Error("KICAD_PARITY=live needs kicad-cli");
      const exported = parseKicadNetlist(await exportNetlist(ROOT));
      expect(netlistDifferences(exported, await raw())).toEqual([]);
    }, 120_000);
  }
);
