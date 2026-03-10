import path from "path";
import { loadNetlist } from "../load-netlist.js";
import { groupComponentsByMpn } from "../component-grouping.js";
import { parseRegexPattern, tooManyMatchesError } from "../regex-helpers.js";
import { isErrorResult, type SearchComponentsResult, type ErrorResult } from "../../types.js";

/**
 * Search components by refdes pattern.
 *
 * @param pattern - Regex pattern
 * @param design - Path to design file
 * @param includeDns - Include DNS components
 */
export const searchComponentsByRefdes = async (
  pattern: string,
  design: string,
  includeDns = false
): Promise<SearchComponentsResult | ErrorResult> => {
  const parsed = parseRegexPattern(pattern, "i");
  if ("error" in parsed) return parsed;
  const regex = parsed.regex;

  const netlist = await loadNetlist(design);
  if (isErrorResult(netlist)) {
    return netlist;
  }

  const designName = path.basename(design, path.extname(design));
  const allEntries = Object.entries(netlist.components);
  const entries = allEntries.filter(([refdes]) => regex.test(refdes));

  if (entries.length > 0 && entries.length === allEntries.length) {
    return tooManyMatchesError(pattern, entries.length, "list_components");
  }

  const grouped = groupComponentsByMpn(entries, includeDns);

  if (grouped.length === 0) {
    return {
      results: { [designName]: [] },
      notes: [`No components matched refdes pattern '${pattern}'`],
    };
  }

  return { results: { [designName]: grouped } };
};

/**
 * Search components by MPN pattern.
 *
 * @param pattern - Regex pattern
 * @param design - Path to design file
 * @param includeDns - Include DNS components
 */
export const searchComponentsByMpn = async (
  pattern: string,
  design: string,
  includeDns = false
): Promise<SearchComponentsResult | ErrorResult> => {
  const parsed = parseRegexPattern(pattern, "i");
  if ("error" in parsed) return parsed;
  const regex = parsed.regex;

  const netlist = await loadNetlist(design);
  if (isErrorResult(netlist)) {
    return netlist;
  }

  const designName = path.basename(design, path.extname(design));
  const allComponents = Object.entries(netlist.components);
  const componentsWithMpn = allComponents.filter(([, c]) => c.mpn?.trim());
  const entries = componentsWithMpn.filter(([, component]) => regex.test(component.mpn!));

  // Case 1: No MPN data exists at all
  if (componentsWithMpn.length === 0) {
    return {
      results: { [designName]: [] },
      notes: ["This netlist has no MPN data. Ask user for BOM or schematic PDF"],
    };
  }

  if (entries.length > 0 && entries.length === componentsWithMpn.length) {
    return tooManyMatchesError(pattern, entries.length, "list_components");
  }

  const grouped = groupComponentsByMpn(entries, includeDns);

  // Case 2: MPN data exists but pattern didn't match
  if (grouped.length === 0) {
    return {
      results: { [designName]: [] },
      notes: [
        `No components matched pattern '${pattern}'. Try a broader pattern or use search_components_by_refdes instead`,
      ],
    };
  }

  return { results: { [designName]: grouped } };
};

/**
 * Search components by description pattern.
 *
 * @param pattern - Regex pattern
 * @param design - Path to design file
 * @param includeDns - Include DNS components
 */
export const searchComponentsByDescription = async (
  pattern: string,
  design: string,
  includeDns = false
): Promise<SearchComponentsResult | ErrorResult> => {
  const parsed = parseRegexPattern(pattern, "i");
  if ("error" in parsed) return parsed;
  const regex = parsed.regex;

  const netlist = await loadNetlist(design);
  if (isErrorResult(netlist)) {
    return netlist;
  }

  const designName = path.basename(design, path.extname(design));
  const allComponents = Object.entries(netlist.components);
  const componentsWithDescription = allComponents.filter(([, c]) => c.description?.trim());
  const entries = componentsWithDescription.filter(([, component]) =>
    regex.test(component.description!)
  );

  // Case 1: No description data exists at all
  if (componentsWithDescription.length === 0) {
    return {
      results: { [designName]: [] },
      notes: ["This netlist has no description data. Ask user for BOM or schematic PDF"],
    };
  }

  if (entries.length > 0 && entries.length === componentsWithDescription.length) {
    return tooManyMatchesError(pattern, entries.length, "list_components");
  }

  const grouped = groupComponentsByMpn(entries, includeDns);

  // Case 2: Description data exists but pattern didn't match
  if (grouped.length === 0) {
    return {
      results: { [designName]: [] },
      notes: [
        `No components matched pattern '${pattern}'. Try a broader pattern or use search_components_by_refdes instead`,
      ],
    };
  }

  return { results: { [designName]: grouped } };
};
