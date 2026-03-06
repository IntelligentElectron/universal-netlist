/**
 * GenericParser - Prefix chain and preamble parsing engine
 *
 * Port of GenericParser.cpp and FutureData.hpp from OpenOrCadParser.
 * Handles the DSN binary format's prefix/preamble system that wraps
 * every structure in the file.
 */

import { BinaryReader } from "./binary-reader.js";
import { StructureType, structureTypeName } from "./structure-types.js";

/** A (name_idx, val_idx) pair from the short prefix, indexing into the Library strLst. */
export type PrefixPropertyPair = readonly [nameIdx: number, valIdx: number];

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

  /**
   * Skip to the nearest unvisited stop offset at or beyond the current position.
   * Marks the matching entry as parsed. Returns true if a boundary was found.
   */
  skipToNextBoundary(): boolean {
    const pos = this.reader.tell();
    let nearest: FutureData | undefined;
    for (const item of this.items) {
      if (!item.parsed && item.absStopOffset >= pos) {
        if (!nearest || item.absStopOffset < nearest.absStopOffset) {
          nearest = item;
        }
      }
    }
    if (!nearest) return false;
    if (nearest.absStopOffset > pos) {
      this.reader.skip(nearest.absStopOffset - pos);
    }
    nearest.parsed = true;
    return true;
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
 * Read a single short prefix: 1 byte type + 2 byte size + size*(uint32,uint32) pairs.
 * The pairs are (name_idx, val_idx) into the Library strLst string table.
 */
function readSinglePrefixShort(reader: BinaryReader): {
  typeId: StructureType;
  properties: PrefixPropertyPair[];
} {
  const typeId = reader.readUint8() as StructureType;
  const size = reader.readInt16();
  const properties: PrefixPropertyPair[] = [];

  if (size >= 0) {
    for (let i = 0; i < size; i++) {
      const nameIdx = reader.readUint32();
      const valIdx = reader.readUint32();
      properties.push([nameIdx, valIdx]);
    }
  }

  return { typeId, properties };
}

/**
 * Read a known number of prefixes. First N-1 are long, last is short.
 * All must share the same type ID. Returns the type and property pairs from the short prefix.
 */
function readPrefixes(
  reader: BinaryReader,
  count: number,
  futureData: FutureDataList
): { structType: StructureType; properties: PrefixPropertyPair[] } {
  if (count === 0) {
    throw new Error("Prefix count must be > 0");
  }

  let firstType: StructureType | undefined;
  let properties: PrefixPropertyPair[] = [];

  for (let i = 0; i < count; i++) {
    const preambleOffset = reader.tell();

    if (i === count - 1) {
      // Last prefix is short
      const result = readSinglePrefixShort(reader);
      if (firstType === undefined) firstType = result.typeId;
      if (result.typeId !== firstType) {
        throw new Error(
          `Prefix type mismatch: expected ${structureTypeName[firstType] ?? firstType}, got ${structureTypeName[result.typeId] ?? result.typeId}`
        );
      }
      properties = result.properties;
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

  return { structType: firstType!, properties };
}

/**
 * Auto-detect the number of prefixes by trying counts from 10 down to 1.
 * The first count that parses without error wins.
 * Returns the structure type and any property pairs from the short prefix.
 */
export function autoReadPrefixes(
  reader: BinaryReader,
  futureData: FutureDataList,
  expectedType?: StructureType
): { structType: StructureType; properties: PrefixPropertyPair[] } {
  const startOffset = reader.tell();

  for (let prefixCount = 10; prefixCount >= 1; prefixCount--) {
    try {
      const tmpFutureData = new FutureDataList(reader);
      readPrefixes(reader, prefixCount, tmpFutureData);
      // Success, reset and do it for real
      reader.seek(startOffset);
      const result = readPrefixes(reader, prefixCount, futureData);

      if (expectedType !== undefined && result.structType !== expectedType) {
        throw new Error(
          `Expected structure type ${structureTypeName[expectedType] ?? expectedType}, got ${structureTypeName[result.structType] ?? result.structType}`
        );
      }

      return result;
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
