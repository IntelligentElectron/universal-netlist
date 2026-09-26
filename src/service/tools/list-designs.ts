import { discoverDesigns, findHandler } from "../../parsers/index.js";
import { DEFAULT_VARIANT } from "../../parsers/variants.js";
import { resolvePath } from "../../paths.js";
import { parseRegexPattern } from "../regex-helpers.js";
import type { DesignVariantInfo, ErrorResult, ListDesignsResult } from "../../types.js";

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
 * The builds a design offers: the native design variants it records, or its
 * base build when it records none. The list is what a caller may pass as
 * `design_variant`, so it never names a build the design does not have.
 *
 * Listing reads the design's own file (the `.PrjPcb` text, the `.DSN` container
 * directory, or the KiCad schematic tree) without parsing connectivity, so the
 * cost is a small read per design. A design whose file cannot be read reports
 * the default alone and carries the reason in `error`.
 */
const listDesignVariants = async (
  sourcePath: string
): Promise<{ design_variants: DesignVariantInfo[]; error?: string }> => {
  const base: DesignVariantInfo = { name: DEFAULT_VARIANT, is_default: true };
  const handler = findHandler(sourcePath);
  if (!handler?.listVariants) return { design_variants: [base] };
  try {
    const native = await handler.listVariants(sourcePath);
    return { design_variants: native.length > 0 ? native : [base] };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error occurred";
    return { design_variants: [base], error: `Could not read design variants: ${message}` };
  }
};

/**
 * List all designs in a directory.
 */
export const listDesigns = async (
  options: ListDesignsOptions = {}
): Promise<ListDesignsResult | ErrorResult> => {
  const { searchPath, pattern = ".*", maxDepth, maxResults = 50 } = options;
  // A blank string is not a directory, and it reaches the working directory by
  // the same route an absent argument does: `path.normalize("")` is ".". Treated
  // as a path it would resolve to that default while skipping the note saying
  // so, which is the silent fallback this function reports. The untrimmed string
  // is what gets resolved, so a directory whose name really does carry spaces
  // still resolves to itself.
  const requestedPath = searchPath?.trim() ? searchPath : undefined;
  const resolvedPath = resolvePath(requestedPath ?? ".");

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
  if (requestedPath === undefined) {
    notes.push(
      `No directory was named, so the search ran in the server's working directory. ` +
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

  const entries = await Promise.all(
    limited.map(async (design) => {
      const variants = await listDesignVariants(design.sourcePath);
      return {
        name: design.name,
        // The design's own file: a .DSN, a .PrjPcb, a .kicad_pro, or the netlist of
        // a design that is only a netlist. One path, which is the one to query.
        path: design.sourcePath,
        design_variants: variants.design_variants,
        error: design.error ?? variants.error,
      };
    })
  );

  return {
    root: resolvedPath,
    designs: entries,
    ...(notes.length > 0 ? { notes } : {}),
  };
};
