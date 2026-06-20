/**
 * KiCad Parser
 *
 * Converts KiCad schematic projects into the unified ParsedNetlist by parsing a
 * fully-resolved `kicadsexpr` netlist export. Two sources, in priority order:
 *   1. A committed `.net` export beside the project (preferred; keeps CI
 *      KiCad-free, exactly like Cadence's committed `.dat` files).
 *   2. Live generation via `kicad-cli` from the root `.kicad_sch` (runtime
 *      fallback for arbitrary designs when KiCad is installed).
 *
 * Reconstructing connectivity directly from `.kicad_sch` (a raw reader) is a
 * separate future task; KiCad's exporter already resolves wires, junctions,
 * labels, buses and hierarchical sheets for us.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ParsedNetlist, EDAProjectFormatHandler } from "../../types.js";
import { parseKicadNetlist } from "./netlist-parser.js";
import { exportNetlist } from "./cli.js";
import {
  discoverKicadDesigns,
  isKicadFile,
  resolveKicadArtifacts,
  KICAD_EXTENSIONS,
} from "./discovery.js";

export { discoverKicadDesigns, isKicadFile, resolveKicadArtifacts } from "./discovery.js";
export { parseKicadNetlist } from "./netlist-parser.js";
export { exportNetlist, isKicadCliAvailable, resolveKicadCli } from "./cli.js";
export type { KicadDiscoveredDesign } from "./discovery.js";

/**
 * Parse a KiCad design (a `.kicad_pro` project or a root `.kicad_sch`) into a
 * ParsedNetlist. Prefers a committed `.net` export; otherwise runs kicad-cli.
 */
export const parseKicadDesign = async (designPath: string): Promise<ParsedNetlist> => {
  const ext = path.extname(designPath).toLowerCase();

  // A caller may pass the resolved `.net` export directly.
  if (ext === ".net") {
    return parseKicadNetlist(await readFile(designPath, "utf-8"));
  }

  const { netlistExport, rootSchematic } = await resolveKicadArtifacts(designPath);

  // 1. Committed export beside the project (preferred).
  if (netlistExport) {
    return parseKicadNetlist(await readFile(netlistExport, "utf-8"));
  }

  // 2. Live generation from the root schematic via kicad-cli.
  if (rootSchematic) {
    return parseKicadNetlist(await exportNetlist(rootSchematic));
  }

  throw new Error(
    `No netlist for ${path.basename(designPath)}. Expected a committed "${path.basename(
      designPath,
      ext
    )}.net" beside the project, or a root .kicad_sch plus an installed kicad-cli ` +
      `(set KICAD_CLI_PATH if KiCad is in a non-standard location).`
  );
};

/**
 * KiCad EDA project format handler.
 * Recognizes `.kicad_pro` projects and `.kicad_sch` schematics; the resolved
 * `.net` export is an internal artifact discovered by convention, not a
 * top-level handled extension.
 */
export const kicadHandler: EDAProjectFormatHandler = {
  name: "kicad",
  extensions: KICAD_EXTENSIONS,

  canHandle: isKicadFile,

  discoverDesigns: discoverKicadDesigns,

  parse: parseKicadDesign,
};
