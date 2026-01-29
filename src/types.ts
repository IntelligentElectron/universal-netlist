/**
 * TypeScript type definitions for netlist parsing and circuit analysis
 */

// Import format-specific discovered design types from their parsers
import type { CadenceDiscoveredDesign } from "./parsers/cadence/discovery.js";
import type { AltiumDiscoveredDesign } from "./parsers/altium/discovery.js";

/**
 * Compact single-element arrays to scalar values for token savings.
 * Returns the single element if array has length 1, otherwise returns the array.
 */
export const compactArray = <T>(arr: T[]): T | T[] =>
  arr.length === 1 ? arr[0] : arr;

/**
 * Net connections from netlist
 * Format: { netName: { refdes: pinNumber(s) } }
 * Pin values can be a single string or array of strings
 */
export interface NetConnections {
  [netName: string]: {
    [refdes: string]: string | string[];
  };
}

/**
 * Pin entry for component pin mappings.
 * Uses a string net name for simple pins, or an object when pin name adds meaning.
 */
export type PinEntry = string | { name: string; net: string };

/**
 * Create a pin entry, using an object only when the pin name differs from the pin number.
 */
export const createPinEntry = (
  pinNumber: string,
  pinName: string | undefined,
  netName: string,
): PinEntry => {
  const normalizedName = pinName?.trim();
  if (normalizedName && normalizedName !== pinNumber) {
    return { name: normalizedName, net: netName };
  }
  return netName;
};

/**
 * Extract the net name from a pin entry.
 */
export const getPinNet = (entry: PinEntry): string =>
  typeof entry === "string" ? entry : entry.net;

/**
 * Component details from netlist
 */
export interface ComponentDetails {
  [refdes: string]: {
    mpn?: string | null;
    description?: string;
    comment?: string;
    value?: string;
    pins: Record<string, PinEntry>;
  };
}

/**
 * Parsed netlist data cached in memory
 */
export interface ParsedNetlist {
  nets: NetConnections;
  components: ComponentDetails;
}

/**
 * Component in circuit query result
 */
export interface CircuitComponent {
  refdes: string;
  type?: string;
  mpn?: string | null;
  description?: string;
  comment?: string;
  value?: string;
  dns?: boolean;
  connections: Array<{
    net: string;
    pins: string[];
  }>;
}

/**
 * Result from circuit query methods (by net or pin)
 */
export interface CircuitResult {
  starting_point: string;
  components: CircuitComponent[];
  visited_nets: string[];
}

/**
 * Error result structure
 */
export interface ErrorResult {
  error: string;
}

/**
 * Pin-to-net connection (pins grouped by net)
 */
export interface PinNetConnection {
  net: string;
  pins: string | string[];
}

/**
 * Orientation variant for 2-pin components (tracks polarity placement)
 */
export interface OrientationVariant {
  count: number;
  refdes: string | string[];
  connections: PinNetConnection[];
}

/**
 * Aggregated component group (grouped by MPN or description)
 */
export interface AggregatedComponent {
  mpn: string | null;
  description?: string;
  comment?: string;
  value?: string;
  dns?: boolean;
  total_count: number;
  refdes?: string | string[];
  connections?: PinNetConnection[];
  orientations?: OrientationVariant[];
  notes?: string[];
}

/**
 * Result from circuit query with MPN aggregation
 */
export interface AggregatedCircuitResult {
  starting_point: string;
  net?: string;
  total_components: number;
  unique_configurations: number;
  components_by_mpn: AggregatedComponent[];
  visited_nets: string[];
  circuit_hash: string;
  skipped?: Record<string, number>;
}

// Re-export format-specific discovered design types for consumers
export type { CadenceDiscoveredDesign, AltiumDiscoveredDesign };

/**
 * Discovered design metadata (discriminated union by format).
 */
export type DiscoveredDesign = CadenceDiscoveredDesign | AltiumDiscoveredDesign;

/**
 * Design info returned from list_designs
 */
export interface DesignInfo {
  name: string;
  path: string;
  error?: string;
}

/**
 * Component entry grouped by MPN for list/search results.
 */
export interface ComponentGroup {
  refdes: string | string[];
  count: number;
  mpn: string | null;
  description?: string;
  comment?: string;
  value?: string;
  dns?: boolean;
  notes?: string[];
}

/**
 * List components result.
 */
export interface ListComponentsResult {
  components: ComponentGroup[];
}

/**
 * List nets result.
 */
export interface ListNetsResult {
  nets: string[];
}

/**
 * Search components results with optional notes for empty results.
 */
export interface SearchComponentsResult {
  results: Record<string, ComponentGroup[]>;
  notes?: string[];
}

/**
 * Search nets results with optional notes for empty results.
 */
export interface SearchNetsResult {
  results: Record<string, string[]>;
  notes?: string[];
}

/**
 * Query component details (pins mapped to nets).
 */
export interface QueryComponentResult {
  refdes: string;
  mpn: string | null;
  description?: string;
  comment?: string;
  value?: string;
  dns?: boolean;
  pins: Record<string, PinEntry>;
  notes?: string[];
}

/**
 * Type guard to check if result is an error
 */
export const isErrorResult = (result: unknown): result is ErrorResult =>
  Boolean(result && typeof (result as ErrorResult).error === "string");

/**
 * Handler interface for EDA project format plugins.
 * Each EDA tool (Cadence, Altium, KiCad, etc.) implements this interface.
 */
export interface EDAProjectFormatHandler {
  /** Unique identifier for this format (e.g., 'cadence-cis', 'altium', 'kicad') */
  readonly name: string;

  /** File extensions this handler recognizes (e.g., ['.dsn'], ['.prjpcb']) */
  readonly extensions: readonly string[];

  /** Check if this handler can process a file based on its path */
  canHandle(filePath: string): boolean;

  /** Discover all designs of this format in a directory */
  discoverDesigns(rootDir: string): Promise<DiscoveredDesign[]>;

  /** Parse a design file into the unified ParsedNetlist format */
  parse(designPath: string): Promise<ParsedNetlist>;
}

// =============================================================================
// Cadence Export Types
// =============================================================================

/**
 * Detected Cadence SPB installation with paths to required tools.
 */
export interface CadenceInstall {
  /** Cadence version number (e.g., "17.4", "23.1") */
  version: string;
  /** Root installation directory (e.g., "C:/Cadence/SPB_17.4") */
  root: string;
  /** Path to pstswp.exe utility */
  pstswp: string;
  /** Path to allegro.cfg configuration file */
  config: string;
}

/**
 * Result from netlist export operation.
 */
export interface ExportNetlistResult {
  /** Whether the export succeeded */
  success: boolean;
  /** Directory where output files were written */
  outputDir: string;
  /** Combined stdout/stderr from pstswp */
  log?: string;
  /** Cadence version used for export */
  cadenceVersion?: string;
  /** List of generated files in outputDir */
  generatedFiles?: string[];
}
