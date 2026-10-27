/**
 * The raw `.kicad_sch` reader: a KiCad design's netlist from its schematics
 * alone, with no `.net` export and no KiCad install.
 *
 * The root schematic and every sheet it reaches are read through the file
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
 * The root schematic and every sheet it reaches, each named as the sheets that
 * use it name it. A sheet's file is looked for beside the sheet that uses it,
 * as the KiCad handler's other readers look for it, then beside the root. A
 * sheet that cannot be read fails the read: a netlist without it would be
 * missing that sheet's parts and nets while looking complete, so the KiCad
 * handler falls back to kicad-cli, or reports the missing sheet.
 */
const readSources = async (
  rootSchematic: string,
  files: FileReader
): Promise<SchematicSource[]> => {
  const rootDir = path.dirname(rootSchematic);
  const sources: (SchematicSource & { dir: string })[] = [
    {
      name: path.basename(rootSchematic),
      content: await readText(files, rootSchematic),
      dir: rootDir,
    },
  ];
  const seen = new Set([sources[0].name]);
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

/**
 * Bus aliases the project file defines (`schematic.bus_aliases`), where KiCad
 * 10 keeps them. None when there is no readable project file.
 */
const readBusAliases = async (
  projectPath: string,
  files: FileReader
): Promise<Record<string, string[]>> => {
  if (path.extname(projectPath).toLowerCase() !== ".kicad_pro") return {};
  try {
    const project = JSON.parse(await readText(files, projectPath)) as {
      schematic?: { bus_aliases?: Record<string, string[]> };
    };
    return project.schematic?.bus_aliases ?? {};
  } catch {
    return {};
  }
};

/** A KiCad design's netlist from its schematics, read through `files`. */
export const readKicadSchematicNetlist = async (
  rootSchematic: string,
  files: FileReader,
  projectPath: string
): Promise<ParsedNetlist> => {
  const [sources, busAliases] = await Promise.all([
    readSources(rootSchematic, files),
    readBusAliases(projectPath, files),
  ]);
  return parseKicadNetlist(writeKicadNetlist(resolveSchematic(sources, { busAliases })));
};
