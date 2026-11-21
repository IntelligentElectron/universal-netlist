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
import { parsePackage, parseLibraryPart } from "./structures.js";

/**
 * List a multi-device package's unit letters, in device order, under each name
 * its unit maps are stored under: the name as written and its `_N`-stripped
 * form. findPinMapKey's positional lookup reads the list under whichever name
 * an instance's sourcePackage spells, so a list under one name only leaves the
 * other to the section-A fallback (issue #247). The first package to claim a
 * name keeps it.
 */
export function listDeviceUnits(
  pmd: PinMapData,
  names: string[],
  devices: { unitRef: string }[]
): void {
  const unitRefs = devices.map((d) => d.unitRef);
  for (const name of names) {
    if (!pmd.deviceUnitRefs.has(name)) pmd.deviceUnitRefs.set(name, unitRefs);
  }
}

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
    listDeviceUnits(pmd, [baseName, pkg.name], pkg.devices);
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

/**
 * Index a LibraryPart's pin names, under its own name and under the
 * suffix-stripped form other instances refer to it by.
 *
 * A part's own name outranks a stripped form derived from a different variant.
 * A design may hold both `RES_0.Normal`, whose pins are named "1" and "2", and
 * `RES.Normal`, whose pins are named "A" and "B". `RES_0.Normal` strips to
 * `RES.Normal`, so first-writer-wins gave every plain resistor in the design the
 * numbering-as-names of the other variant, which is then discarded for matching
 * the pin number. `exactNames` records which keys a part claimed under its own
 * name so a later alias cannot displace it and an alias cannot outrank it.
 */
export function indexLibraryPart(
  lp: { name: string; pinNames: string[]; defaultValue?: string },
  cachedParts: Map<string, CachedLibraryPart>,
  exactNames: Set<string>
): void {
  const entry: CachedLibraryPart = { pinNames: lp.pinNames, defaultValue: lp.defaultValue };

  if (!exactNames.has(lp.name)) {
    cachedParts.set(lp.name, entry);
    exactNames.add(lp.name);
  }

  const stripped = lp.name.replace(/_\d+(?=\.)/, "");
  if (stripped !== lp.name && !cachedParts.has(stripped)) {
    cachedParts.set(stripped, entry);
  }
}

/**
 * Brute-force scan the Cache buffer for Package and LibraryPart structures by
 * locating preamble magic bytes (FF E4 5C 39).
 *
 * This runs when sequential metadata parsing gives up, which on some designs
 * happens after a handful of entries, leaving the scan to recover everything
 * else. Both structure kinds have to be found, because the Packages give pin
 * numbers and the LibraryParts give pin function names.
 *
 * Walking back from the magic to the start of the record is the whole problem.
 * A record is a chain of prefixes: zero or more long ones of 9 bytes, then a
 * short one of `type(1) + int16 pairCount` followed by 8 bytes per
 * (nameIdx, valIdx) pair. Assuming the short prefix sits exactly 3 bytes back
 * only holds when it carries no pairs and nothing precedes it. Across the test
 * corpus that is true for every Package, but for only a minority of
 * LibraryParts, so a design whose sequential parse failed early came out with
 * pin numbers for every component and pin names for none.
 *
 * So the pair count is searched for, and then the chain start, and the parse
 * itself decides: the prefix reader validates the chain, so a wrong guess
 * throws and the next candidate is tried.
 */
function scanForStructures(
  reader: BinaryReader,
  buffer: Buffer,
  pmd: PinMapData,
  cachedParts: Map<string, CachedLibraryPart>,
  exactNames: Set<string>
): void {
  const MAGIC = Buffer.from([0xff, 0xe4, 0x5c, 0x39]);
  /** Widest (nameIdx, valIdx) list seen in a fixture is 19 pairs. */
  const MAX_PAIRS = 64;
  const MAX_LONG_PREFIXES = 10;
  let pos = reader.tell();

  while (pos < buffer.length - 10) {
    const magicIdx = buffer.indexOf(MAGIC, pos);
    if (magicIdx < 3) break;
    let advanced = false;

    for (let pairs = 0; pairs <= MAX_PAIRS && !advanced; pairs++) {
      const shortAt = magicIdx - 3 - 8 * pairs;
      if (shortAt < 0) break;

      const typeByte = buffer[shortAt];
      if (typeByte !== StructureType.Package && typeByte !== StructureType.LibraryPart) continue;
      if (buffer.readInt16LE(shortAt + 1) !== pairs) continue;

      // Every prefix in a chain repeats the type byte, so walk back in 9-byte
      // steps while that holds and let the parse pick the real start.
      for (let long = 0; long <= MAX_LONG_PREFIXES; long++) {
        const structStart = shortAt - 9 * long;
        if (structStart < 0) break;
        if (long > 0 && buffer[structStart] !== typeByte) break;

        reader.seek(structStart);
        try {
          if (typeByte === StructureType.Package) {
            indexCachePackage(parsePackage(reader), pmd);
          } else {
            indexLibraryPart(parseLibraryPart(reader), cachedParts, exactNames);
          }
          pos = reader.tell();
          advanced = true;
          break;
        } catch {
          // Not the chain start; try one prefix further back.
        }
      }
    }

    if (!advanced) pos = magicIdx + 1;
  }
}

/**
 * Walk the Cache's five directory tables (docs/cadence-dsn-format.md §5.1),
 * handing every variant's record to `visit` as its own buffer. Tables: 0 empty,
 * 1 terminal symbols, 2 part views (24), 3 part cells (6), 4 packages (31). A
 * group is a name, a variant count, and per variant a source library, an id
 * twice, a type and one framed record bounded by its first full prefix.
 * Returns the offset where the tables end: the stream's length on every file.
 */
export function walkCacheTables(
  buffer: Buffer,
  visit: (type: number, name: string, record: Buffer) => void
): number {
  const reader = new BinaryReader(buffer);
  for (let table = 0; table < 5 && !reader.isEof(); table++) {
    const groups = reader.readUint16();
    for (let g = 0; g < groups; g++) {
      const name = reader.readStringLenZeroTerm();
      const variants = reader.readUint16();
      for (let v = 0; v < variants; v++) {
        reader.readStringLenZeroTerm(); // source library
        reader.skip(8); // id, id copy
        const type = reader.readUint16();
        const start = reader.tell();
        const end = start + 9 + buffer.readUInt32LE(start + 1);
        if (end > buffer.length) throw new Error(`Cache record at ${start} runs past the stream`);
        visit(type, name, buffer.subarray(start, end));
        reader.seek(end);
      }
    }
  }
  return reader.tell();
}

/**
 * Index the Cache's packages (pin maps) and part views (pin names, default
 * values) by walking its directory tables. A record that will not parse is
 * skipped; a stream whose tables will not walk falls back to scanning for
 * Package and LibraryPart records.
 */
export function parseCacheStream(
  buffer: Buffer,
  pmd: PinMapData,
  cachedParts: Map<string, CachedLibraryPart>,
  exactNames: Set<string> = new Set()
): void {
  if (buffer.length <= 10) return; // five empty tables
  try {
    walkCacheTables(buffer, (type, _name, record) => {
      try {
        if (type === StructureType.Package) {
          indexCachePackage(parsePackage(new BinaryReader(record)), pmd);
        } else if (type === StructureType.LibraryPart) {
          indexLibraryPart(parseLibraryPart(new BinaryReader(record)), cachedParts, exactNames);
        }
      } catch {
        // One record that will not parse costs that record.
      }
    });
  } catch {
    scanForStructures(new BinaryReader(buffer), buffer, pmd, cachedParts, exactNames);
  }
}
