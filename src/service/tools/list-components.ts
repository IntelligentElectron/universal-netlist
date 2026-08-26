import { getDesignName } from "../../paths.js";
import { loadNetlist } from "../load-netlist.js";
import { groupComponentsByMpn } from "../component-grouping.js";
import { matchesRefdesType, getRefdesPrefix } from "../../circuit-traversal.js";
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
  const designName = getDesignName(design);

  if (entries.length === 0) {
    // Derive the suggestion list with the same prefix logic the matcher uses
    // (getRefdesPrefix), so it can never contradict a query. Filtering to
    // purely-alphabetic prefixes drops Cadence-path junk ("@DESIGN…") and
    // numeric-only keys, while keeping unannotated refdes ("C?" -> "C").
    //
    // A prefix is suggested only if querying it with the same include_dns
    // would return something. A prefix whose every part is DNS is listed
    // apart, with the argument that reaches it, so the suggestion never
    // points at a query that comes back empty.
    const stuffed = new Set<string>();
    const dnsOnly = new Set<string>();
    for (const [refdes, component] of Object.entries(netlist.components)) {
      const candidate = getRefdesPrefix(refdes);
      if (!/^[A-Z]+$/.test(candidate)) continue;
      if (includeDns || !component.dns) stuffed.add(candidate);
      else dnsOnly.add(candidate);
    }
    for (const candidate of stuffed) dnsOnly.delete(candidate);
    const sorted = (set: Set<string>): string =>
      [...set].sort((a, b) => a.localeCompare(b)).join(", ");

    const dnsClause =
      dnsOnly.size > 0
        ? ` Prefixes whose components are all DNS, listed only with include_dns=true: [${sorted(dnsOnly)}]`
        : "";
    return {
      error: `No components with prefix '${prefix}' found in design '${designName}'. Available prefixes: [${sorted(stuffed)}]${dnsClause}`,
    };
  }

  const components = groupComponentsByMpn(entries, includeDns);

  // The prefix exists, and every part under it is DNS. An empty list here
  // reads as "the design has none", which is the opposite of the truth, so
  // the result says what it left out and how to see it.
  if (components.length === 0) {
    return {
      components,
      notes: [
        `All ${entries.length} components with prefix '${prefix}' in design '${designName}' are DNS (Do Not Stuff) and were left out. Pass include_dns=true to list them.`,
      ],
    };
  }

  return { components };
};
