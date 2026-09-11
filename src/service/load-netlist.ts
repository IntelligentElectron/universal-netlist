import path from "path";
import { findHandler, parseDesign } from "../parsers/index.js";
import { resolvePath } from "../paths.js";
import type { ParsedNetlist, ErrorResult } from "../types.js";
import {
  DEFAULT_VARIANT,
  describeVariantChoices,
  findVariant,
  isDefaultVariant,
  quoteVariantNames,
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
 * A design that records native variants is refused without an explicit
 * `design_variant`, so a caller can never mistake one assembly for another.
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
          `Pass design_variant='${DEFAULT_VARIANT}' (alias 'default') for the unmodified/core design, ` +
          `or one of those names. list_designs() reports them under design_variants.`,
      };
    }

    // Passing the default explicitly matters for formats such as Cadence, whose
    // low-level parser retains a legacy "union of groups" mode for developer
    // coverage. Public queries must always describe one assembly.
    let selectedVariant = DEFAULT_VARIANT;
    if (requested && !isDefaultVariant(requested)) {
      const selected = findVariant(variants, requested);
      if (!selected) {
        return {
          error:
            `Design variant '${requested}' not found for design '${designName}'. ` +
            `Available: ${describeVariantChoices(variants)}.`,
        };
      }
      selectedVariant = selected.name;
    }

    const parsed = await parseDesign(normalizedPath, { variant: selectedVariant });
    normalizeUnconnectedPins(parsed);
    return { design_variant: selectedVariant, nets: parsed.nets, components: parsed.components };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error occurred";
    return { error: message };
  }
};
