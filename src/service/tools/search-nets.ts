import { getDesignName } from "../../paths.js";
import { loadNetlist } from "../load-netlist.js";
import { parseRegexPattern, tooManyMatchesError } from "../regex-helpers.js";
import { isErrorResult, type SearchNetsResult, type ErrorResult } from "../../types.js";

/**
 * Search nets by regex pattern.
 *
 * @param pattern - Regex pattern
 * @param design - Path to design file
 * @param designVariant - Native design variant, or `<Default>` for the core design
 */
export const searchNets = async (
  pattern: string,
  design: string,
  designVariant?: string
): Promise<SearchNetsResult | ErrorResult> => {
  const parsed = parseRegexPattern(pattern, "i");
  if ("error" in parsed) return parsed;
  const regex = parsed.regex;

  const netlist = await loadNetlist(design, designVariant);
  if (isErrorResult(netlist)) {
    return netlist;
  }

  const designName = getDesignName(design);
  const allNets = Object.keys(netlist.nets);
  const nets = allNets.filter((net) => regex.test(net));

  if (nets.length > 0 && nets.length === allNets.length) {
    return tooManyMatchesError(pattern, nets.length, "list_nets");
  }

  const sorted = nets.sort((a, b) => a.localeCompare(b));

  if (sorted.length === 0) {
    return {
      design_variant: netlist.design_variant,
      results: { [designName]: [] },
      notes: [`No nets matched pattern '${pattern}'`],
    };
  }

  return { design_variant: netlist.design_variant, results: { [designName]: sorted } };
};
