/**
 * TypeScript type definitions for netlist parsing and circuit analysis
 */

// Import format-specific discovered design types from their parsers
import type { CadenceDiscoveredDesign } from "./parsers/cadence/discovery.js";
import type { AltiumDiscoveredDesign } from "./parsers/altium/discovery.js";
import type { KicadDiscoveredDesign } from "./parsers/kicad/discovery.js";
import type { UniversalDiscoveredDesign } from "./parsers/universal/discovery.js";

/**
 * Net connections from netlist
 * Format: { netName: { refdes: pinNumbers } }
 */
export interface NetConnections {
  [netName: string]: {
    [refdes: string]: string[];
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
  netName: string
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
    /**
     * The manufacturer's part number, and nothing else.
     *
     * Omitted when the design records none. It is never filled from an internal
     * part number or a library symbol name: a field named for the manufacturer
     * that sometimes holds something else cannot be read without guessing which
     * it got this time, which is the whole reason `internal_pn` exists.
     *
     * An MPN is unique only within a manufacturer, so `manufacturer` is what
     * makes this a key rather than a string.
     */
    mpn?: string;
    /**
     * The part number the design's own organization identifies the part by.
     *
     * A different namespace from `mpn`, not a synonym for it. One MPN commonly
     * maps to several internal numbers, so the two cannot be collapsed and
     * neither can be derived from the other.
     */
    internal_pn?: string;
    /** The manufacturer's name, when the design records one. */
    manufacturer?: string;
    description?: string;
    comment?: string;
    value?: string;
    dns?: boolean;
    /** Set when the selected design variant substitutes another part for the base one. */
    alternate_part?: boolean;
    pins: Record<string, PinEntry>;
  };
}

/**
 * A design's parsed netlist.
 *
 * Built by `loadNetlist` for the tool call that asked for it and discarded when
 * that call returns: nothing here is held between calls, so every tool call
 * reads and parses the design again. This said "cached in memory", which it has
 * never been, and reading a design is the cost of every query as a result.
 */
export interface ParsedNetlist {
  nets: NetConnections;
  components: ComponentDetails;
}

/** A named design variant (assembly configuration) recorded by an EDA design. */
export interface DesignVariant {
  name: string;
  /**
   * Whether the vendor marks this variant as a build assembly. Altium records
   * it per variant as `AllowFabrication`; every Cadence CIS BOM variant is one
   * by definition. Omitted when the format has no such flag.
   */
  fabrication?: boolean;
}

/** One entry of a design's `design_variants` list in list_designs. */
export interface DesignVariantInfo extends DesignVariant {
  is_default?: boolean;
}

/** Options that select which assembly configuration a parser resolves. */
export interface ParseDesignOptions {
  /**
   * A declared variant's name, or the literal `<Default>` for the base build.
   * The plain alias `default` is resolved by the service before it gets here.
   */
  variant?: string;
}

/**
 * Component in circuit query result
 */
export interface CircuitComponent {
  refdes: string;
  type?: string;
  mpn?: string;
  internal_pn?: string;
  manufacturer?: string;
  description?: string;
  comment?: string;
  value?: string;
  dns?: boolean;
  /** Set when the selected design variant substitutes another part for the base one. */
  alternate_part?: boolean;
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
  pins: string[];
}

/**
 * Orientation variant for 2-pin components (tracks polarity placement)
 */
export interface OrientationVariant {
  count: number;
  refdes: string[];
  connections: PinNetConnection[];
}

/**
 * Aggregated component group (grouped by MPN or description)
 */
export interface AggregatedComponent {
  mpn?: string;
  internal_pn?: string;
  manufacturer?: string;
  description?: string;
  comment?: string;
  value?: string;
  dns?: boolean;
  /** Set when the selected design variant substitutes another part for the base one. */
  alternate_part?: boolean;
  total_count: number;
  refdes?: string[];
  connections?: PinNetConnection[];
  orientations?: OrientationVariant[];
  notes?: string[];
}

/**
 * Result from circuit query with MPN aggregation
 */
export interface AggregatedCircuitResult {
  /** The design variant this result describes: a native name or `<Default>`. */
  design_variant: string;
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
export type {
  CadenceDiscoveredDesign,
  AltiumDiscoveredDesign,
  KicadDiscoveredDesign,
  UniversalDiscoveredDesign,
};

/**
 * Discovered design metadata (discriminated union by format).
 */
export type DiscoveredDesign =
  | CadenceDiscoveredDesign
  | AltiumDiscoveredDesign
  | KicadDiscoveredDesign
  | UniversalDiscoveredDesign;

/**
 * Design info returned from list_designs
 */
export interface DesignInfo {
  name: string;
  path: string;
  /**
   * The builds the design has: every native design variant it records, or
   * `<Default>` alone when it records none. A design that lists a native
   * variant requires `design_variant` on every query, as one of those names.
   */
  design_variants: DesignVariantInfo[];
  error?: string;
}

/**
 * Result from listDesigns.
 *
 * `root` is the absolute directory the search actually ran in. It is reported on
 * every result because the search root is the one thing a caller cannot check
 * from the designs alone: a mistyped or omitted `path` falls back to the
 * server's working directory and returns a list of real designs from somewhere
 * else entirely, which reads exactly like a correct answer.
 */
export interface ListDesignsResult {
  root: string;
  designs: DesignInfo[];
  notes?: string[];
}

/**
 * Component entry grouped by MPN for list/search results.
 */
export interface ComponentGroup {
  refdes: string[];
  count: number;
  mpn?: string;
  internal_pn?: string;
  manufacturer?: string;
  description?: string;
  comment?: string;
  value?: string;
  dns?: boolean;
  /** Set when the selected design variant substitutes another part for the base one. */
  alternate_part?: boolean;
  notes?: string[];
}

/**
 * List components result.
 */
export interface ListComponentsResult {
  /** The design variant this result describes: a native name or `<Default>`. */
  design_variant: string;
  components: ComponentGroup[];
  notes?: string[];
}

/**
 * List nets result.
 */
export interface ListNetsResult {
  /** The design variant this result describes: a native name or `<Default>`. */
  design_variant: string;
  nets: string[];
}

/**
 * Search components results with optional notes for empty results.
 */
export interface SearchComponentsResult {
  /** The design variant this result describes: a native name or `<Default>`. */
  design_variant: string;
  results: Record<string, ComponentGroup[]>;
  notes?: string[];
}

/**
 * Search nets results with optional notes for empty results.
 */
export interface SearchNetsResult {
  /** The design variant this result describes: a native name or `<Default>`. */
  design_variant: string;
  results: Record<string, string[]>;
  notes?: string[];
}

/**
 * Query component details (pins mapped to nets).
 */
export interface QueryComponentResult {
  /** The design variant this result describes: a native name or `<Default>`. */
  design_variant: string;
  refdes: string;
  mpn?: string;
  internal_pn?: string;
  manufacturer?: string;
  description?: string;
  comment?: string;
  value?: string;
  dns?: boolean;
  /** Set when the selected design variant substitutes another part for the base one. */
  alternate_part?: boolean;
  pins: Record<string, PinEntry>;
  notes?: string[];
}

/**
 * Type guard to check if result is an error
 */
export const isErrorResult = (result: unknown): result is ErrorResult =>
  Boolean(result && typeof (result as ErrorResult).error === "string");

/**
 * Options for design discovery.
 */
export interface DiscoverDesignsOptions {
  /** Maximum directory recursion depth (0 = no recursion). Omit for unlimited. */
  maxDepth?: number;
}

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
  discoverDesigns(rootDir: string, options?: DiscoverDesignsOptions): Promise<DiscoveredDesign[]>;

  /** List the named assembly variants a design records. */
  listVariants?(designPath: string): Promise<DesignVariant[]>;

  /** Parse a design file into the unified ParsedNetlist format */
  parse(designPath: string, options?: ParseDesignOptions): Promise<ParsedNetlist>;
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
