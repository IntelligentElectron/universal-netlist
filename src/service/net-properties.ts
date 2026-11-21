import type { ParsedNetlist } from "../types.js";

/**
 * The design's own properties of the given nets, such as `DIFFERENTIAL_PAIR`
 * and `VOLTAGE`, for those that have any; undefined when none has.
 */
export const netPropertiesOf = (
  netlist: ParsedNetlist,
  nets: readonly string[]
): Record<string, Record<string, string>> | undefined => {
  const all = netlist.netProperties;
  if (!all) return undefined;
  const found = Object.fromEntries(
    [...new Set(nets)].filter((net) => Object.hasOwn(all, net)).map((net) => [net, all[net]])
  );
  return Object.keys(found).length > 0 ? found : undefined;
};
