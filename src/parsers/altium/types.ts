/**
 * Altium Schematic Parser - Internal Types
 *
 * Type definitions for parsing Altium .SchDoc files.
 * Record type IDs sourced from:
 * - https://github.com/vadmium/python-altium/blob/master/format.md
 * - https://github.com/gsuberland/altium_js
 * - https://github.com/a3ng7n/Altium-Schematic-Parser
 */

/**
 * Complete Altium Schematic Record Type IDs
 *
 * These are the known record types found in Altium .SchDoc files.
 * The format has been reverse-engineered from multiple sources.
 */
export const RECORD_TYPES = {
  // === Core Schematic Objects ===
  /** Header/sheet properties (implicit, ID 0) */
  HEADER: '0',
  /** Schematic component/part symbol */
  COMPONENT: '1',
  /** Pin on a component */
  PIN: '2',
  /** IEEE symbol (logic gates, etc.) */
  IEEE_SYMBOL: '3',
  /** Text annotation/label */
  LABEL: '4',

  // === Graphical Primitives ===
  /** Bezier curve */
  BEZIER: '5',
  /** Polyline (multiple connected line segments) */
  POLYLINE: '6',
  /** Filled polygon */
  POLYGON: '7',
  /** Ellipse or circle */
  ELLIPSE: '8',
  /** Pie chart segment */
  PIECHART: '9',
  /** Rounded rectangle */
  ROUND_RECTANGLE: '10',
  /** Elliptical arc */
  ELLIPTICAL_ARC: '11',
  /** Circular arc */
  ARC: '12',
  /** Simple line */
  LINE: '13',
  /** Rectangle */
  RECTANGLE: '14',

  // === Sheet/Hierarchy Objects ===
  /** Sheet symbol (represents a sub-sheet in hierarchical design) */
  SHEET_SYMBOL: '15',
  /** Sheet entry (port on a sheet symbol) */
  SHEET_ENTRY: '16',
  /** Power port (VCC, GND, etc.) */
  POWER_PORT: '17',
  /** Port (sheet connector) */
  PORT: '18',

  // === Connectivity Objects ===
  /** No ERC marker (suppress error checking) */
  NO_ERC: '22',
  /** Net label (names a net) */
  NET_LABEL: '25',
  /** Bus (group of signals) */
  BUS: '26',
  /** Wire (electrical connection) */
  WIRE: '27',
  /** Text frame (multi-line text box) */
  TEXT_FRAME: '28',
  /** Junction (wire connection point) */
  JUNCTION: '29',

  // === Document Objects ===
  /** Embedded image */
  IMAGE: '30',
  /** Sheet settings (fonts, grid, border, etc.) */
  SHEET: '31',
  /** Sheet name */
  SHEET_NAME: '32',
  /** Sheet file name */
  SHEET_FILE_NAME: '33',
  /** Component designator (U1, R1, C1, etc.) */
  DESIGNATOR: '34',

  // === Additional Objects ===
  /** Bus entry (connection from wire to bus) */
  BUS_ENTRY: '37',
  /** Template reference */
  TEMPLATE: '39',
  /** Parameter (component properties like MPN, value, etc.) */
  PARAMETER: '41',
  /** Warning sign/marker */
  WARNING_SIGN: '43',

  // === Implementation/Model Objects ===
  /** Implementation list (container for implementations) */
  IMPLEMENTATION_LIST: '44',
  /** Implementation (footprint, simulation model, etc.) */
  IMPLEMENTATION: '45',
  /** Implementation pin association */
  IMPLEMENTATION_PIN: '46',
  /** Implementation parameter */
  IMPLEMENTATION_PARAM: '47',
  /** Implementation map */
  IMPLEMENTATION_MAP: '48',

  // === Extended Objects (found in newer Altium versions) ===
  /** Hyperlink */
  HYPERLINK: '226',
} as const;

/** Type for record type string values */
export type RecordType = (typeof RECORD_TYPES)[keyof typeof RECORD_TYPES];

/**
 * Human-readable names for record types
 */
export const RECORD_TYPE_NAMES: Record<string, string> = {
  '0': 'Header',
  '1': 'Component',
  '2': 'Pin',
  '3': 'IEEE Symbol',
  '4': 'Label',
  '5': 'Bezier',
  '6': 'Polyline',
  '7': 'Polygon',
  '8': 'Ellipse',
  '9': 'Piechart',
  '10': 'Round Rectangle',
  '11': 'Elliptical Arc',
  '12': 'Arc',
  '13': 'Line',
  '14': 'Rectangle',
  '15': 'Sheet Symbol',
  '16': 'Sheet Entry',
  '17': 'Power Port',
  '18': 'Port',
  '22': 'No ERC',
  '25': 'Net Label',
  '26': 'Bus',
  '27': 'Wire',
  '28': 'Text Frame',
  '29': 'Junction',
  '30': 'Image',
  '31': 'Sheet',
  '32': 'Sheet Name',
  '33': 'Sheet File Name',
  '34': 'Designator',
  '37': 'Bus Entry',
  '39': 'Template',
  '41': 'Parameter',
  '43': 'Warning Sign',
  '44': 'Implementation List',
  '45': 'Implementation',
  '46': 'Implementation Pin',
  '47': 'Implementation Param',
  '48': 'Implementation Map',
  '226': 'Hyperlink',
};

/**
 * Pin electrical types (from ELECTRICAL field on PIN records)
 */
export const PIN_ELECTRICAL_TYPES = {
  INPUT: '0',
  IO: '1',
  OUTPUT: '2',
  OPEN_COLLECTOR: '3',
  PASSIVE: '4',
  HI_Z: '5',
  OPEN_EMITTER: '6',
  POWER: '7',
} as const;

/**
 * Power port styles (from STYLE field on POWER_PORT records)
 */
export const POWER_PORT_STYLES = {
  CIRCLE: '0',
  ARROW: '1',
  BAR: '2',
  WAVE: '3',
  POWER_GROUND: '4',
  SIGNAL_GROUND: '5',
  EARTH: '6',
  GOST_ARROW: '7',
  GOST_POWER_GROUND: '8',
  GOST_EARTH: '9',
  GOST_BAR: '10',
} as const;

/**
 * A parsed record from the Altium schematic file.
 * Records represent various schematic elements (parts, pins, wires, etc.)
 */
export interface AltiumRecord {
  /** Index position in the original record list */
  index: number;
  /** Record type identifier (e.g., "1" for component, "2" for pin) */
  RECORD?: string;
  /** Index of the owning/parent record */
  OwnerIndex?: string;
  /** Part ID within multi-part component (-1 for shared, 1+ for specific part) */
  OwnerPartId?: string;
  /** Child records (populated by hierarchy builder) */
  children?: AltiumRecord[];
  /** Calculated coordinates for connectivity detection */
  coords?: Array<[number, number]>;
  /** All other key-value pairs from the record */
  [key: string]: unknown;
}

/**
 * Parsed schematic structure containing header and records
 */
export interface AltiumSchematic {
  /** Header records (contain HEADER key) */
  header: AltiumRecord[];
  /** All other records (contain RECORD key) */
  records: AltiumRecord[];
}

/**
 * A net representing connected devices in the schematic
 */
export interface AltiumNet {
  /** Net name (from power port, label, or pin) */
  name: string | null;
  /** All devices connected to this net */
  devices: AltiumRecord[];
}

/**
 * OLE file directory entry
 */
export interface OleDirectoryEntry {
  /** Entry name (UTF-16LE decoded) */
  name: string;
  /** Entry type: 0=empty, 1=storage, 2=stream, 5=root */
  type: number;
  /** Starting sector for stream data */
  startSector: number;
  /** Stream size in bytes */
  size: number;
}

/**
 * OLE file header information
 */
export interface OleHeader {
  /** Major version (3 or 4) */
  majorVersion: number;
  /** Sector size in bytes (512 for v3, 4096 for v4) */
  sectorSize: number;
  /** Mini sector size (usually 64) */
  miniSectorSize: number;
  /** Mini stream cutoff size (4096) */
  miniStreamCutoff: number;
  /** First directory sector */
  dirStartSector: number;
  /** First mini FAT sector */
  miniFatStartSector: number;
  /** Number of mini FAT sectors */
  numMiniFatSectors: number;
  /** First DIFAT sector */
  difatStartSector: number;
  /** Number of DIFAT sectors */
  numDifatSectors: number;
  /** FAT sector locations from header (first 109) */
  fatSectors: number[];
}

/**
 * Output format options matching Python library API
 */
export type OutputFormat = 'all-list' | 'all-hierarchy' | 'parts-list' | 'net-list';
