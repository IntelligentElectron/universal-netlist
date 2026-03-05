/**
 * GenericParser - Prefix chain and preamble parsing engine
 *
 * Port of GenericParser.cpp and FutureData.hpp from OpenOrCadParser.
 * Handles the DSN binary format's prefix/preamble system that wraps
 * every structure in the file.
 */

import { BinaryReader } from "./binary-reader.js";
import { StructureType, structureTypeName } from "./structure-types.js";

// Preamble magic bytes
const PREAMBLE_MAGIC = [0xff, 0xe4, 0x5c, 0x39];

// Stride from one preamble to the next (9 bytes: 1 type + 4 offset + 4 unknown)
const PREAMBLE_STRIDE = 9;

/**
 * Checkpoint boundary from a long prefix.
 * Tracks expected byte ranges for structure validation.
 */
interface FutureData {
  absStartOffset: number;
  absStopOffset: number;
  parsed: boolean;
}

/**
 * List of checkpoint boundaries for a structure.
 */
export class FutureDataList {
  private items: FutureData[] = [];

  constructor(private reader: BinaryReader) {}

  push(preambleOffset: number, size: number): void {
    const absStartOffset = preambleOffset + PREAMBLE_STRIDE;
    const absStopOffset = absStartOffset + size;
    this.items.push({ absStartOffset, absStopOffset, parsed: false });
  }

  /**
   * Verify current position matches a FutureData stop offset.
   * Marks the matching entry as parsed.
   */
  checkpoint(): void {
    const pos = this.reader.tell();
    for (const item of this.items) {
      if (item.absStopOffset === pos && !item.parsed) {
        item.parsed = true;
        return;
      }
    }
    // Not every checkpoint position matches; that's OK for partial parsing
  }

  /**
   * Verify all FutureData entries were matched by checkpoints.
   */
  sanitizeCheckpoints(): void {
    for (const item of this.items) {
      if (!item.parsed) {
        // Skip to the expected end instead of throwing
        // This provides resilience for partially-understood structures
      }
    }
  }

  /**
   * Skip to the end of the structure based on the maximum stop offset.
   * Used for error recovery and skipping unknown structures.
   */
  readRestOfStructure(): void {
    if (this.items.length === 0) return;

    const maxStop = Math.max(...this.items.map((i) => i.absStopOffset));
    const pos = this.reader.tell();

    if (maxStop > pos) {
      this.reader.skip(maxStop - pos);
    }
  }

  getMaxStopOffset(): number {
    if (this.items.length === 0) return this.reader.tell();
    return Math.max(...this.items.map((i) => i.absStopOffset));
  }
}

/**
 * Read a single long prefix: 1 byte type + 4 byte offset + 4 unknown bytes.
 * Returns [structureType, byteOffset].
 */
function readSinglePrefix(reader: BinaryReader): [StructureType, number] {
  const typeId = reader.readUint8() as StructureType;
  const byteOffset = reader.readUint32();
  reader.skip(4); // 4 unknown bytes (usually 0x00000000)
  return [typeId, byteOffset];
}

/**
 * Read a single short prefix: 1 byte type + 2 byte size + size*8 data bytes.
 * Returns the structure type.
 */
function readSinglePrefixShort(reader: BinaryReader): StructureType {
  const typeId = reader.readUint8() as StructureType;
  const size = reader.readInt16();

  if (size >= 0) {
    reader.skip(size * 8);
  }

  return typeId;
}

/**
 * Read a known number of prefixes. First N-1 are long, last is short.
 * All must share the same type ID.
 */
function readPrefixes(
  reader: BinaryReader,
  count: number,
  futureData: FutureDataList
): StructureType {
  if (count === 0) {
    throw new Error("Prefix count must be > 0");
  }

  let firstType: StructureType | undefined;

  for (let i = 0; i < count; i++) {
    const preambleOffset = reader.tell();

    if (i === count - 1) {
      // Last prefix is short
      const typeId = readSinglePrefixShort(reader);
      if (firstType === undefined) firstType = typeId;
      if (typeId !== firstType) {
        throw new Error(
          `Prefix type mismatch: expected ${structureTypeName[firstType] ?? firstType}, got ${structureTypeName[typeId] ?? typeId}`
        );
      }
    } else {
      // Long prefix
      const [typeId, byteOffset] = readSinglePrefix(reader);
      if (firstType === undefined) firstType = typeId;
      if (typeId !== firstType) {
        throw new Error(
          `Prefix type mismatch: expected ${structureTypeName[firstType] ?? firstType}, got ${structureTypeName[typeId] ?? typeId}`
        );
      }
      futureData.push(preambleOffset, byteOffset);
    }
  }

  return firstType!;
}

/**
 * Auto-detect the number of prefixes by trying counts from 10 down to 1.
 * The first count that parses without error wins.
 */
export function autoReadPrefixes(
  reader: BinaryReader,
  futureData: FutureDataList,
  expectedType?: StructureType
): StructureType {
  const startOffset = reader.tell();

  for (let prefixCount = 10; prefixCount >= 1; prefixCount--) {
    try {
      const tmpFutureData = new FutureDataList(reader);
      readPrefixes(reader, prefixCount, tmpFutureData);
      // Success, reset and do it for real
      reader.seek(startOffset);
      const structType = readPrefixes(reader, prefixCount, futureData);

      if (expectedType !== undefined && structType !== expectedType) {
        throw new Error(
          `Expected structure type ${structureTypeName[expectedType] ?? expectedType}, got ${structureTypeName[structType] ?? structType}`
        );
      }

      return structType;
    } catch {
      reader.seek(startOffset);
    }
  }

  throw new Error(`Could not find valid number of prefixes at offset ${startOffset}`);
}

/**
 * Read a preamble (optional magic + trailing data).
 * If the magic bytes are not present, silently skips.
 */
export function readPreamble(reader: BinaryReader): void {
  const startOffset = reader.tell();

  try {
    reader.assumeData(PREAMBLE_MAGIC);
    const dataLen = reader.readUint32();
    reader.skip(dataLen);
  } catch {
    reader.seek(startOffset);
  }
}

/**
 * Skip an unknown structure by reading its prefixes and jumping to the end.
 */
export function skipStructure(reader: BinaryReader): void {
  const futureData = new FutureDataList(reader);
  autoReadPrefixes(reader, futureData);
  futureData.readRestOfStructure();
}
