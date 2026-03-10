/**
 * OLE/CFB File Reader
 *
 * Custom implementation of Microsoft Compound File Binary (CFB) format parser.
 * Based on MS-CFB specification:
 * https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-cfb/
 *
 * Shared between Altium (.SchDoc) and Cadence (.DSN) parsers.
 */

import { readFileSync } from "fs";
import type { OleHeader, OleDirectoryEntry, OleDirectoryPath } from "./types.js";

// OLE magic signature: D0 CF 11 E0 A1 B1 1A E1
const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

// Header size is always 512 bytes
const HEADER_SIZE = 512;

// Directory entry size is always 128 bytes
const DIR_ENTRY_SIZE = 128;

// Special sector values
const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;
const FATSECT = 0xfffffffd;
const DIFSECT = 0xfffffffc;

// No valid child/sibling marker in directory entries
const NOSTREAM = 0xffffffff;

/**
 * OLE/CFB file reader class
 *
 * Reads Microsoft Compound File Binary format files.
 * Supports both flat name lookups and hierarchical path lookups.
 */
export class OleReader {
  private buffer: Buffer;
  private header: OleHeader;
  private fat: number[];
  private miniFat: number[];
  private directories: OleDirectoryEntry[];
  private miniStream: Buffer;
  private directoryPaths: OleDirectoryPath[] | null = null;

  /**
   * Create a new OleReader instance for reading OLE compound files.
   */
  constructor(filePath: string) {
    this.buffer = readFileSync(filePath);
    this.validateMagic();
    this.header = this.parseHeader();
    this.fat = this.buildFat();
    this.directories = this.readDirectories();
    this.miniFat = this.buildMiniFat();
    this.miniStream = this.readMiniStream();
  }

  /**
   * Read a named stream from the OLE file (flat name lookup).
   */
  readStream(name: string): Buffer {
    const entry = this.findDirectoryEntry(name);
    if (!entry) {
      throw new Error(`Stream "${name}" not found in OLE file`);
    }
    return this.readStreamData(entry);
  }

  /**
   * Read a stream by its hierarchical path.
   * Path components are separated by "/" (e.g., "Views/SCHEMATIC1/Pages/PAGE1").
   * The root entry is not included in the path.
   */
  readStreamByPath(path: string): Buffer {
    const entries = this.listAllEntries();
    const match = entries.find((e) => e.path === path);
    if (!match) {
      throw new Error(`Stream at path "${path}" not found in OLE file`);
    }
    return this.readStreamData(match.entry);
  }

  /**
   * List all stream names in the file (flat, type 2 only).
   */
  listStreams(): string[] {
    return this.directories.filter((d) => d.type === 2).map((d) => d.name);
  }

  /**
   * List all directory entries with their full hierarchical paths.
   * Includes both storage (type 1) and stream (type 2) entries.
   */
  listAllEntries(): OleDirectoryPath[] {
    if (this.directoryPaths) {
      return this.directoryPaths;
    }
    this.directoryPaths = this.buildDirectoryTree();
    return this.directoryPaths;
  }

  /**
   * Get a human-readable directory tree for debugging.
   */
  getDirectoryTree(): string {
    const entries = this.listAllEntries();
    const lines: string[] = [];
    for (const { path, entry } of entries) {
      const typeStr = entry.type === 1 ? "DIR" : entry.type === 2 ? "STREAM" : `TYPE${entry.type}`;
      lines.push(`${typeStr} ${path} (${entry.size} bytes)`);
    }
    return lines.join("\n");
  }

  /**
   * Build full paths for all directory entries using the red-black tree
   * structure (childId, leftSiblingId, rightSiblingId).
   */
  private buildDirectoryTree(): OleDirectoryPath[] {
    const result: OleDirectoryPath[] = [];

    // Directory entries are indexed by their position in the directories array.
    // Entry 0 is always the root. We need to map indices to entries.
    // But our readDirectories() filters out type=0 entries, so we need to
    // re-read to get the full index-based array.
    const allEntries = this.readAllDirectoryEntries();

    const traverse = (entryIndex: number, parentPath: string): void => {
      if (entryIndex === NOSTREAM || entryIndex >= allEntries.length) {
        return;
      }

      const entry = allEntries[entryIndex];
      if (!entry || entry.type === 0) {
        return;
      }

      // Traverse left sibling first (in-order traversal of red-black tree)
      traverse(entry.leftSiblingId, parentPath);

      // Process current entry
      const currentPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;

      // Skip root entry (type 5) from the path list
      if (entry.type !== 5) {
        result.push({ path: currentPath, entry });
      }

      // Traverse into children (for storage/root entries)
      if (entry.childId !== NOSTREAM) {
        traverse(entry.childId, entry.type === 5 ? "" : currentPath);
      }

      // Traverse right sibling
      traverse(entry.rightSiblingId, parentPath);
    };

    // Start from root's child
    const root = allEntries[0];
    if (root && root.childId !== NOSTREAM) {
      traverse(root.childId, "");
    }

    return result;
  }

  /**
   * Read ALL directory entries (including empty type=0 entries) preserving indices.
   * This is needed for the tree traversal since childId/siblingId are index-based.
   */
  private readAllDirectoryEntries(): (OleDirectoryEntry | null)[] {
    const entries: (OleDirectoryEntry | null)[] = [];
    const entriesPerSector = this.header.sectorSize / DIR_ENTRY_SIZE;
    const sectorChain = this.getSectorChain(this.header.dirStartSector);

    for (const sectorNum of sectorChain) {
      const sectorData = this.readSector(sectorNum);
      for (let i = 0; i < entriesPerSector; i++) {
        const entryOffset = i * DIR_ENTRY_SIZE;
        const entry = this.parseDirectoryEntryFull(
          sectorData.subarray(entryOffset, entryOffset + DIR_ENTRY_SIZE)
        );
        entries.push(entry.type === 0 ? null : entry);
      }
    }

    return entries;
  }

  /**
   * Parse a single 128-byte directory entry with full fields.
   */
  private parseDirectoryEntryFull(data: Buffer): OleDirectoryEntry {
    const nameLength = data.readUInt16LE(64);
    const nameBytes = nameLength > 2 ? nameLength - 2 : 0;
    const name = data.subarray(0, nameBytes).toString("utf16le");

    const type = data.readUInt8(66);
    const leftSiblingId = data.readUInt32LE(68);
    const rightSiblingId = data.readUInt32LE(72);
    const childId = data.readUInt32LE(76);
    const startSector = data.readUInt32LE(116);
    const size = data.readUInt32LE(120);

    return { name, type, startSector, size, childId, leftSiblingId, rightSiblingId };
  }

  /**
   * Validate the OLE magic signature.
   */
  private validateMagic(): void {
    const signature = this.buffer.subarray(0, 8);
    if (!signature.equals(OLE_MAGIC)) {
      throw new Error("Invalid OLE file: magic signature mismatch");
    }
  }

  /**
   * Parse the 512-byte header.
   */
  private parseHeader(): OleHeader {
    const majorVersion = this.buffer.readUInt16LE(26);

    const byteOrder = this.buffer.readUInt16LE(28);
    if (byteOrder !== 0xfffe) {
      throw new Error("Invalid OLE file: unexpected byte order");
    }

    const sectorSizePower = this.buffer.readUInt16LE(30);
    const sectorSize = 1 << sectorSizePower;

    const miniSectorSizePower = this.buffer.readUInt16LE(32);
    const miniSectorSize = 1 << miniSectorSizePower;

    const miniStreamCutoff = this.buffer.readUInt32LE(56);
    const dirStartSector = this.buffer.readUInt32LE(48);
    const miniFatStartSector = this.buffer.readUInt32LE(60);
    const numMiniFatSectors = this.buffer.readUInt32LE(64);
    const difatStartSector = this.buffer.readUInt32LE(68);
    const numDifatSectors = this.buffer.readUInt32LE(72);

    const fatSectors: number[] = [];
    for (let i = 0; i < 109; i++) {
      const sector = this.buffer.readUInt32LE(76 + i * 4);
      if (sector !== FREESECT) {
        fatSectors.push(sector);
      }
    }

    return {
      majorVersion,
      sectorSize,
      miniSectorSize,
      miniStreamCutoff,
      dirStartSector,
      miniFatStartSector,
      numMiniFatSectors,
      difatStartSector,
      numDifatSectors,
      fatSectors,
    };
  }

  /**
   * Build the complete FAT by reading all FAT sectors.
   */
  private buildFat(): number[] {
    const fat: number[] = [];
    const entriesPerSector = this.header.sectorSize / 4;

    for (const sectorNum of this.header.fatSectors) {
      const sectorData = this.readSector(sectorNum);
      for (let i = 0; i < entriesPerSector; i++) {
        fat.push(sectorData.readUInt32LE(i * 4));
      }
    }

    if (this.header.numDifatSectors > 0) {
      let difatSector = this.header.difatStartSector;
      for (let d = 0; d < this.header.numDifatSectors; d++) {
        const difatData = this.readSector(difatSector);
        for (let i = 0; i < entriesPerSector - 1; i++) {
          const fatSectorNum = difatData.readUInt32LE(i * 4);
          if (fatSectorNum !== FREESECT) {
            const sectorData = this.readSector(fatSectorNum);
            for (let j = 0; j < entriesPerSector; j++) {
              fat.push(sectorData.readUInt32LE(j * 4));
            }
          }
        }
        difatSector = difatData.readUInt32LE((entriesPerSector - 1) * 4);
      }
    }

    return fat;
  }

  /**
   * Build the mini FAT.
   */
  private buildMiniFat(): number[] {
    const miniFat: number[] = [];

    if (this.header.miniFatStartSector === ENDOFCHAIN) {
      return miniFat;
    }

    const entriesPerSector = this.header.sectorSize / 4;
    const sectorChain = this.getSectorChain(this.header.miniFatStartSector);

    for (const sectorNum of sectorChain) {
      const sectorData = this.readSector(sectorNum);
      for (let i = 0; i < entriesPerSector; i++) {
        miniFat.push(sectorData.readUInt32LE(i * 4));
      }
    }

    return miniFat;
  }

  /**
   * Read the mini stream from the root entry.
   */
  private readMiniStream(): Buffer {
    const rootEntry = this.directories[0];
    if (!rootEntry || rootEntry.size === 0) {
      return Buffer.alloc(0);
    }

    return this.readRegularStream(rootEntry.startSector, rootEntry.size);
  }

  /**
   * Read all directory entries (filtered, for backward compat).
   */
  private readDirectories(): OleDirectoryEntry[] {
    const directories: OleDirectoryEntry[] = [];
    const entriesPerSector = this.header.sectorSize / DIR_ENTRY_SIZE;
    const sectorChain = this.getSectorChain(this.header.dirStartSector);

    for (const sectorNum of sectorChain) {
      const sectorData = this.readSector(sectorNum);
      for (let i = 0; i < entriesPerSector; i++) {
        const entryOffset = i * DIR_ENTRY_SIZE;
        const entry = this.parseDirectoryEntryFull(
          sectorData.subarray(entryOffset, entryOffset + DIR_ENTRY_SIZE)
        );
        if (entry.type !== 0) {
          directories.push(entry);
        }
      }
    }

    return directories;
  }

  /**
   * Find a directory entry by name (flat lookup, type 2 only).
   */
  private findDirectoryEntry(name: string): OleDirectoryEntry | undefined {
    return this.directories.find(
      (d) => d.name.toLowerCase() === name.toLowerCase() && d.type === 2
    );
  }

  /**
   * Read stream data from a directory entry.
   */
  private readStreamData(entry: OleDirectoryEntry): Buffer {
    if (entry.size < this.header.miniStreamCutoff) {
      return this.readMiniStreamData(entry.startSector, entry.size);
    }
    return this.readRegularStream(entry.startSector, entry.size);
  }

  /**
   * Read a regular stream (>= 4096 bytes).
   */
  private readRegularStream(startSector: number, size: number): Buffer {
    const result = Buffer.alloc(size);
    let offset = 0;
    let sector = startSector;

    while (sector !== ENDOFCHAIN && offset < size) {
      const sectorData = this.readSector(sector);
      const bytesToCopy = Math.min(this.header.sectorSize, size - offset);
      sectorData.copy(result, offset, 0, bytesToCopy);
      offset += bytesToCopy;
      sector = this.fat[sector];
    }

    return result;
  }

  /**
   * Read from mini stream (< 4096 bytes).
   */
  private readMiniStreamData(startSector: number, size: number): Buffer {
    const result = Buffer.alloc(size);
    let offset = 0;
    let sector = startSector;

    while (sector !== ENDOFCHAIN && offset < size) {
      const miniOffset = sector * this.header.miniSectorSize;
      const bytesToCopy = Math.min(this.header.miniSectorSize, size - offset);
      this.miniStream.copy(result, offset, miniOffset, miniOffset + bytesToCopy);
      offset += bytesToCopy;
      sector = this.miniFat[sector];
    }

    return result;
  }

  /**
   * Read a sector by its index.
   */
  private readSector(sectorNum: number): Buffer {
    const offset = HEADER_SIZE + sectorNum * this.header.sectorSize;
    return this.buffer.subarray(offset, offset + this.header.sectorSize);
  }

  /**
   * Get the chain of sectors for a stream.
   */
  private getSectorChain(startSector: number): number[] {
    const chain: number[] = [];
    let sector = startSector;

    while (
      sector !== ENDOFCHAIN &&
      sector !== FREESECT &&
      sector !== FATSECT &&
      sector !== DIFSECT
    ) {
      chain.push(sector);
      sector = this.fat[sector];

      if (chain.length > 1000000) {
        throw new Error("Sector chain too long, possible corruption");
      }
    }

    return chain;
  }
}

/**
 * Read a stream from an OLE file.
 */
export const readOleStream = (filePath: string, streamName = "FileHeader"): Buffer => {
  const ole = new OleReader(filePath);
  return ole.readStream(streamName);
};
