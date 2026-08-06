/**
 * Pin Number Resolution
 *
 * Pure functions for resolving T0x10 logical pin indices to physical
 * pin numbers using Device pinMap data.
 */

import type { T0x10, PlacedInstance } from "./structures.js";
import type { PinMapData } from "./structure-types.js";
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
 * Find the pin map for a PlacedInstance, trying multiple matching strategies:
 * 1. Direct sourcePackage match
 * 2. Multi-unit: sourcePackage + unitRef extracted from pkgName
 * 3. Positional device assignment for multi-section components (no unit suffix)
 * 4. Normalized match: expand version-like suffixes with ".0"
 * 5. Stripped match: remove trailing _N suffix from sourcePackage
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

    // Fallback: a package whose devices are not enumerated in deviceUnitRefs
    // still has a single unit "A" entry to try.
    if (!unitRef && pinMaps.has(base + "A")) return base + "A";
  }

  return undefined;
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

  for (const maps of [pmd.pinMaps, pmd.cachePinMaps]) {
    const key = findPinMapKey(inst, maps, pmd.deviceUnitRefs, deviceIndex);
    if (key === undefined) continue;
    const ignores = pmd.pinIgnores.get(key);
    if (ignores && pin.pinIndex - 1 < ignores.length) return ignores[pin.pinIndex - 1];
  }

  return false;
}

const lookupPin = (
  map: (string | null)[] | undefined,
  pinIndex: number
): string | undefined => {
  if (!map || pinIndex - 1 >= map.length) return undefined;
  return map[pinIndex - 1] ?? undefined;
};

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
  if (pin.pinIndex <= 0) return String(pin.pinIndex || 1);
  const pinMap = findPinMap(inst, pmd.pinMaps, pmd.deviceUnitRefs, deviceIndex);
  const packagePin = lookupPin(pinMap, pin.pinIndex);

  if (pinMap && packagePin !== undefined) {
    // The Packages/ pinMap describes the physical package, whose pad count need
    // not match the schematic symbol's pin count: a 2-pin crystal may sit in a
    // 4-pad package, and one package may serve symbols that expose different
    // subsets of it. When the counts disagree, that map is not this symbol's,
    // and the Cache stream's schematic-level map is preferred.
    //
    // A CutiePi HDMI connector shows what riding on the wrong map costs: its
    // 23-pin symbol resolved through a 20-entry package map whose 17th and 18th
    // entries are transposed, so SCL and SDA came out swapped.
    if (pinMap.length !== inst.t0x10s.length) {
      const cacheMap = findPinMap(inst, pmd.cachePinMaps, pmd.deviceUnitRefs, deviceIndex);
      const cachePin = lookupPin(cacheMap, pin.pinIndex);
      if (cacheMap && cachePin !== undefined) {
        // An exact count match settles it either way.
        if (cacheMap.length === inst.t0x10s.length) return cachePin;
        // Otherwise only the long-package case is known to favour the Cache.
        if (pinMap.length > inst.t0x10s.length && cacheMap.length <= inst.t0x10s.length) {
          return cachePin;
        }
      }
    }
    return packagePin;
  }

  // The Packages/ lookup missed entirely, or has no entry at this index. The
  // Cache stream carries a schematic-level map for the same part, so consult it
  // before falling back to the symbol record order.
  const cachePin = lookupPin(
    findPinMap(inst, pmd.cachePinMaps, pmd.deviceUnitRefs, deviceIndex),
    pin.pinIndex
  );
  if (cachePin !== undefined) return cachePin;

  return String(pin.pinIndex);
}

/**
 * Map each PlacedInstance dbId to its 0-based section index within a
 * multi-section package (resistor packs, transistor arrays, multi-gate logic).
 *
 * The index is `PlacedInstance.sectionIndex`, read from the binary. Instances
 * whose pkgName already carries a unit suffix are skipped: those resolve their
 * Device by that suffix and never consult a positional index.
 */
export function buildDeviceIndexMap(pages: PageData[]): Map<number, number> {
  const result = new Map<number, number>();
  for (const page of pages) {
    for (const inst of page.placedInstances) {
      if (!inst.reference || !isValidRefdes(inst.reference)) continue;
      if (extractUnitRef(inst)) continue;
      result.set(inst.dbId, inst.sectionIndex);
    }
  }
  return result;
}
