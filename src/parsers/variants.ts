import type { DesignVariant } from "../types.js";

/** Cross-format spelling for the unmodified/core design. */
export const DEFAULT_VARIANT = "<Default>";

/** Spellings a caller may use for the core design. `default` is the plain alias. */
const DEFAULT_ALIASES = new Set([DEFAULT_VARIANT.toLowerCase(), "default"]);

/** Whether a requested selector names the unmodified/core design. */
export const isDefaultVariant = (name: string): boolean =>
  DEFAULT_ALIASES.has(name.trim().toLowerCase());

/** Find the canonical native spelling of a variant name. */
export const findVariant = (
  variants: readonly DesignVariant[],
  requested: string
): DesignVariant | undefined => {
  const normalized = requested.trim().toLowerCase();
  return variants.find((variant) => variant.name.toLowerCase() === normalized);
};

/** Quote every name so a variant called `0` reads as a name and not a count. */
export const quoteVariantNames = (variants: readonly DesignVariant[]): string =>
  `[${variants.map((variant) => `'${variant.name}'`).join(", ")}]`;

/** The selectable names: every native variant, then the core design that is always valid. */
export const describeVariantChoices = (variants: readonly DesignVariant[]): string =>
  quoteVariantNames([...variants, { name: DEFAULT_VARIANT }]);

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
