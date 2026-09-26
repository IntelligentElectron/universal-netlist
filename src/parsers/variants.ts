import type { DesignVariant } from "../types.js";

/**
 * Cross-format spelling for a design's base build: the design with every part's
 * own Do Not Stuff state honoured and no named variant applied. It is the one
 * build of a design that declares no variants. A design that declares variants
 * has only those to build: no vendor's file marks the bare design as an
 * assembly, and in practice its variants carry the parts left off the board
 * while the bare design has everything fitted. Selecting `<Default>` on such a
 * design is refused, and `list_designs` leaves it out.
 */
export const DEFAULT_VARIANT = "<Default>";

/** Whether a selector is the literal `<Default>`, a name no design declares as a variant. */
export const isDefaultVariantLiteral = (name: string): boolean =>
  name.trim().toLowerCase() === DEFAULT_VARIANT.toLowerCase();

/** Spellings a caller may use for the base build. `default` is the plain alias. */
const DEFAULT_ALIASES = new Set([DEFAULT_VARIANT.toLowerCase(), "default"]);

/** Whether a requested selector spells the base build, by its literal or its alias. */
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

/** A resolved selector: the canonical name to parse with, and the declared variant when it names one. */
export interface VariantSelection {
  /** `<Default>`, or the declared variant's own spelling. */
  selected: string;
  native?: DesignVariant;
}

/**
 * Resolve a caller's selector against the variants a design declares.
 *
 * A declared name wins over the plain alias, so a design whose own variant is
 * called `default` keeps it reachable. The literal `<Default>` is reserved for
 * the base build and never resolves to a declared name.
 */
export const resolveVariantSelector = (
  variants: readonly DesignVariant[],
  requested: string
): VariantSelection | undefined => {
  if (isDefaultVariantLiteral(requested)) return { selected: DEFAULT_VARIANT };
  const native = findVariant(variants, requested);
  if (native) return { selected: native.name, native };
  if (isDefaultVariant(requested)) return { selected: DEFAULT_VARIANT };
  return undefined;
};

/** Quote every name so a variant called `0` reads as a name and not a count. */
export const quoteVariantNames = (variants: readonly DesignVariant[]): string =>
  `[${variants.map((variant) => `'${variant.name}'`).join(", ")}]`;

/** The selectable names: the declared variants, or the base build of a design that declares none. */
export const describeVariantChoices = (variants: readonly DesignVariant[]): string =>
  quoteVariantNames(variants.length > 0 ? variants : [{ name: DEFAULT_VARIANT }]);

/**
 * Why `<Default>` is refused on a design that declares variants.
 *
 * With a design name, the sentence is for a tool result and names the argument
 * to pass; without one, it is for a parser called directly.
 */
export const describeDefaultVariantRefusal = (
  variants: readonly DesignVariant[],
  designName?: string
): string =>
  `'${DEFAULT_VARIANT}' is not a build of ${designName ? `design '${designName}'` : "this design"}: ` +
  `its variants ${quoteVariantNames(variants)} are the assemblies it records, and nothing in ` +
  `the design marks the bare schematic as one. ` +
  (designName ? "Pass design_variant as one of those names." : "Select one of those names.");

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
