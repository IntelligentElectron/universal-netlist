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
 *
 * `path` is the design's own file, which for Cadence is the `.DSN` schematic.
 * It is the design as it stands, and it carries what an exported netlist cannot:
 * a part left off the board by a CIS variant is written to the `.dat` triad
 * exactly like a part that is stuffed.
 *
 * Where a netlist has been exported beside it, its `pstxnet.dat` is reported as
 * `netlist`, so a caller that wants it can still name it.
 *
 * `source` keeps naming the schematic, which is what it has always named. It now
 * holds what `path` holds, and is kept rather than dropped for being redundant:
 * a caller reading it is asking for the schematic and still gets it.
 */
export const getDesignPaths = (
  design: DiscoveredDesign
): { path: string; source?: string; netlist?: string } => {
  if (design.format === "cadence-cis" || design.format === "cadence-hdl") {
    if (design.datFiles.pstxnet) {
      return {
        path: design.sourcePath,
        source: design.sourcePath,
        netlist: design.datFiles.pstxnet,
      };
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
  | Array<{ name: string; path: string; source?: string; netlist?: string; error?: string }>
  | ErrorResult
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
