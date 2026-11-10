/**
 * The raw `.kicad_sch` reader: a KiCad design's netlist from its schematics
 * alone, with no `.net` export and no KiCad install.
 *
 * The root schematic (or, in a KiCad 10 project that lists several top-level
 * sheets, each of them) and every sheet it reaches are read through the file
 * reader, the project's bus aliases from its `.kicad_pro`, and the connectivity
 * engine resolves wires, junctions, labels, power symbols, buses and sheets
 * the way KiCad's netlister does. The result is written as a `kicadsexpr`
 * netlist and read by `parseKicadNetlist`, so it maps fields exactly as a saved
 * export does.
 */

import path from "node:path";
import { readText, type FileReader } from "../../context.js";
import type { ParsedNetlist } from "../../../types.js";
import { parseKicadNetlist } from "../netlist-parser.js";
import { resolveSchematic, type SchematicSource } from "./connectivity.js";
import { writeKicadNetlist } from "./netlist-writer.js";
import { readKicadProjectSchematic } from "../discovery.js";

/**
 * The files a schematic's sheets name, from their `Sheetfile` property
 * (`Sheet file` in KiCad 6). Found by scanning the text, not parsing it: the
 * connectivity engine parses every sheet once, and this only needs the names.
 */
const sheetFiles = (content: string): string[] => {
  const files = new Set<string>();
  for (const match of content.matchAll(/\(property\s+"Sheet ?file"\s+"((?:[^"\\]|\\.)*)"/g)) {
    const file = match[1].replace(/\\(.)/g, "$1").trim();
    if (file) files.add(file);
  }
  return [...files];
};

/**
 * The root schematics and every sheet they reach, each named as the sheets
 * that use it name it, roots first. A design has one root, or one per
 * top-level sheet of a KiCad 10 project that lists several, named as the
 * project names it. A sheet's file is looked for beside the sheet that uses
 * it, as the KiCad handler's other readers look for it, then beside the root.
 * A sheet that cannot be read fails the read: a netlist without it would be
 * missing that sheet's parts and nets while looking complete, so the KiCad
 * handler falls back to kicad-cli, or reports the missing sheet.
 */
const readSources = async (
  roots: readonly { name: string; path: string }[],
  files: FileReader
): Promise<SchematicSource[]> => {
  const rootDir = path.dirname(roots[0].path);
  const sources: (SchematicSource & { dir: string })[] = [];
  for (const root of roots) {
    sources.push({
      name: root.name,
      content: await readText(files, root.path),
      dir: path.dirname(root.path),
    });
  }
  const seen = new Set(sources.map((source) => source.name));
  for (let i = 0; i < sources.length; i++) {
    for (const sheetFile of sheetFiles(sources[i].content)) {
      if (seen.has(sheetFile)) continue;
      seen.add(sheetFile);
      const candidates = [...new Set([sources[i].dir, rootDir])].map((dir) =>
        path.resolve(dir, sheetFile)
      );
      let found: { content: string; dir: string } | undefined;
      let failure: unknown;
      for (const candidate of candidates) {
        try {
          found = { content: await readText(files, candidate), dir: path.dirname(candidate) };
          break;
        } catch (error) {
          failure ??= error;
        }
      }
      if (!found) {
        throw new Error(
          `Sheet "${sheetFile}" used by ${sources[i].name} cannot be read: ${(failure as Error).message}`
        );
      }
      sources.push({ name: sheetFile, ...found });
    }
  }
  return sources.map(({ name, content }) => ({ name, content }));
};

/** A KiCad design's netlist from its schematics, read through `files`. */
export const readKicadSchematicNetlist = async (
  rootSchematic: string,
  files: FileReader,
  projectPath: string
): Promise<ParsedNetlist> => {
  // The project file's bus aliases, where KiCad 10 keeps them, and its
  // top-level sheets when it lists several. None without a readable project
  // file. A design given as its root .kicad_sch reads the project beside it.
  const { busAliases, topLevelSheets } = await readKicadProjectSchematic(projectPath, files);
  const roots = topLevelSheets.length
    ? topLevelSheets.map((sheet) => ({
        name: sheet.filename,
        path: path.resolve(path.dirname(rootSchematic), sheet.filename),
      }))
    : [{ name: path.basename(rootSchematic), path: rootSchematic }];
  const sources = await readSources(roots, files);
  return parseKicadNetlist(
    writeKicadNetlist(
      resolveSchematic(sources, {
        busAliases,
        topLevelSheets: topLevelSheets.map((sheet) => ({
          uuid: sheet.uuid,
          name: sheet.name,
          file: sheet.filename,
        })),
      })
    )
  );
};
