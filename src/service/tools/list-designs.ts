import { discoverDesigns } from "../../parsers/index.js";
import { resolvePath } from "../../paths.js";
import { parseRegexPattern } from "../regex-helpers.js";
import type { ErrorResult, ListDesignsResult } from "../../types.js";

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
): Promise<ListDesignsResult | ErrorResult> => {
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

  const notes: string[] = [];
  // A caller who names no directory rarely means "wherever this server happens
  // to have been launched", and a caller who misspells the argument means it
  // even less: an unrecognised argument is dropped before it arrives, so a typo
  // arrives here as no path at all and searches the same default. Both return
  // real designs from a directory nobody asked about, which is indistinguishable
  // from a correct answer unless the result says where it looked.
  if (searchPath === undefined) {
    notes.push(
      `No path was given, so the search ran in the server's working directory. ` +
        `That is where the server was launched, which is not necessarily where you are. ` +
        `Pass 'path' to search a directory you choose.`
    );
  }
  if (filtered.length > limited.length) {
    notes.push(
      `Showing ${limited.length} of ${filtered.length} designs. ` +
        `Narrow the search with a more specific 'path', a 'pattern', or a smaller 'max_depth'.`
    );
  }

  return {
    root: resolvedPath,
    designs: limited.map((design) => ({
      name: design.name,
      // The design's own file: a .DSN, a .PrjPcb, a .kicad_pro, or the netlist of
      // a design that is only a netlist. One path, which is the one to query.
      path: design.sourcePath,
      error: design.error,
    })),
    ...(notes.length > 0 ? { notes } : {}),
  };
};
