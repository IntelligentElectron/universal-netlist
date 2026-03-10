import path from "path";
import { loadNetlist } from "../load-netlist.js";
import { groupComponentsByMpn } from "../component-grouping.js";
import { matchesRefdesType, getRefdesPrefix, isValidRefdes } from "../../circuit-traversal.js";
import { isErrorResult, type ListComponentsResult, type ErrorResult } from "../../types.js";

/**
 * List components of a specific type in a design.
 *
 * @param design - Path to design file
 * @param type - Component type prefix (e.g., "U", "R", "C")
 * @param includeDns - Include DNS (Do Not Stuff) components
 */
export const listComponents = async (
  design: string,
  type: string,
  includeDns = false
): Promise<ListComponentsResult | ErrorResult> => {
  const netlist = await loadNetlist(design);
  if (isErrorResult(netlist)) {
    return netlist;
  }

  const prefix = type.trim().toUpperCase();
  if (!prefix) {
    return { error: "Missing required parameter: type" };
  }

  const entries = Object.entries(netlist.components).filter(([refdes]) =>
    matchesRefdesType(refdes, prefix)
  );

  if (entries.length === 0) {
    const availablePrefixes = Array.from(
      new Set(Object.keys(netlist.components).filter(isValidRefdes).map(getRefdesPrefix))
    ).sort((a, b) => a.localeCompare(b));

    const designName = path.basename(design, path.extname(design));
    return {
      error: `No components with prefix '${prefix}' found in design '${designName}'. Available prefixes: [${availablePrefixes.join(", ")}]`,
    };
  }

  return {
    components: groupComponentsByMpn(entries, includeDns),
  };
};
