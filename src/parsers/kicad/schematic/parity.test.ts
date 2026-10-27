/**
 * Parity of the raw `.kicad_sch` reader with KiCad's own netlister.
 *
 * Every KiCad fixture carries a `.net` that `kicad-cli sch export netlist`
 * wrote. The raw reader reads the schematics alone, and its netlist must equal
 * that export: the same nets by name with the same pins, and the same
 * components with the same fields. With `KICAD_PARITY=live` and kicad-cli
 * installed, it is also compared with a fresh export, so a fixture saved by an
 * older KiCad is checked against the netlister this machine has.
 */
import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, hasFixtures } from "../../../../test/utils.js";
import { nodeFileReader, readText } from "../../context.js";
import type { ParsedNetlist } from "../../../types.js";
import { parseKicadNetlist } from "../netlist-parser.js";
import { exportNetlist, isKicadCliAvailable } from "../cli.js";
import { resolveKicadArtifacts } from "../discovery.js";
import { readKicadSchematicNetlist } from "./index.js";

/** Every KiCad fixture project with a saved export beside it. */
const projects = (): string[] => {
  if (!hasFixtures) return [];
  const root = path.join(FIXTURES, "kicad");
  const found: string[] = [];
  for (const design of readdirSync(root)) {
    for (const name of readdirSync(path.join(root, design))) {
      if (name.endsWith(".kicad_pro")) found.push(path.join(root, design, name));
    }
  }
  return found.sort();
};

/** How two netlists differ, net by net and component by component; empty when they agree. */
export const netlistDifferences = (expected: ParsedNetlist, actual: ParsedNetlist): string[] => {
  const differences: string[] = [];
  const pins = (net: ParsedNetlist["nets"][string] | undefined) =>
    Object.entries(net ?? {})
      .flatMap(([refdes, numbers]) => numbers.map((pin) => `${refdes}.${pin}`))
      .sort();
  for (const name of new Set([...Object.keys(expected.nets), ...Object.keys(actual.nets)])) {
    const [want, got] = [pins(expected.nets[name]), pins(actual.nets[name])];
    if (want.join() !== got.join()) {
      const missing = want.filter((pin) => !got.includes(pin));
      const extra = got.filter((pin) => !want.includes(pin));
      differences.push(`net ${JSON.stringify(name)}: missing [${missing}] extra [${extra}]`);
    }
  }
  for (const refdes of new Set([
    ...Object.keys(expected.components),
    ...Object.keys(actual.components),
  ])) {
    const [want, got] = [expected.components[refdes], actual.components[refdes]];
    if (JSON.stringify(want) !== JSON.stringify(got)) {
      differences.push(
        `component ${refdes}: expected ${JSON.stringify(want)?.slice(0, 200)} got ${JSON.stringify(got)?.slice(0, 200)}`
      );
    }
  }
  return differences;
};

const raw = async (project: string): Promise<ParsedNetlist> => {
  const { rootSchematic } = await resolveKicadArtifacts(project);
  if (!rootSchematic) throw new Error(`No root schematic beside ${project}`);
  return readKicadSchematicNetlist(rootSchematic, nodeFileReader, project);
};

describe.skipIf(!hasFixtures)("raw .kicad_sch reader against the saved kicad-cli export", () => {
  it.each(projects())("%s", async (project) => {
    const { netlistExport } = await resolveKicadArtifacts(project);
    const saved = parseKicadNetlist(await readText(nodeFileReader, netlistExport!));
    expect(netlistDifferences(saved, await raw(project))).toEqual([]);
  });
});

const live = process.env.KICAD_PARITY === "live";
describe.skipIf(!hasFixtures || !live)(
  "raw .kicad_sch reader against a live kicad-cli export",
  () => {
    it.each(projects())(
      "%s",
      async (project) => {
        if (!(await isKicadCliAvailable())) throw new Error("KICAD_PARITY=live needs kicad-cli");
        const { rootSchematic } = await resolveKicadArtifacts(project);
        const exported = parseKicadNetlist(await exportNetlist(rootSchematic!));
        expect(netlistDifferences(exported, await raw(project))).toEqual([]);
      },
      120_000
    );
  }
);
