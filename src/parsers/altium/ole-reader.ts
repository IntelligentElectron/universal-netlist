/**
 * OLE/CFB File Reader
 *
 * Custom implementation of Microsoft Compound File Binary (CFB) format parser.
 * Based on MS-CFB specification:
 * https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-cfb/
 *
 * Only implements the subset needed to read streams from Altium .SchDoc files.
 */

import { readFileSync } from 'fs';
import type { OleHeader, OleDirectoryEntry } from './types.js';

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

/**
 * OLE/CFB file reader class
 *
 * Reads Microsoft Compound File Binary format files.
 */
export class OleReader {
  private buffer: Buffer;
  private header: OleHeader;
  private fat: number[];
  private miniFat: number[];
  private directories: OleDirectoryEntry[];
  private miniStream: Buffer;

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
   * Read a named stream from the OLE file.
   */
  readStream(name: string): Buffer {
    const entry = this.findDirectoryEntry(name);
    if (!entry) {
      throw new Error(`Stream "${name}" not found in OLE file`);
    }
    return this.readStreamData(entry);
  }

  /**
   * List all stream names in the file.
   */
  listStreams(): string[] {
    return this.directories.filter((d) => d.type === 2).map((d) => d.name);
  }

  /**
   * Validate the OLE magic signature.
   */
  private validateMagic(): void {
    const signature = this.buffer.subarray(0, 8);
    if (!signature.equals(OLE_MAGIC)) {
      throw new Error('Invalid OLE file: magic signature mismatch');
    }
  }

  /**
   * Parse the 512-byte header.
   */
  private parseHeader(): OleHeader {
    // Minor version at offset 24 (2 bytes) - not used
    // Major version at offset 26 (2 bytes)
    const majorVersion = this.buffer.readUInt16LE(26);

    // Byte order at offset 28 should be 0xFFFE (little-endian)
    const byteOrder = this.buffer.readUInt16LE(28);
    if (byteOrder !== 0xfffe) {
      throw new Error('Invalid OLE file: unexpected byte order');
    }

    // Sector size power at offset 30 (2 bytes)
    const sectorSizePower = this.buffer.readUInt16LE(30);
    const sectorSize = 1 << sectorSizePower;

    // Mini sector size power at offset 32 (2 bytes)
    const miniSectorSizePower = this.buffer.readUInt16LE(32);
    const miniSectorSize = 1 << miniSectorSizePower;

    // Mini stream cutoff at offset 56 (4 bytes)
    const miniStreamCutoff = this.buffer.readUInt32LE(56);

    // First directory sector at offset 48 (4 bytes)
    const dirStartSector = this.buffer.readUInt32LE(48);

    // First mini FAT sector at offset 60 (4 bytes)
    const miniFatStartSector = this.buffer.readUInt32LE(60);

    // Number of mini FAT sectors at offset 64 (4 bytes)
    const numMiniFatSectors = this.buffer.readUInt32LE(64);

    // First DIFAT sector at offset 68 (4 bytes)
    const difatStartSector = this.buffer.readUInt32LE(68);

    // Number of DIFAT sectors at offset 72 (4 bytes)
    const numDifatSectors = this.buffer.readUInt32LE(72);

    // FAT sector locations at offset 76 (109 entries * 4 bytes = 436 bytes)
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

    // Read FAT sectors from header DIFAT
    for (const sectorNum of this.header.fatSectors) {
      const sectorData = this.readSector(sectorNum);
      for (let i = 0; i < entriesPerSector; i++) {
        fat.push(sectorData.readUInt32LE(i * 4));
      }
    }

    // If there are additional DIFAT sectors, read them too
    if (this.header.numDifatSectors > 0) {
      let difatSector = this.header.difatStartSector;
      for (let d = 0; d < this.header.numDifatSectors; d++) {
        const difatData = this.readSector(difatSector);
        // Each DIFAT sector has (sectorSize/4 - 1) FAT sector references
        // and the last entry points to the next DIFAT sector
        for (let i = 0; i < entriesPerSector - 1; i++) {
          const fatSectorNum = difatData.readUInt32LE(i * 4);
          if (fatSectorNum !== FREESECT) {
            const sectorData = this.readSector(fatSectorNum);
            for (let j = 0; j < entriesPerSector; j++) {
              fat.push(sectorData.readUInt32LE(j * 4));
            }
          }
        }
        // Next DIFAT sector
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

    // Mini stream is stored as a regular stream in the root entry
    return this.readRegularStream(rootEntry.startSector, rootEntry.size);
  }

  /**
   * Read all directory entries.
   */
  private readDirectories(): OleDirectoryEntry[] {
    const directories: OleDirectoryEntry[] = [];
    const entriesPerSector = this.header.sectorSize / DIR_ENTRY_SIZE;
    const sectorChain = this.getSectorChain(this.header.dirStartSector);

    for (const sectorNum of sectorChain) {
      const sectorData = this.readSector(sectorNum);
      for (let i = 0; i < entriesPerSector; i++) {
        const entryOffset = i * DIR_ENTRY_SIZE;
        const entry = this.parseDirectoryEntry(
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
   * Parse a single 128-byte directory entry.
   */
  private parseDirectoryEntry(data: Buffer): OleDirectoryEntry {
    // Name is UTF-16LE, up to 64 bytes (32 chars), null-terminated
    const nameLength = data.readUInt16LE(64);
    const nameBytes = nameLength > 2 ? nameLength - 2 : 0;
    const name = data.subarray(0, nameBytes).toString('utf16le');

    // Entry type at offset 66 (1 byte)
    const type = data.readUInt8(66);

    // Starting sector at offset 116 (4 bytes)
    const startSector = data.readUInt32LE(116);

    // Size at offset 120 (8 bytes for v4, 4 bytes for v3)
    // For v3, only first 4 bytes are used
    const size = data.readUInt32LE(120);

    return { name, type, startSector, size };
  }

  /**
   * Find a directory entry by name.
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
    // Sectors start after the 512-byte header
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

      // Safety check to prevent infinite loops
      if (chain.length > 1000000) {
        throw new Error('Sector chain too long, possible corruption');
      }
    }

    return chain;
  }
}

/**
 * Read a stream from an OLE file.
 */
export const readOleStream = (filePath: string, streamName = 'FileHeader'): Buffer => {
  const ole = new OleReader(filePath);
  return ole.readStream(streamName);
};
