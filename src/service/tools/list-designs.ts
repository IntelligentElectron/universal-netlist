import { discoverDesigns } from "../../parsers/index.js";
import { resolvePath } from "../../paths.js";
import { parseRegexPattern } from "../regex-helpers.js";
import type { ErrorResult, DiscoveredDesign } from "../../types.js";

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
 * Build the path fields for a discovered design.
 * For Cadence CIS/HDL with .dat files: path=pstxnet.dat (preferred), source=.DSN
 * For Cadence CIS/HDL without .dat files: path=.DSN
 * For all others: path=sourcePath
 */
export const getDesignPaths = (design: DiscoveredDesign): { path: string; source?: string } => {
  if (design.format === "cadence-cis" || design.format === "cadence-hdl") {
    if (design.datFiles.pstxnet) {
      return { path: design.datFiles.pstxnet, source: design.sourcePath };
    }
  }
  return { path: design.sourcePath };
};

/**
 * List all designs in a directory.
 */
export const listDesigns = async (
  options: ListDesignsOptions = {}
): Promise<
  Array<{ name: string; path: string; source?: string; error?: string }> | ErrorResult
> => {
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
    ...getDesignPaths(design),
    error: design.error,
  }));
};
