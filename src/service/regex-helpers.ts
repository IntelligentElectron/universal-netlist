import type { ErrorResult } from "../types.js";

/**
 * Parse PCRE-style inline flags from a regex pattern and convert to JS RegExp flags.
 * Supports (?i), (?m), (?s), (?u) and combinations like (?im) at the start of the pattern.
 */
export const parseRegexPattern = (
  pattern: string,
  defaultFlags = ""
): { regex: RegExp } | { error: string } => {
  let flags = defaultFlags;
  let cleanPattern = pattern;

  const inlineFlagMatch = cleanPattern.match(/^\(\?([imsu]+)\)/);
  if (inlineFlagMatch) {
    cleanPattern = cleanPattern.slice(inlineFlagMatch[0].length);
    const allFlags = new Set([...flags, ...inlineFlagMatch[1]]);
    flags = [...allFlags].filter((f) => "gimsuvy".includes(f)).join("");
  }

  try {
    return { regex: new RegExp(cleanPattern, flags) };
  } catch {
    return { error: `Invalid regex pattern '${pattern}'` };
  }
};

/**
 * Return an error when a search pattern matches every item in the dataset.
 * This prevents wildcard patterns (e.g. `.*`) from dumping the full list.
 */
export const tooManyMatchesError = (
  pattern: string,
  matchCount: number,
  toolSuggestion: string
): ErrorResult => ({
  error: `Pattern '${pattern}' matched all ${matchCount} items. Use ${toolSuggestion} to retrieve the full list, or use a more specific pattern.`,
});
