/**
 * OLE/CFB (Compound File Binary) Format Types
 *
 * Shared types for reading Microsoft Compound File Binary format containers.
 * Used by both Altium (.SchDoc) and Cadence (.DSN) parsers.
 */

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
  /** Child directory entry ID (for storage/root entries) */
  childId: number;
  /** Left sibling directory entry ID */
  leftSiblingId: number;
  /** Right sibling directory entry ID */
  rightSiblingId: number;
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
 * Directory entry with full hierarchical path
 */
export interface OleDirectoryPath {
  /** Full path from root (e.g., "Views/SCHEMATIC1/Pages/PAGE1") */
  path: string;
  /** The directory entry */
  entry: OleDirectoryEntry;
}
