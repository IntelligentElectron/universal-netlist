import path from "path";
import { findHandler, parseDesign } from "../parsers/index.js";
import { resolvePath } from "../paths.js";
import type { ParsedNetlist, ErrorResult } from "../types.js";
import {
  DEFAULT_VARIANT,
  describeDefaultVariantRefusal,
  describeVariantChoices,
  quoteVariantNames,
  resolveVariantSelector,
} from "../parsers/variants.js";

/**
 * Normalize unconnected pins to "NC" (No Connect).
 */
const normalizeUnconnectedPins = (netlist: ParsedNetlist): void => {
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
};

/** A parsed design plus the design variant it was resolved for. */
export interface LoadedNetlist extends ParsedNetlist {
  design_variant: string;
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
 */
export const loadNetlist = async (
  designPath: string,
  designVariant?: string
): Promise<LoadedNetlist | ErrorResult> => {
  const normalizedPath = resolvePath(designPath);
  const handler = findHandler(normalizedPath);
  if (!handler) {
    const ext = path.extname(normalizedPath);
    return {
      error: `Unsupported design file format '${ext}'. Use list_designs() first.`,
    };
  }

  try {
    const variants = (await handler.listVariants?.(normalizedPath)) ?? [];
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

    const parsed = await parseDesign(normalizedPath, { variant: selection.selected });
    normalizeUnconnectedPins(parsed);
    return { design_variant: selection.selected, nets: parsed.nets, components: parsed.components };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error occurred";
    return { error: message };
  }
};
