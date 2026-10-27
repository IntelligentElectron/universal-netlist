import path from "path";
import { findHandler, parseDesign } from "../parsers/index.js";
import { resolvePath } from "../paths.js";
import type {
  DesignVariant,
  EDAProjectFormatHandler,
  ErrorResult,
  ParsedNetlist,
} from "../types.js";
import type { ServiceContext } from "./context.js";
import { parserContextFromEnvironment, readOnce, type ParserContext } from "../parsers/context.js";
import { cached, type CacheStore } from "./cache.js";
import {
  DEFAULT_VARIANT,
  describeDefaultVariantRefusal,
  describeVariantChoices,
  quoteVariantNames,
  resolveVariantSelector,
} from "../parsers/variants.js";

/**
 * Normalize unconnected pins to "NC" (No Connect), in place. It runs on a
 * fresh parse before the parse is cached, so a cached parse is never changed.
 */
const normalizeUnconnectedPins = (netlist: ParsedNetlist): ParsedNetlist => {
  for (const component of Object.values(netlist.components)) {
    for (const [pin, net] of Object.entries(component.pins)) {
      if (typeof net === "string") {
        if (net === "") {
          component.pins[pin] = "NC";
        }
        continue;
      }

      if (net?.net === "") {
        net.net = "NC";
      }
    }
  }
  return netlist;
};

/**
 * The variants a design records, from the cache when its files have not
 * changed. Listing and parsing share one cache, so a query costs one listing.
 */
const listVariantsCached = async (
  handler: EDAProjectFormatHandler,
  designPath: string,
  parser: ParserContext,
  cache?: CacheStore
): Promise<DesignVariant[]> =>
  handler.listVariants
    ? cached(cache, { kind: "variants", path: designPath }, parser, (recording) =>
        handler.listVariants!(designPath, recording)
      )
    : [];

/** A parsed design plus the design variant it was resolved for. */
export interface LoadedNetlist extends ParsedNetlist {
  design_variant: string;
  /** The handler that parsed the design, such as `cadence` or `kicad`. */
  format: string;
}

/**
 * Load netlist from a design file path.
 * Delegates to the appropriate handler based on file extension.
 *
 * Every result describes one build of the design. A design that declares
 * variants has only those to build, so it is refused without an explicit
 * `design_variant` naming one of them, and `<Default>` is refused on it too.
 * A design that declares none has its base build, and `design_variant` is
 * optional for it.
 *
 * The design is read through the context's file reader, and a relative path
 * resolves against its root. Without a context, the local disk and the
 * environment's settings are used and nothing is cached, so the caller gets a
 * parse of its own. Through a context's cache, the parse is shared with later
 * queries and deep-frozen.
 */
export const loadNetlist = async (
  designPath: string,
  designVariant?: string,
  context: ServiceContext = { parser: parserContextFromEnvironment() }
): Promise<LoadedNetlist | ErrorResult> => {
  const normalizedPath = resolvePath(designPath, context.root);
  // Listing variants and parsing read the same files; each is read once.
  const parser = { ...context.parser, files: readOnce(context.parser.files) };
  const handler = findHandler(normalizedPath);
  if (!handler) {
    const ext = path.extname(normalizedPath);
    return {
      error: `Unsupported design file format '${ext}'. Use list_designs() first.`,
    };
  }

  try {
    const variants = await listVariantsCached(handler, normalizedPath, parser, context.cache);
    const requested = designVariant?.trim();
    const designName = path.basename(normalizedPath);
    if (!requested && variants.length > 0) {
      return {
        error:
          `Design '${designName}' defines design variants ${quoteVariantNames(variants)}. ` +
          `Pass design_variant as one of those names; they are the only builds it records. ` +
          `list_designs() reports them under design_variants.`,
      };
    }

    // The parser is handed a canonical selector: a declared name in its own
    // spelling, or the literal `<Default>`. Passing that explicitly matters for
    // Cadence, whose parser keeps a "union of groups" mode for developer
    // coverage when given no selector at all; public queries always describe
    // one build.
    const selection = requested
      ? resolveVariantSelector(variants, requested)
      : { selected: DEFAULT_VARIANT };
    if (!selection) {
      return {
        error:
          `Design variant '${requested}' not found for design '${designName}'. ` +
          `Available: ${describeVariantChoices(variants)}.`,
      };
    }
    if (selection.selected === DEFAULT_VARIANT && variants.length > 0) {
      return { error: describeDefaultVariantRefusal(variants, designName) };
    }

    const parsed = await cached(
      context.cache,
      { kind: "netlist", path: normalizedPath, variant: selection.selected },
      parser,
      (recording) =>
        parseDesign(normalizedPath, { variant: selection.selected, context: recording }),
      normalizeUnconnectedPins
    );
    return { ...parsed, design_variant: selection.selected, format: handler.name };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error occurred";
    return { error: message };
  }
};
