/**
 * Pin Number Resolution
 *
 * Pure functions for resolving T0x10 logical pin indices to physical
 * pin numbers using Device pinMap data.
 */

import type { T0x10, PlacedInstance } from "./structures.js";
import type { CachedLibraryPart, PinMapData } from "./structure-types.js";
import { isValidRefdes } from "../../../circuit-traversal.js";
import type { PageData } from "./page-parser.js";

/**
 * Extract the unit reference letter from a multi-unit PlacedInstance.
 * pkgName format: "DP_HDMI_CONNA.Normal" -> unitRef "A"
 * Cadence sometimes doubles the letter: "OMAP_CBPAA.Normal" -> "AA",
 * but the pinMap key uses single letter "A", so we return both forms.
 */
export function extractUnitRef(inst: PlacedInstance): string | undefined {
  if (!inst.pkgName.startsWith(inst.sourcePackage)) return undefined;
  const suffix = inst.pkgName.slice(inst.sourcePackage.length);
  const dotIdx = suffix.indexOf(".");
  const raw = dotIdx >= 0 ? suffix.slice(0, dotIdx) : suffix;
  return raw || undefined;
}

/**
 * Find the pin map for a PlacedInstance. Each spelling of the package name
 * (sourcePackage as written, then with version-like `_N_` expanded to
 * `_N.0_`, then with a trailing `_N` stripped) is tried in turn for:
 * 1. Direct match (single-device packages)
 * 2. Multi-unit: name + unitRef extracted from pkgName
 * 3. Positional device assignment for multi-section components (no unit suffix)
 * Only when no spelling matches does a suffix that names no map fall back to
 * the section index, and an instance with no suffix to the unit "A" map.
 */
export function findPinMap(
  inst: PlacedInstance,
  pinMaps: Map<string, (string | null)[]>,
  deviceUnitRefs: Map<string, string[]>,
  deviceIndex?: number
): (string | null)[] | undefined {
  const key = findPinMapKey(inst, pinMaps, deviceUnitRefs, deviceIndex);
  return key === undefined ? undefined : pinMaps.get(key);
}

/**
 * The key under which this instance's pin map is stored, or undefined when no
 * strategy matches. Resolving the key rather than the value lets a caller read
 * the parallel `pinIgnores` entry for the same device.
 */
export function findPinMapKey(
  inst: PlacedInstance,
  pinMaps: Map<string, (string | null)[]>,
  deviceUnitRefs: Map<string, string[]>,
  deviceIndex?: number
): string | undefined {
  const unitRef = extractUnitRef(inst);

  // Try each base name candidate (original, then normalized, then stripped)
  const candidates = [inst.sourcePackage];
  const normalized = inst.sourcePackage.replace(/_(\d+)_/g, "_$1.0_");
  if (normalized !== inst.sourcePackage) candidates.push(normalized);
  const stripped = inst.sourcePackage.replace(/_\d+$/, "");
  if (stripped !== inst.sourcePackage) candidates.push(stripped);

  for (const base of candidates) {
    // Direct match (single-device packages)
    if (pinMaps.has(base)) return base;

    // Multi-unit: try base + unitRef
    if (unitRef) {
      if (pinMaps.has(base + unitRef)) return base + unitRef;

      // Cadence doubles unit letters in pkgName (e.g., "AA") but pinMap
      // keys use single letter ("A"). Try the first character.
      if (unitRef.length >= 2 && unitRef[0] === unitRef[1] && pinMaps.has(base + unitRef[0])) {
        return base + unitRef[0];
      }
    }

    // Positional assignment: use deviceIndex to select correct device
    if (!unitRef && deviceIndex !== undefined) {
      const unitRefs = deviceUnitRefs.get(base);
      if (unitRefs && deviceIndex < unitRefs.length && pinMaps.has(base + unitRefs[deviceIndex])) {
        return base + unitRefs[deviceIndex];
      }
    }
  }

  // A suffix that names no stored map: the part's sections are listed under
  // other names. A part numbered -1, -2, ... still draws its sections as
  // `<package>A`, `<package>B`, ... (§5.6.3), so its suffix letter is not its
  // section's name, and the record's section index names the section (§7.4).
  // Only once every spelling has had its suffix lookup, so a suffix that does
  // name a map always wins.
  if (unitRef && deviceIndex !== undefined) {
    for (const base of candidates) {
      const unitRefs = deviceUnitRefs.get(base);
      if (unitRefs && deviceIndex < unitRefs.length && pinMaps.has(base + unitRefs[deviceIndex])) {
        return base + unitRefs[deviceIndex];
      }
    }
  }

  // Fallback: a package whose devices are not enumerated in deviceUnitRefs
  // still has a single unit "A" entry to try. Only once every name has had
  // its positional lookup: when the sections are listed under one spelling
  // only (`LM324`, with maps under both `LM324_0A` and `LM324A`), taking
  // `LM324_0A` first would read every section of the part as section A.
  if (!unitRef) {
    for (const base of candidates) {
      if (pinMaps.has(base + "A")) return base + "A";
    }
  }

  return undefined;
}

const lookupPin = (map: (string | null)[] | undefined, pinIndex: number): string | undefined => {
  if (!map || pinIndex - 1 >= map.length) return undefined;
  return map[pinIndex - 1] ?? undefined;
};

/** The Cache definitions of the library this instance was placed from, when it names one. */
const ownLibrary = (inst: PlacedInstance, pmd: PinMapData): PinMapData | undefined =>
  inst.library === undefined ? undefined : pmd.libraries?.get(inst.library);

/**
 * Which stored pin map applies to this instance, and the flags that go with it.
 *
 * The `Packages/` map describes the physical package, whose pad count need not
 * equal the symbol's pin count, and one package may serve symbols exposing
 * different subsets of it. When the counts disagree, that map is not this
 * symbol's, and the Cache stream's schematic-level map is preferred.
 *
 * Resolving the choice once, here, is what keeps a pin's number and its Pin
 * Ignore flag consistent. The two streams store different pin counts under the
 * same key, so reading the number from one and the flag from the other indexes
 * two different pins.
 *
 * Before either, the instance's own definition: the Cache keeps one per name
 * and source library, and the instance names the library it was placed from
 * (§5.6). Capture's exports follow that definition where another library's,
 * or the `Packages/` stream's, differs under the same name.
 */
function selectPinMap(
  inst: PlacedInstance,
  pmd: PinMapData,
  deviceIndex: number | undefined
): { map: (string | null)[]; ignores: boolean[] | undefined } | undefined {
  const own = ownLibrary(inst, pmd);
  const ownKey = own && findPinMapKey(inst, own.cachePinMaps, own.deviceUnitRefs, deviceIndex);
  if (own && ownKey !== undefined) {
    return { map: own.cachePinMaps.get(ownKey)!, ignores: own.cachePinIgnores.get(ownKey) };
  }

  const packageKey = findPinMapKey(inst, pmd.pinMaps, pmd.deviceUnitRefs, deviceIndex);
  const packageMap = packageKey === undefined ? undefined : pmd.pinMaps.get(packageKey);

  const cacheKey = findPinMapKey(inst, pmd.cachePinMaps, pmd.deviceUnitRefs, deviceIndex);
  const cacheMap = cacheKey === undefined ? undefined : pmd.cachePinMaps.get(cacheKey);
  const cache =
    cacheMap === undefined
      ? undefined
      : { map: cacheMap, ignores: pmd.cachePinIgnores.get(cacheKey!) };

  if (packageMap === undefined) return cache;
  const fromPackage = { map: packageMap, ignores: pmd.pinIgnores.get(packageKey!) };
  if (packageMap.length === inst.t0x10s.length || cacheMap === undefined) return fromPackage;

  // An exact count match settles it either way.
  if (cacheMap.length === inst.t0x10s.length) return cache;
  // Otherwise only a package longer than the symbol is known to favour the Cache.
  if (packageMap.length > inst.t0x10s.length && cacheMap.length <= inst.t0x10s.length) return cache;
  return fromPackage;
}

/**
 * Whether this pin has no pad on this section of the package.
 *
 * A multi-section part whose sections do not all expose the same logical pins
 * marks the absent ones "Pin Ignore" (see Device.pinIgnore). Cadence leaves such
 * a pin out of the netlist: a quad RJ45's second shield pin exports as
 * `PIN_NUMBER='(0,0,0,S5)'`, so only the fourth section has it. Reporting it
 * would invent a connection on a pad the part does not have.
 */
export function isPinIgnored(
  pin: T0x10,
  inst: PlacedInstance,
  pmd: PinMapData,
  deviceIndex?: number
): boolean {
  if (pin.pinIndex <= 0) return false;
  const selected = selectPinMap(inst, pmd, deviceIndex);
  return selected?.ignores?.[pin.pinIndex - 1] ?? false;
}

/**
 * Whether the instance is a section of a package with several devices. There
 * an ignored slot is a pad that section does not have, never a shorted one.
 */
export const isMultiSection = (inst: PlacedInstance, pmd: PinMapData): boolean => {
  const names = [inst.sourcePackage, inst.sourcePackage.replace(/_\d+$/, "")];
  // The instance's own library decides where it defines the package (§5.6).
  const own = ownLibrary(inst, pmd);
  if (own && names.some((name) => own.cachePinMaps.has(name) || own.deviceUnitRefs.has(name))) {
    return names.some((name) => own.deviceUnitRefs.has(name));
  }
  return names.some((name) => pmd.deviceUnitRefs.has(name));
};

/** Whether the part's PACK_SHORT ties this pin to others (§5.8). */
export const isPackShorted = (pin: T0x10, inst: PlacedInstance): boolean =>
  inst.packShort?.some((group) => group.includes(pin.pinIndex)) ?? false;

/**
 * A library part's PACK_SHORT groups as 1-based pin indices, or undefined when
 * it has none. The value names pins shorted inside the package, one group per
 * parentheses, `(VDD,VDD1,VDD2)(GND,GND1,GND2)`, or a bare list for one group,
 * `S1,S2,S3`; names match the part's pin names case-insensitively (§5.8).
 */
export function packShortGroups(
  part: CachedLibraryPart | undefined,
  strLst: readonly string[]
): number[][] | undefined {
  const pair = part?.properties?.find(([name]) => strLst[name]?.toUpperCase() === "PACK_SHORT");
  const value = pair && strLst[pair[1]];
  if (!value) return undefined;
  const lists = value.includes("(")
    ? [...value.matchAll(/\(([^)]*)\)/g)].map((m) => m[1])
    : [value];
  const groups = lists
    .map((list) => {
      const names = new Set(list.split(",").map((n) => n.trim().toUpperCase()));
      return part!.pinNames.flatMap((n, i) => (names.has(n.toUpperCase()) ? [i + 1] : []));
    })
    .filter((group) => group.length > 1);
  return groups.length > 0 ? groups : undefined;
}

/**
 * Resolve a T0x10 pin to a physical pin number using package pin map data.
 *
 * Uses T0x10.pinIndex (1-based logical pin index from the binary) to look up
 * the physical pin number in the Device.pinMap array, preferring the
 * `Packages/` stream and falling back to the Cache stream.
 *
 * The pinIndex value itself is only used when neither stream maps it. That
 * value is the symbol's pin record order, which equals the physical pin number
 * only for parts whose symbol order matches their package numbering, so it is a
 * last resort rather than a peer of the two maps.
 */
export function resolvePinNumber(
  pin: T0x10,
  inst: PlacedInstance,
  pmd: PinMapData,
  deviceIndex?: number
): string {
  // The occurrence's own numbering wins: a part shared by several placements
  // of a block is drawn once but uses a different section in each.
  const assigned = inst.pinNumbers?.get(pin.pinIndex);
  if (assigned !== undefined) return assigned;

  if (pin.pinIndex <= 0) return String(pin.pinIndex || 1);

  // A map entry that is empty is no answer: a library part saved without pin
  // numbers writes one per pin, and reporting it would fold every pin of the
  // part into one nameless pin.
  const selected = selectPinMap(inst, pmd, deviceIndex);
  const selectedPin = lookupPin(selected?.map, pin.pinIndex);
  if (selectedPin) return selectedPin;

  // The chosen map has no entry at this index. The other stream may still carry
  // one, so try it before falling back to the symbol's own record order.
  for (const maps of [pmd.pinMaps, pmd.cachePinMaps]) {
    const other = lookupPin(findPinMap(inst, maps, pmd.deviceUnitRefs, deviceIndex), pin.pinIndex);
    if (other) return other;
  }

  return String(pin.pinIndex);
}

/**
 * Map each PlacedInstance dbId to its 0-based section index within a
 * multi-section package (resistor packs, transistor arrays, multi-gate logic).
 *
 * The index is `PlacedInstance.sectionIndex`, read from the binary. An
 * instance whose pkgName carries a unit suffix resolves its Device by that
 * suffix first, and by this index only when the suffix names no stored map.
 */
export function buildDeviceIndexMap(pages: PageData[]): Map<number, number> {
  const result = new Map<number, number>();
  for (const page of pages) {
    for (const inst of page.placedInstances) {
      if (!inst.reference || !isValidRefdes(inst.reference)) continue;
      result.set(inst.dbId, inst.sectionIndex);
    }
  }
  return result;
}
