/**
 * Netlist Service
 *
 * Query methods for Cadence and Altium netlists using absolute paths.
 * All methods take an absolute path to the design FILE as input.
 */

import { exec } from "child_process";
import * as fs from "fs";
import path from "path";
import { promisify } from "util";
import { discoverDesigns, findHandler, parseDesign } from "./parsers/index.js";

// =============================================================================
// Path Normalization
// =============================================================================

/**
 * Normalize a file path to use native separators.
 * This ensures paths work correctly regardless of whether forward or
 * backward slashes are provided (important for cross-platform compatibility).
 *
 * On Windows, path.normalize() converts / to \
 * On Unix, we must manually convert \ to / since path.normalize() doesn't
 * (backslash is a valid filename character on Unix, but agents often send
 * Windows-style paths regardless of platform).
 *
 * Examples:
 *   Windows: "C:/Users/foo/bar" -> "C:\\Users\\foo\\bar"
 *   Unix: "\\Users\\foo\\bar" -> "/Users/foo/bar"
 */
const normalizePath = (inputPath: string): string => {
  if (process.platform === "win32") {
    return path.normalize(inputPath);
  }
  // On Unix, convert backslashes to forward slashes before normalizing
  return path.normalize(inputPath.replace(/\\/g, "/"));
};

import {
  naturalSort,
  traverseCircuitFromNet,
  computeCircuitHash,
  isDnsComponent,
  matchesRefdesType,
  getRefdesPrefix,
  isValidRefdes,
  isGroundNet,
} from "./circuit-traversal.js";
import {
  compactArray,
  getPinNet,
  isErrorResult,
  type ParsedNetlist,
  type ComponentDetails,
  type CircuitComponent,
  type AggregatedCircuitResult,
  type AggregatedComponent,
  type ErrorResult,
  type ComponentGroup,
  type ListComponentsResult,
  type ListNetsResult,
  type SearchComponentsResult,
  type SearchNetsResult,
  type QueryComponentResult,
  type CadenceInstall,
  type ExportNetlistResult,
} from "./types.js";

// =============================================================================
// Design Loading
// =============================================================================

/**
 * Normalize unconnected pins to "NC" (No Connect).
 */
const normalizeUnconnectedPins = (netlist: ParsedNetlist): void => {
  for (const component of Object.values(netlist.components)) {
    for (const [pin, net] of Object.entries(component.pins)) {
      if (typeof net === "string") {
        if (net === "") {
          component.pins[pin] = "NC";
        }
        continue;
      }

      if (net?.net === "") {
        net.net = "NC";
      }
    }
  }
};

/**
 * Load netlist from an absolute design file path.
 * Delegates to the appropriate handler based on file extension.
 */
export const loadNetlist = async (
  designPath: string,
): Promise<ParsedNetlist | ErrorResult> => {
  const normalizedPath = normalizePath(designPath);
  const handler = findHandler(normalizedPath);
  if (!handler) {
    const ext = path.extname(normalizedPath);
    return {
      error: `Unsupported design file format '${ext}'. Supported: .dsn, .cpm (Cadence), .PrjPcb (Altium)`,
    };
  }

  try {
    const parsed = await parseDesign(normalizedPath);
    normalizeUnconnectedPins(parsed);
    return parsed;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    return { error: message };
  }
};

// =============================================================================
// Component Grouping
// =============================================================================

const MPN_MISSING_NOTE =
  "MPN not found in exported netlist data. Tell user to update symbol properties in library, or to point you to the BOM";

/**
 * Group components by MPN for compact output.
 */
const groupComponentsByMpn = (
  entries: Array<[string, ComponentDetails[string]]>,
  includeDns: boolean,
): ComponentGroup[] => {
  const groups = new Map<
    string,
    {
      mpn: string | null;
      description?: string;
      comment?: string;
      value?: string;
      dns?: boolean;
      notes?: string[];
      refdes: string[];
    }
  >();

  for (const [refdes, component] of entries) {
    const dns = isDnsComponent(component);
    if (!includeDns && dns) {
      continue;
    }

    const mpnTrimmed = component.mpn?.trim() || null;
    const descriptionValue = component.description?.trim() || undefined;
    const commentValue = component.comment?.trim() || undefined;
    const valueValue = component.value?.trim() || undefined;

    const keyBase = mpnTrimmed ? `mpn:${mpnTrimmed}` : `refdes:${refdes}`;
    const groupKey = `${keyBase}||dns:${dns ? "1" : "0"}`;

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        mpn: mpnTrimmed,
        description: descriptionValue,
        comment: commentValue,
        value: valueValue,
        dns: dns || undefined,
        notes: mpnTrimmed ? undefined : [MPN_MISSING_NOTE],
        refdes: [],
      });
    } else if (valueValue && !groups.get(groupKey)!.value) {
      groups.get(groupKey)!.value = valueValue;
    }

    groups.get(groupKey)!.refdes.push(refdes);
  }

  return Array.from(groups.values())
    .map((group) => {
      const entry: ComponentGroup = {
        mpn: group.mpn,
        count: group.refdes.length,
        refdes: compactArray(group.refdes.sort(naturalSort)),
      };

      if (group.description !== undefined) {
        entry.description = group.description;
      }

      if (group.comment !== undefined) {
        entry.comment = group.comment;
      }

      if (group.value !== undefined) {
        entry.value = group.value;
      }

      if (group.dns !== undefined) {
        entry.dns = group.dns;
      }

      if (group.notes !== undefined) {
        entry.notes = group.notes;
      }

      return entry;
    })
    .sort((a, b) => (a.mpn ?? "").localeCompare(b.mpn ?? ""));
};

/**
 * Aggregate circuit components by MPN for compact output.
 */
const aggregateCircuitByMpn = (
  components: CircuitComponent[],
): AggregatedCircuitResult["components_by_mpn"] => {
  const groups = new Map<
    string,
    {
      mpn: string | null;
      description?: string;
      comment?: string;
      value?: string;
      dns?: boolean;
      notes?: string[];
      orientations: Map<
        string,
        {
          count: number;
          refdes: string[];
          connections: Array<{ net: string; pins: string[] }>;
        }
      >;
    }
  >();

  const unaggregatable: typeof components = [];

  for (const comp of components) {
    const mpn = comp.mpn?.trim() || null;
    const description = comp.description?.trim() || "";
    const value = comp.value?.trim() || undefined;
    const dnsFlag = comp.dns ? true : undefined;

    let aggregationKey: string;
    if (mpn) {
      aggregationKey = `mpn:${mpn}`;
    } else if (description) {
      aggregationKey = `desc:${description}`;
    } else {
      unaggregatable.push(comp);
      continue;
    }

    const nets = comp.connections.map((p) => p.net);
    const netPair = [...nets].sort().join("|");
    const groupKey = `${aggregationKey}||${netPair}||dns:${dnsFlag ? "1" : "0"}`;

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        mpn,
        description: description || undefined,
        comment: comp.comment,
        value,
        dns: dnsFlag,
        notes: mpn ? undefined : [MPN_MISSING_NOTE],
        orientations: new Map(),
      });
    } else if (value && !groups.get(groupKey)!.value) {
      groups.get(groupKey)!.value = value;
    }

    const orientationKey = comp.connections
      .map((p) => `${p.pins.join(",")}:${p.net}`)
      .join("|");
    const group = groups.get(groupKey)!;

    if (!group.orientations.has(orientationKey)) {
      group.orientations.set(orientationKey, {
        count: 0,
        refdes: [],
        connections: comp.connections,
      });
    }

    const orientation = group.orientations.get(orientationKey)!;
    orientation.count++;
    if (comp.refdes) {
      orientation.refdes.push(comp.refdes);
    }
  }

  const compactConnections = (
    connections: Array<{ net: string; pins: string[] }>,
  ) => connections.map((c) => ({ net: c.net, pins: compactArray(c.pins) }));

  const result: AggregatedComponent[] = [];

  for (const group of groups.values()) {
    const orientationsList = Array.from(group.orientations.values()).sort(
      (a, b) => b.count - a.count,
    );

    const totalCount = orientationsList.reduce((sum, o) => sum + o.count, 0);

    const aggregated: AggregatedComponent = {
      mpn: group.mpn,
      total_count: totalCount,
    };

    if (group.description !== undefined) {
      aggregated.description = group.description;
    }
    if (group.comment !== undefined) {
      aggregated.comment = group.comment;
    }
    if (group.value !== undefined) {
      aggregated.value = group.value;
    }
    if (group.dns !== undefined) {
      aggregated.dns = group.dns;
    }
    if (group.notes !== undefined) {
      aggregated.notes = group.notes;
    }

    if (orientationsList.length === 1) {
      aggregated.refdes = compactArray(
        orientationsList[0].refdes.sort(naturalSort),
      );
      aggregated.connections = compactConnections(
        orientationsList[0].connections,
      );
    } else {
      aggregated.orientations = orientationsList.map((o) => ({
        count: o.count,
        refdes: compactArray(o.refdes.sort(naturalSort)),
        connections: compactConnections(o.connections),
      }));
    }

    result.push(aggregated);
  }

  for (const comp of unaggregatable) {
    const unagg: AggregatedComponent = {
      refdes: comp.refdes,
      mpn: null,
      notes: [MPN_MISSING_NOTE],
      total_count: 1,
      connections: compactConnections(comp.connections),
    };

    if (comp.description !== undefined) {
      unagg.description = comp.description;
    }
    if (comp.comment !== undefined) {
      unagg.comment = comp.comment;
    }
    if (comp.value !== undefined) {
      unagg.value = comp.value;
    }
    if (comp.dns) {
      unagg.dns = true;
    }

    result.push(unagg);
  }

  return result.sort((a, b) => b.total_count - a.total_count);
};

// =============================================================================
// Public API
// =============================================================================

/**
 * List all designs in a directory.
 *
 * @param searchPath - Absolute path to search (defaults to CWD)
 * @param pattern - Regex pattern to filter design names
 */
export const listDesigns = async (
  searchPath?: string,
  pattern = ".*",
): Promise<
  Array<{ name: string; path: string; error?: string }> | ErrorResult
> => {
  const resolvedPath = normalizePath(searchPath ?? process.cwd());

  let regex: RegExp;
  try {
    regex = new RegExp(pattern);
  } catch {
    return { error: `Invalid regex pattern '${pattern}'` };
  }

  const designs = await discoverDesigns(resolvedPath);
  return designs
    .filter((design) => regex.test(design.name))
    .map((design) => ({
      name: design.name,
      path: design.sourcePath,
      error: design.error,
    }));
};

/**
 * List components of a specific type in a design.
 *
 * @param design - Absolute path to design file
 * @param type - Component type prefix (e.g., "U", "R", "C")
 * @param includeDns - Include DNS (Do Not Stuff) components
 */
export const listComponents = async (
  design: string,
  type: string,
  includeDns = false,
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
    matchesRefdesType(refdes, prefix),
  );

  if (entries.length === 0) {
    const availablePrefixes = Array.from(
      new Set(
        Object.keys(netlist.components)
          .filter(isValidRefdes)
          .map(getRefdesPrefix),
      ),
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

/**
 * List all nets within a design.
 *
 * @param design - Absolute path to design file
 */
export const listNets = async (
  design: string,
): Promise<ListNetsResult | ErrorResult> => {
  const netlist = await loadNetlist(design);
  if (isErrorResult(netlist)) {
    return netlist;
  }

  const nets = Object.keys(netlist.nets).sort((a, b) => a.localeCompare(b));
  return { nets };
};

/**
 * Search nets by regex pattern.
 *
 * @param pattern - Regex pattern
 * @param design - Absolute path to design file
 */
export const searchNets = async (
  pattern: string,
  design: string,
): Promise<SearchNetsResult | ErrorResult> => {
  let regex: RegExp;
  try {
    regex = new RegExp(pattern);
  } catch {
    return { error: `Invalid regex pattern '${pattern}'` };
  }

  const netlist = await loadNetlist(design);
  if (isErrorResult(netlist)) {
    return netlist;
  }

  const designName = path.basename(design, path.extname(design));
  const nets = Object.keys(netlist.nets).filter((net) => regex.test(net));
  const sorted = nets.sort((a, b) => a.localeCompare(b));

  if (sorted.length === 0) {
    return {
      results: { [designName]: [] },
      notes: [`No nets matched pattern '${pattern}'`],
    };
  }

  return { results: { [designName]: sorted } };
};

/**
 * Search components by refdes pattern.
 *
 * @param pattern - Regex pattern
 * @param design - Absolute path to design file
 * @param includeDns - Include DNS components
 */
export const searchComponentsByRefdes = async (
  pattern: string,
  design: string,
  includeDns = false,
): Promise<SearchComponentsResult | ErrorResult> => {
  // TODO: Support (?i) inline flag for case-insensitive matching
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, "i");
  } catch {
    return { error: `Invalid regex pattern '${pattern}'` };
  }

  const netlist = await loadNetlist(design);
  if (isErrorResult(netlist)) {
    return netlist;
  }

  const designName = path.basename(design, path.extname(design));
  const entries = Object.entries(netlist.components).filter(([refdes]) =>
    regex.test(refdes),
  );

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
 * @param design - Absolute path to design file
 * @param includeDns - Include DNS components
 */
export const searchComponentsByMpn = async (
  pattern: string,
  design: string,
  includeDns = false,
): Promise<SearchComponentsResult | ErrorResult> => {
  // TODO: Support (?i) inline flag for case-insensitive matching
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, "i");
  } catch {
    return { error: `Invalid regex pattern '${pattern}'` };
  }

  const netlist = await loadNetlist(design);
  if (isErrorResult(netlist)) {
    return netlist;
  }

  const designName = path.basename(design, path.extname(design));
  const allComponents = Object.entries(netlist.components);
  const componentsWithMpn = allComponents.filter(([, c]) => c.mpn?.trim());
  const entries = componentsWithMpn.filter(([, component]) =>
    regex.test(component.mpn!),
  );

  const grouped = groupComponentsByMpn(entries, includeDns);

  // Case 1: No MPN data exists at all
  if (componentsWithMpn.length === 0) {
    return {
      results: { [designName]: [] },
      notes: [
        "This netlist has no MPN data. Ask user for BOM or schematic PDF",
      ],
    };
  }

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
 * @param design - Absolute path to design file
 * @param includeDns - Include DNS components
 */
export const searchComponentsByDescription = async (
  pattern: string,
  design: string,
  includeDns = false,
): Promise<SearchComponentsResult | ErrorResult> => {
  // TODO: Support (?i) inline flag for case-insensitive matching
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, "i");
  } catch {
    return { error: `Invalid regex pattern '${pattern}'` };
  }

  const netlist = await loadNetlist(design);
  if (isErrorResult(netlist)) {
    return netlist;
  }

  const designName = path.basename(design, path.extname(design));
  const allComponents = Object.entries(netlist.components);
  const componentsWithDescription = allComponents.filter(([, c]) =>
    c.description?.trim(),
  );
  const entries = componentsWithDescription.filter(([, component]) =>
    regex.test(component.description!),
  );

  const grouped = groupComponentsByMpn(entries, includeDns);

  // Case 1: No description data exists at all
  if (componentsWithDescription.length === 0) {
    return {
      results: { [designName]: [] },
      notes: [
        "This netlist has no description data. Ask user for BOM or schematic PDF",
      ],
    };
  }

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

/**
 * Query component details by reference designator.
 *
 * @param design - Absolute path to design file
 * @param refdes - Component reference designator
 */
export const queryComponent = async (
  design: string,
  refdes: string,
): Promise<QueryComponentResult | ErrorResult> => {
  const netlist = await loadNetlist(design);
  if (isErrorResult(netlist)) {
    return netlist;
  }

  const targetRefdes = refdes.trim();
  const componentEntry = Object.entries(netlist.components).find(
    ([key]) => key.toLowerCase() === targetRefdes.toLowerCase(),
  );

  if (!componentEntry) {
    const designName = path.basename(design, path.extname(design));
    return {
      error: `Component '${refdes}' not found in design '${designName}'. Use list_components() or search_components_by_refdes() to find available components.`,
    };
  }

  const [resolvedRefdes, component] = componentEntry;
  const mpn = component.mpn?.trim() || null;
  const dns = isDnsComponent(component);

  const result: QueryComponentResult = {
    refdes: resolvedRefdes,
    mpn,
    pins: component.pins,
  };

  if (component.description !== undefined) {
    result.description = component.description;
  }
  if (component.comment !== undefined) {
    result.comment = component.comment;
  }
  if (component.value !== undefined) {
    result.value = component.value;
  }
  if (dns) {
    result.dns = true;
  }
  if (!mpn) {
    result.notes = [MPN_MISSING_NOTE];
  }

  return result;
};

/**
 * Query circuit starting from a net name.
 *
 * @param design - Absolute path to design file
 * @param netName - Net name
 * @param skipTypes - Component types to skip
 * @param includeDns - Include DNS components
 */
export const queryXnetByNetName = async (
  design: string,
  netName: string,
  skipTypes: string[] = [],
  includeDns = false,
): Promise<AggregatedCircuitResult | ErrorResult> => {
  const netlist = await loadNetlist(design);
  if (isErrorResult(netlist)) {
    return netlist;
  }

  const { nets, components } = netlist;

  if (!nets[netName]) {
    const designName = path.basename(design, path.extname(design));
    return {
      error: `Net '${netName}' not found in design '${designName}'. Use search_nets() to find available nets.`,
    };
  }

  if (isGroundNet(netName)) {
    return {
      error: `${netName} is a ground net and cannot be queried.`,
    };
  }

  const traversal = traverseCircuitFromNet(netName, nets, components, {
    skipTypes,
    includeDns,
  });

  const circuitHash = computeCircuitHash(traversal.components);
  const aggregated = aggregateCircuitByMpn(traversal.components);

  const response: AggregatedCircuitResult = {
    starting_point: netName,
    total_components: traversal.components.length,
    unique_configurations: aggregated.length,
    components_by_mpn: aggregated,
    visited_nets: traversal.visited_nets,
    circuit_hash: circuitHash,
  };

  if (Object.keys(traversal.skipped).length > 0) {
    response.skipped = traversal.skipped;
  }

  return response;
};

/**
 * Query circuit starting from a component pin.
 *
 * @param design - Absolute path to design file
 * @param pinSpec - Pin specification in "REFDES.PIN" format
 * @param skipTypes - Component types to skip
 * @param includeDns - Include DNS components
 */
export const queryXnetByPinName = async (
  design: string,
  pinSpec: string,
  skipTypes: string[] = [],
  includeDns = false,
): Promise<AggregatedCircuitResult | ErrorResult> => {
  const netlist = await loadNetlist(design);
  if (isErrorResult(netlist)) {
    return netlist;
  }

  const parts = pinSpec.split(".");
  if (parts.length !== 2) {
    return {
      error: `Invalid pin name '${pinSpec}'. Expected 'REFDES.PIN'.`,
    };
  }

  const [refdesInput, pinInput] = parts;
  const refdesEntry = Object.entries(netlist.components).find(
    ([refdes]) => refdes.toLowerCase() === refdesInput.trim().toLowerCase(),
  );

  if (!refdesEntry) {
    const designName = path.basename(design, path.extname(design));
    return {
      error: `Component '${refdesInput}' not found in design '${designName}'. Use list_components() or search_components_by_refdes() to find available components.`,
    };
  }

  const [resolvedRefdes, component] = refdesEntry;
  const pinKey = Object.keys(component.pins).find(
    (pin) => pin.toLowerCase() === pinInput.trim().toLowerCase(),
  );

  if (!pinKey) {
    const pins = Object.keys(component.pins).sort(naturalSort);
    return {
      error: `Pin '${pinSpec}' not found. Component ${resolvedRefdes} has pins: [${pins.join(", ")}]`,
    };
  }

  const connectedNet = getPinNet(component.pins[pinKey]);

  if (isGroundNet(connectedNet)) {
    return {
      error: `Pin ${resolvedRefdes}.${pinKey} is connected to ${connectedNet} (ground) and cannot be queried.`,
    };
  }

  if (connectedNet === "NC") {
    return {
      starting_point: `${resolvedRefdes}.${pinKey}`,
      net: "NC",
      total_components: 0,
      unique_configurations: 0,
      components_by_mpn: [],
      visited_nets: ["NC"],
      circuit_hash: `nc-${resolvedRefdes}.${pinKey}`,
    };
  }

  const { nets, components } = netlist;
  const traversal = traverseCircuitFromNet(connectedNet, nets, components, {
    skipTypes,
    includeDns,
  });

  const circuitHash = computeCircuitHash(traversal.components);
  const aggregated = aggregateCircuitByMpn(traversal.components);

  const response: AggregatedCircuitResult = {
    starting_point: `${resolvedRefdes}.${pinKey}`,
    net: connectedNet,
    total_components: traversal.components.length,
    unique_configurations: aggregated.length,
    components_by_mpn: aggregated,
    visited_nets: traversal.visited_nets,
    circuit_hash: circuitHash,
  };

  if (Object.keys(traversal.skipped).length > 0) {
    response.skipped = traversal.skipped;
  }

  return response;
};

// =============================================================================
// Cadence Netlist Export (Windows Only)
// =============================================================================

const execAsync = promisify(exec);

/**
 * Convert Windows path to bash-compatible path for GitBash/WSL compatibility.
 * Example: C:\foo\bar -> /c/foo/bar
 */
const toBashPath = (winPath: string): string =>
  winPath
    .replace(/\\/g, "/")
    .replace(/^([A-Za-z]):/, (_, drive: string) => `/${drive.toLowerCase()}`);

/**
 * Detect installed Cadence SPB versions from the standard installation directory.
 *
 * @param cadenceBase - Base Cadence installation directory (default: C:/Cadence)
 * @returns Array of detected Cadence installations, sorted by version descending
 */
export const detectCadenceVersions = async (
  cadenceBase = "C:/Cadence",
): Promise<CadenceInstall[]> => {
  const installs: CadenceInstall[] = [];

  try {
    const entries = await fs.promises.readdir(cadenceBase);

    for (const entry of entries) {
      const match = entry.match(/^SPB_(\d+\.\d+)$/);
      if (!match) continue;

      const version = match[1];
      const root = path.join(cadenceBase, entry);
      const pstswp = path.join(root, "tools", "bin", "pstswp.exe");
      const config = path.join(root, "tools", "capture", "allegro.cfg");

      // Verify the executables exist
      if (fs.existsSync(pstswp) && fs.existsSync(config)) {
        installs.push({ version, root, pstswp, config });
      }
    }

    // Sort by version descending (latest first)
    installs.sort((a, b) => parseFloat(b.version) - parseFloat(a.version));
  } catch {
    // Cadence directory doesn't exist or isn't accessible
  }

  return installs;
};

/**
 * Get the latest installed Cadence version.
 *
 * @returns The latest Cadence installation, or null if none found
 */
export const getLatestCadence = async (): Promise<CadenceInstall | null> => {
  const versions = await detectCadenceVersions();
  return versions[0] ?? null;
};

/**
 * Export Cadence schematic netlist to Allegro PCB format.
 * Uses the pstswp utility from Cadence SPB installation.
 *
 * @param dsnPath - Absolute path to .DSN schematic file
 * @returns Export result with output directory and generated files, or error
 */
export const exportCadenceNetlist = async (
  dsnPath: string,
): Promise<ExportNetlistResult | ErrorResult> => {
  // Platform check
  if (process.platform !== "win32") {
    return {
      error:
        "Cadence export tools are only available on Windows. The pstswp utility requires a Windows environment with Cadence SPB installed. Manual export: Open Cadence, then: Tools → Create Netlist → PCB Editor format.",
    };
  }

  // Find Cadence installation
  const cadence = await getLatestCadence();
  if (!cadence) {
    return {
      error:
        "No Cadence SPB installation found in C:/Cadence. Ensure Cadence Design Entry CIS or HDL is installed. Manual export: Open Cadence, then: Tools → Create Netlist → PCB Editor format.",
    };
  }

  const dsnDir = path.dirname(dsnPath);
  const dsnFile = path.basename(dsnPath);
  const outputDir = path.join(dsnDir, "Allegro");

  // Convert to bash paths for command execution (GitBash compatibility)
  const bashDsnDir = toBashPath(dsnDir);
  const pstswp = toBashPath(cadence.pstswp);
  const config = toBashPath(cadence.config);

  const command = `cd "${bashDsnDir}" && "${pstswp}" -pst -d "${dsnFile}" -n "Allegro" -c "${config}" -v 3 -l 255 -j "PCB Footprint"`;

  try {
    const { stdout, stderr } = await execAsync(command, {
      shell: "bash",
      timeout: 120000,
    });

    // List generated files
    let generatedFiles: string[] | undefined;
    try {
      const files = await fs.promises.readdir(outputDir);
      generatedFiles = files.sort();
    } catch {
      // Output directory may not exist if export failed silently
    }

    return {
      success: true,
      outputDir,
      log: (stdout + stderr).trim() || undefined,
      cadenceVersion: cadence.version,
      generatedFiles,
    };
  } catch (err: unknown) {
    const execError = err as {
      message?: string;
      stdout?: string;
      stderr?: string;
    };
    return {
      error: `Cadence pstswp failed: ${execError.message ?? "Unknown error"}`,
    };
  }
};

// =============================================================================
// Test Exports
// =============================================================================

/**
 * Internal exports for testing purposes only.
 * @internal
 */
export { MPN_MISSING_NOTE, groupComponentsByMpn, aggregateCircuitByMpn };
