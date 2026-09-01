/**
 * Universal Netlist handler.
 *
 * Reads a design that is already a Universal Netlist JSON file, the format every
 * other parser converts into (docs/schemas/universal-netlist.md). A file written
 * by `--export-json`, by another tool, or by hand is validated on load and then
 * served by every tool exactly like a design parsed from its EDA source.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ParsedNetlist, EDAProjectFormatHandler } from "../../types.js";
import { parseUniversalNetlist } from "./reader.js";
import { discoverUniversalDesigns, isUniversalFile, UNIVERSAL_EXTENSIONS } from "./discovery.js";

export {
  discoverUniversalDesigns,
  isUniversalFile,
  universalDesignName,
  UNIVERSAL_EXTENSIONS,
} from "./discovery.js";
export {
  parseUniversalNetlist,
  serializeUniversalNetlist,
  toUniversalNetlistDocument,
  validateUniversalNetlist,
  SUPPORTED_UNIVERSAL_NETLIST_SCHEMA_VERSIONS,
  UNIVERSAL_NETLIST_SCHEMA_VERSION,
  UniversalNetlistError,
} from "./reader.js";
export type { UniversalNetlistDocument } from "./reader.js";
export type { UniversalDiscoveredDesign } from "./discovery.js";

/**
 * Parse a Universal Netlist JSON file. Throws `UniversalNetlistError` naming the
 * first defect when the file is not a valid Universal Netlist.
 */
export const parseUniversalDesign = async (designPath: string): Promise<ParsedNetlist> =>
  parseUniversalNetlist(await readFile(designPath, "utf-8"), path.basename(designPath));

/**
 * Universal Netlist format handler. Recognizes `.netlist.json` files; the file
 * must carry the supported schema marker and pass validation.
 */
export const universalHandler: EDAProjectFormatHandler = {
  name: "universal",
  extensions: UNIVERSAL_EXTENSIONS,

  canHandle: isUniversalFile,

  discoverDesigns: discoverUniversalDesigns,

  parse: parseUniversalDesign,
};
