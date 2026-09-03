import path from "node:path";

/** Schema version written by new Universal Netlist exports. */
export const UNIVERSAL_NETLIST_SCHEMA_VERSION = 2 as const;

/** Canonical suffix for an on-disk Universal Netlist document. */
export const UNIVERSAL_NETLIST_SUFFIX = ".netlist.json" as const;

/** Whether a path carries the canonical Universal Netlist suffix. */
export const isUniversalNetlistPath = (filePath: string): boolean =>
  filePath.toLowerCase().endsWith(UNIVERSAL_NETLIST_SUFFIX);

/** Basename of a Universal Netlist path without its canonical suffix. */
export const universalNetlistName = (filePath: string): string => {
  const basename = path.basename(filePath);
  return basename.slice(0, -UNIVERSAL_NETLIST_SUFFIX.length);
};
