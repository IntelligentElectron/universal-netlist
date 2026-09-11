import type { DesignVariant } from "../types.js";

/** Cross-format spelling for the unmodified/core design. */
export const DEFAULT_VARIANT = "<Default>";

/** Whether a requested selector names the unmodified/core design. */
export const isDefaultVariant = (name: string): boolean =>
  name.trim().toLowerCase() === DEFAULT_VARIANT.toLowerCase();

/** Find the canonical native spelling of a variant name. */
export const findVariant = (
  variants: readonly DesignVariant[],
  requested: string
): DesignVariant | undefined => {
  const normalized = requested.trim().toLowerCase();
  return variants.find((variant) => variant.name.toLowerCase() === normalized);
};

/** Stable, case-insensitive de-duplication for names gathered from many instances. */
export const uniqueVariants = (variants: readonly DesignVariant[]): DesignVariant[] => {
  const seen = new Set<string>();
  return variants.filter((variant) => {
    const key = variant.name.toLowerCase();
    if (!variant.name.trim() || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
