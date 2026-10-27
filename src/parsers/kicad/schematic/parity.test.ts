/**
 * Parity of the raw `.kicad_sch` reader with KiCad's own netlister.
 *
 * Every KiCad fixture carries a `.net` that `kicad-cli sch export netlist`
 * wrote, and the raw reader, reading the schematics alone, must produce the
 * same netlist: the same nets by name with the same pins, and the same
 * components with the same fields. Where a fixture's saved export came from an
 * older KiCad whose netlister differs, test/golden/kicad-cli/<project>.net
 * holds the export of kicad-cli 10.0.5, which this reader follows. With
 * `KICAD_PARITY=live` and kicad-cli installed, each design is also compared
 * with a fresh export.
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, hasFixtures } from "../../../../test/utils.js";
import { nodeFileReader, readText } from "../../context.js";
import type { ParsedNetlist } from "../../../types.js";
import { parseKicadNetlist } from "../netlist-parser.js";
import { exportNetlist, isKicadCliAvailable } from "../cli.js";
import { resolveKicadArtifacts } from "../discovery.js";
import { readKicadSchematicNetlist } from "./index.js";
import { netlistDifferences } from "./compare.js";

const NEWER_EXPORTS = path.resolve(__dirname, "../../../../test/golden/kicad-cli");

/** A fixture that ships without one of its sheets, so no reader can read it whole. */
const INCOMPLETE = "kicad-qa-variants";

/** Every KiCad fixture project: its directory and its `.kicad_pro`. */
const projects = (): [string, string][] => {
  if (!hasFixtures) return [];
  const root = path.join(FIXTURES, "kicad");
  return readdirSync(root)
    .sort()
    .flatMap((design) =>
      readdirSync(path.join(root, design))
        .filter((name) => name.endsWith(".kicad_pro"))
        .map((name): [string, string] => [design, path.join(root, design, name)])
    );
};

const raw = async (project: string): Promise<ParsedNetlist> => {
  const { rootSchematic } = await resolveKicadArtifacts(project);
  if (!rootSchematic) throw new Error(`No root schematic beside ${project}`);
  return readKicadSchematicNetlist(rootSchematic, nodeFileReader, project);
};

/** The kicad-cli export a design is checked against: a newer one when there is one. */
const reference = async (project: string): Promise<ParsedNetlist> => {
  const newer = path.join(NEWER_EXPORTS, `${path.basename(project, ".kicad_pro")}.net`);
  const saved = existsSync(newer) ? newer : (await resolveKicadArtifacts(project)).netlistExport!;
  return parseKicadNetlist(await readText(nodeFileReader, saved));
};

describe.skipIf(!hasFixtures)("raw .kicad_sch reader against kicad-cli exports", () => {
  it.each(projects().filter(([design]) => design !== INCOMPLETE))(
    "%s",
    async (_design, project) => {
      expect(netlistDifferences(await reference(project), await raw(project))).toEqual([]);
    }
  );

  it("refuses a design whose sheet is missing, naming the sheet", async () => {
    const project = projects().find(([design]) => design === INCOMPLETE)![1];
    await expect(raw(project)).rejects.toThrow(
      /Sheet "pic_sockets\.kicad_sch" used by variants\.kicad_sch cannot be read/
    );
  });
});

const live = process.env.KICAD_PARITY === "live";
describe.skipIf(!hasFixtures || !live)(
  "raw .kicad_sch reader against a live kicad-cli export",
  () => {
    it.each(projects().filter(([design]) => design !== INCOMPLETE))(
      "%s",
      async (_design, project) => {
        if (!(await isKicadCliAvailable())) throw new Error("KICAD_PARITY=live needs kicad-cli");
        const { rootSchematic } = await resolveKicadArtifacts(project);
        const exported = parseKicadNetlist(await exportNetlist(rootSchematic!));
        expect(netlistDifferences(exported, await raw(project))).toEqual([]);
      },
      120_000
    );
  }
);
