/**
 * Cache Stream Parser
 *
 * Parses the Cache OLE stream, extracting Package (pin maps) and
 * LibraryPart (pin names) structures.
 *
 * Port of OpenOrCadParser StreamCache.cpp
 */

import { BinaryReader } from "./binary-reader.js";
import { StructureType, type CachedLibraryPart, type PinMapData } from "./structure-types.js";
import { skipStructure } from "./generic-parser.js";
import { parsePackage, parseLibraryPart } from "./structures.js";

/** Index a Cache Package's pin maps (fallback; doesn't override existing entries). */
function indexCachePackage(pkg: import("./structures.js").Package, pmd: PinMapData): void {
  if (!pkg.name || pkg.devices.length === 0) return;
  const firstDev = pkg.devices[0];
  if (firstDev.pinMap.length === 0) return;

  const baseName = pkg.name.replace(/_\d+$/, "");
  if (pkg.devices.length === 1) {
    if (!pmd.pinMaps.has(baseName)) {
      pmd.pinMaps.set(baseName, firstDev.pinMap);
      pmd.pinIgnores.set(baseName, firstDev.pinIgnore);
    }
    if (!pmd.pinMaps.has(pkg.name)) {
      pmd.pinMaps.set(pkg.name, firstDev.pinMap);
      pmd.pinIgnores.set(pkg.name, firstDev.pinIgnore);
    }
    // Always store in cachePinMaps for fallback when Packages/ pinMap
    // has more entries than the schematic symbol (e.g., physical package
    // pads that aren't exposed on the schematic).
    // Guarded on cachePinMaps, the map these flags index, not on pinIgnores:
    // a part present in both streams has its Packages/ flags stored already, and
    // those index a different pin count.
    if (!pmd.cachePinMaps.has(baseName)) {
      pmd.cachePinMaps.set(baseName, firstDev.pinMap);
      pmd.cachePinIgnores.set(baseName, firstDev.pinIgnore);
    }
    if (!pmd.cachePinMaps.has(pkg.name)) {
      pmd.cachePinMaps.set(pkg.name, firstDev.pinMap);
      pmd.cachePinIgnores.set(pkg.name, firstDev.pinIgnore);
    }
  } else {
    const unitRefs = pkg.devices.map((d) => d.unitRef);
    if (!pmd.deviceUnitRefs.has(baseName)) pmd.deviceUnitRefs.set(baseName, unitRefs);
    for (const dev of pkg.devices) {
      const baseKey = baseName + dev.unitRef;
      if (!pmd.pinMaps.has(baseKey)) {
        pmd.pinMaps.set(baseKey, dev.pinMap);
        pmd.pinIgnores.set(baseKey, dev.pinIgnore);
      }
      if (!pmd.cachePinMaps.has(baseKey)) {
        pmd.cachePinMaps.set(baseKey, dev.pinMap);
        pmd.cachePinIgnores.set(baseKey, dev.pinIgnore);
      }
      if (pkg.name !== baseName) {
        const nameKey = pkg.name + dev.unitRef;
        if (!pmd.pinMaps.has(nameKey)) {
          pmd.pinMaps.set(nameKey, dev.pinMap);
          pmd.pinIgnores.set(nameKey, dev.pinIgnore);
        }
        if (!pmd.cachePinMaps.has(nameKey)) {
          pmd.cachePinMaps.set(nameKey, dev.pinMap);
          pmd.cachePinIgnores.set(nameKey, dev.pinIgnore);
        }
      }
    }
  }
}

/** Index a Cache LibraryPart's pin names (fallback; doesn't override existing entries). */
function indexCacheLibraryPart(
  lp: import("./structures.js").LibraryPart,
  cachedParts: Map<string, CachedLibraryPart>
): void {
  const entry: CachedLibraryPart = { pinNames: lp.pinNames, defaultValue: lp.defaultValue };
  if (!cachedParts.has(lp.name)) cachedParts.set(lp.name, entry);
  const stripped = lp.name.replace(/_\d+(?=\.)/, "");
  if (stripped !== lp.name && !cachedParts.has(stripped)) {
    cachedParts.set(stripped, entry);
  }
}

/**
 * Brute-force scan the Cache buffer for Package and LibraryPart structures
 * by locating preamble magic bytes (FF E4 5C 39).
 *
 * When sequential metadata parsing fails, this recovers remaining structures.
 * For each preamble magic occurrence, checks if 3 bytes earlier is a valid
 * short prefix for Package (0x1F) or LibraryPart (0x18), and attempts to
 * parse the structure.
 */
function scanForStructures(
  reader: BinaryReader,
  buffer: Buffer,
  pmd: PinMapData,
  cachedParts: Map<string, CachedLibraryPart>
): void {
  const MAGIC = Buffer.from([0xff, 0xe4, 0x5c, 0x39]);
  let pos = reader.tell();

  while (pos < buffer.length - 10) {
    const magicIdx = buffer.indexOf(MAGIC, pos);
    if (magicIdx < 3) break;

    // A short prefix is 3 bytes (type + int16 size) before the preamble.
    const prefixStart = magicIdx - 3;
    const typeByte = buffer[prefixStart];

    if (typeByte === StructureType.Package || typeByte === StructureType.LibraryPart) {
      reader.seek(prefixStart);
      try {
        if (typeByte === StructureType.Package) {
          const pkg = parsePackage(reader);
          indexCachePackage(pkg, pmd);
        } else {
          const lp = parseLibraryPart(reader);
          indexCacheLibraryPart(lp, cachedParts);
        }
        pos = reader.tell();
        continue;
      } catch {
        // Not a valid structure; skip past this magic occurrence
      }
    }

    pos = magicIdx + 1;
  }
}

/**
 * Parse the Cache stream sequentially, extracting Package (pin maps) and
 * LibraryPart (pin names) structures.
 *
 * The Cache contains all component definitions in a sequential format:
 * 4-byte header, then entries with variable-length metadata, twin IDs,
 * a structure type uint16, and a standard prefix-chain + body structure.
 *
 * Reference: OpenOrCadParser StreamCache.cpp
 */
export function parseCacheStream(
  buffer: Buffer,
  pmd: PinMapData,
  cachedParts: Map<string, CachedLibraryPart>
): void {
  const reader = new BinaryReader(buffer);

  /** Probe: run fn, always reset position. Returns true if fn succeeded. */
  function tryRead(fn: () => void): boolean {
    const saved = reader.tell();
    try {
      fn();
    } catch {
      reader.seek(saved);
      return false;
    }
    reader.seek(saved);
    return true;
  }

  // Empty cache: <= 10 bytes
  if (buffer.length <= 10) return;

  // Header: 2 zero bytes + 2 unknown bytes
  reader.skip(4);

  while (!reader.isEof()) {
    try {
      // Variable-length metadata: probe to detect format variant.
      // Variant 1: string follows immediately (name directly)
      // Variant 2: 2 unknown + 3-char refDes string + 2 unknown, then name
      // Variant 3: 2 unknown bytes, then name
      const hasStrNow = tryRead(() => reader.readStringLenZeroTerm());

      if (!hasStrNow) {
        const hasStrAfter8 = tryRead(() => {
          reader.skip(8);
          reader.readStringLenZeroTerm();
        });

        if (hasStrAfter8) {
          reader.skip(2); // unknown
          reader.readStringLenZeroTerm(); // refDes-like descriptor ("LED", "VDC", etc.)
        }

        reader.skip(2); // unknown
      }

      reader.readStringLenZeroTerm(); // entry name

      // Twin ID check: peek 8 bytes
      const ids = reader.peek(8);
      const id0 = ids.readUInt32LE(0);
      const id1 = ids.readUInt32LE(4);

      if (id0 !== id1) {
        // Sub-loop: package names + source library references
        let someVal: number;
        do {
          someVal = reader.readUint16();
          if (reader.isEof()) return;

          // Check: exactly 1 byte left? Skip it and exit.
          const isLastByte = tryRead(() => {
            reader.skip(1);
            if (!reader.isEof()) throw new Error();
          });
          if (isLastByte) {
            reader.skip(1);
            return;
          }

          // Check: can we read a string directly, or are there 2 mystery bytes first?
          if (!tryRead(() => reader.readStringLenZeroTerm())) {
            reader.skip(2);
          }

          reader.readStringLenZeroTerm(); // package name or source library
        } while (someVal === 0);

        if (reader.isEof()) return;
      }

      // Twin IDs
      reader.readUint32(); // someId0
      reader.readUint32(); // someId1

      // Structure type (uint16; low byte matches prefix chain type byte)
      const structType = reader.readUint16();

      // Parse or skip the structure
      const structStart = reader.tell();
      try {
        if (structType === StructureType.Package) {
          const pkg = parsePackage(reader);
          indexCachePackage(pkg, pmd);
        } else if (structType === StructureType.LibraryPart) {
          const lp = parseLibraryPart(reader);
          indexCacheLibraryPart(lp, cachedParts);
        } else {
          skipStructure(reader);
        }
      } catch {
        // Structure parsing failed; skip via prefix chain
        reader.seek(structStart);
        skipStructure(reader);
      }
    } catch {
      // Metadata parsing failed; fall through to brute-force scan for
      // remaining Package and LibraryPart structures via preamble magic.
      scanForStructures(reader, buffer, pmd, cachedParts);
      return;
    }
  }
}
