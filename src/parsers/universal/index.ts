/**
 * Universal Netlist handler.
 *
 * Reads a design that is already a Universal Netlist JSON file, the format every
 * other parser converts into (docs/schemas/universal-netlist.md). A file written
 * by `export_design`, by another tool, or by hand is validated on load and then
 * served by every tool exactly like a design parsed from its EDA source.
 */

import { contextOrDefault, readText } from "../context.js";
import path from "node:path";
import type {
  DesignVariant,
  ParsedNetlist,
  EDAProjectFormatHandler,
  ParseDesignOptions,
} from "../../types.js";
import type { ParserContext } from "../context.js";
import { parseUniversalNetlist } from "./reader.js";
import { discoverUniversalDesigns, isUniversalFile, UNIVERSAL_EXTENSIONS } from "./discovery.js";

export {
  discoverUniversalDesigns,
  isUniversalFile,
  universalDesignName,
  UNIVERSAL_EXTENSIONS,
} from "./discovery.js";
export {
  calculateUniversalNetlistHash,
  parseUniversalNetlist,
  parseUniversalNetlistDocument,
  serializeUniversalNetlist,
  toUniversalNetlistDocument,
  validateUniversalNetlist,
  SUPPORTED_UNIVERSAL_NETLIST_SCHEMA_VERSIONS,
  UNIVERSAL_NETLIST_SCHEMA_VERSION,
  UniversalNetlistError,
} from "./reader.js";
export type {
  UniversalNetlistDocument,
  UniversalNetlistMetadata,
  UniversalNetlistOrigin,
  UniversalNetlistSerializationOptions,
  UniversalNetlistSource,
} from "./reader.js";
export type { UniversalDiscoveredDesign } from "./discovery.js";

/**
 * Parse a Universal Netlist JSON file. Throws `UniversalNetlistError` naming the
 * first defect when the file is not a valid Universal Netlist.
 */
export const parseUniversalDesign = async (
  designPath: string,
  options?: ParseDesignOptions
): Promise<ParsedNetlist> =>
  parseUniversalNetlist(
    await readText(contextOrDefault(options?.context).files, designPath),
    path.basename(designPath)
  );

/**
 * The build a Universal Netlist file records. A file exported from one variant
 * of a design is that variant's build and nothing else, so it lists that one
 * name, and every query of it names the variant as the source design's would.
 * A file without `metadata.designVariant` is a base build and lists none.
 *
 * Only the field is read. Validating the file and verifying its hash is the
 * parse's job, so listing stays a read per design, and a file that does not
 * parse lists no variant and is refused, naming the defect, when it is loaded.
 */
export const listUniversalVariants = async (
  designPath: string,
  context?: ParserContext
): Promise<DesignVariant[]> => {
  const text = await readText(contextOrDefault(context).files, designPath);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  const metadata = (raw as { metadata?: { designVariant?: unknown } } | null)?.metadata;
  const name = metadata?.designVariant;
  return typeof name === "string" && name.trim() ? [{ name }] : [];
};

/**
 * Universal Netlist format handler. Recognizes `.netlist.json` files; the file
 * must carry the supported schema marker and pass validation.
 */
export const universalHandler: EDAProjectFormatHandler = {
  name: "universal",
  extensions: UNIVERSAL_EXTENSIONS,

  canHandle: isUniversalFile,

  discoverDesigns: discoverUniversalDesigns,

  listVariants: listUniversalVariants,

  parse: parseUniversalDesign,
};
