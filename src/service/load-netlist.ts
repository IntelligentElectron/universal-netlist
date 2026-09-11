import path from "path";
import { findHandler, parseDesign } from "../parsers/index.js";
import { resolvePath } from "../paths.js";
import type { ParsedNetlist, ErrorResult } from "../types.js";
import { DEFAULT_VARIANT, findVariant, isDefaultVariant } from "../parsers/variants.js";

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

/**
 * Load netlist from a design file path.
 * Delegates to the appropriate handler based on file extension.
 */
export const loadNetlist = async (
  designPath: string,
  variant?: string
): Promise<ParsedNetlist | ErrorResult> => {
  const normalizedPath = resolvePath(designPath);
  const handler = findHandler(normalizedPath);
  if (!handler) {
    const ext = path.extname(normalizedPath);
    return {
      error: `Unsupported design file format '${ext}'. Supported: .dsn (Cadence), .PrjPcb, .SchDoc (Altium), .kicad_pro, .kicad_sch (KiCad), .netlist.json (Universal Netlist)`,
    };
  }

  try {
    const variants = (await handler.listVariants?.(normalizedPath)) ?? [];
    const requested = variant?.trim();
    if (!requested && variants.length > 0) {
      return {
        error:
          `Design '${path.basename(normalizedPath)}' defines assembly variants ` +
          `[${variants.map((item) => item.name).join(", ")}]. Pass variant='${DEFAULT_VARIANT}' ` +
          `for the unmodified/core design, or choose one of those names. Use list_variants() to inspect them.`,
      };
    }

    // Passing the default explicitly matters for formats such as Cadence, whose
    // low-level parser retains a legacy "union of groups" mode for developer
    // coverage. Public queries must always describe one assembly.
    let selectedVariant: string | undefined = requested ? undefined : DEFAULT_VARIANT;
    if (requested) {
      if (isDefaultVariant(requested)) {
        selectedVariant = DEFAULT_VARIANT;
      } else {
        const selected = findVariant(variants, requested);
        if (!selected) {
          return {
            error:
              `Variant '${requested}' not found for design '${path.basename(normalizedPath)}'. ` +
              `Available variants: [${variants.map((item) => item.name).join(", ")}], ${DEFAULT_VARIANT}. ` +
              `Use list_variants() to inspect them.`,
          };
        }
        selectedVariant = selected.name;
      }
    }

    const parsed = await parseDesign(normalizedPath, { variant: selectedVariant });
    normalizeUnconnectedPins(parsed);
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error occurred";
    return { error: message };
  }
};
