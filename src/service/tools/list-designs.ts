import { discoverDesigns } from "../../parsers/index.js";
import { resolvePath } from "../../paths.js";
import { parseRegexPattern } from "../regex-helpers.js";
import type { ErrorResult, DesignInfo } from "../../types.js";

/**
 * Options for listDesigns.
 */
export interface ListDesignsOptions {
  searchPath?: string;
  pattern?: string;
  maxDepth?: number;
  maxResults?: number;
}

/**
 * List all designs in a directory.
 */
export const listDesigns = async (
  options: ListDesignsOptions = {}
): Promise<DesignInfo[] | ErrorResult> => {
  const { searchPath, pattern = ".*", maxDepth, maxResults = 50 } = options;
  const resolvedPath = resolvePath(searchPath ?? ".");

  const parsed = parseRegexPattern(pattern);
  if ("error" in parsed) return parsed;
  const regex = parsed.regex;

  let designs;
  try {
    designs = await discoverDesigns(resolvedPath, { maxDepth });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error occurred";
    return { error: `Failed to search '${resolvedPath}': ${message}` };
  }

  const filtered = designs.filter((design) => regex.test(design.name));
  const limited = filtered.slice(0, maxResults);
  return limited.map((design) => ({
    name: design.name,
    // The design's own file: a .DSN, a .PrjPcb, a .kicad_pro, or the netlist of
    // a design that is only a netlist. One path, which is the one to query.
    path: design.sourcePath,
    error: design.error,
  }));
};
