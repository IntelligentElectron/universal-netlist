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
  const unitRef = extractUnitRef(inst);

  // Try each base name candidate (original, then normalized, then stripped)
  const candidates = [inst.sourcePackage];
  const normalized = inst.sourcePackage.replace(/_(\d+)_/g, "_$1.0_");
  if (normalized !== inst.sourcePackage) candidates.push(normalized);
  const stripped = inst.sourcePackage.replace(/_\d+$/, "");
  if (stripped !== inst.sourcePackage) candidates.push(stripped);

  for (const base of candidates) {
    // Direct match (single-device packages)
    const direct = pinMaps.get(base);
    if (direct) return direct;

    // Multi-unit: try base + unitRef
    if (unitRef) {
      const unitMatch = pinMaps.get(base + unitRef);
      if (unitMatch) return unitMatch;

      // Cadence doubles unit letters in pkgName (e.g., "AA") but pinMap
      // keys use single letter ("A"). Try the first character.
      if (unitRef.length >= 2 && unitRef[0] === unitRef[1]) {
        const singleMatch = pinMaps.get(base + unitRef[0]);
        if (singleMatch) return singleMatch;
      }
    }

    // Positional assignment: use deviceIndex to select correct device
    if (!unitRef && deviceIndex !== undefined) {
      const unitRefs = deviceUnitRefs.get(base);
      if (unitRefs && deviceIndex < unitRefs.length) {
        const match = pinMaps.get(base + unitRefs[deviceIndex]);
        if (match) return match;
      }
    }

    // Single-instance fallback (no positional info): try unit "A"
    if (!unitRef && deviceIndex === undefined) {
      const unitAMatch = pinMaps.get(base + "A");
      if (unitAMatch) return unitAMatch;
    }
  }

  return undefined;
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
    // When the Packages/ pinMap has more entries than the instance has T0x10
    // records, the physical package has pads not exposed on the schematic
    // symbol (e.g., a 2-pin crystal in a 4-pad package). In that case, the
    // Cache stream's pinMap reflects the schematic-level mapping and should
    // be preferred.
    if (pinMap.length > inst.t0x10s.length) {
      const cacheMap = findPinMap(inst, pmd.cachePinMaps, pmd.deviceUnitRefs, deviceIndex);
      const cachePin = lookupPin(cacheMap, pin.pinIndex);
      if (cacheMap && cacheMap.length <= inst.t0x10s.length && cachePin !== undefined) {
        return cachePin;
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
 * Build a map from PlacedInstance dbId to positional device index for
 * multi-section components (e.g., resistor packs, transistor arrays).
 *
 * When multiple PlacedInstances share the same (refdes, pkgName) and have no
 * unit suffix in pkgName, Cadence assigns Devices positionally by dbId order.
 * This function detects those groups and assigns 0-based indices.
 */
export function buildDeviceIndexMap(pages: PageData[]): Map<number, number> {
  const groups = new Map<string, PlacedInstance[]>();
  for (const page of pages) {
    for (const inst of page.placedInstances) {
      if (!inst.reference || !isValidRefdes(inst.reference)) continue;
      if (extractUnitRef(inst)) continue; // already has unit suffix
      const key = `${inst.reference}\0${inst.pkgName}`;
      const group = groups.get(key);
      if (group) group.push(inst);
      else groups.set(key, [inst]);
    }
  }

  const result = new Map<number, number>();
  for (const [, group] of groups) {
    if (group.length <= 1) continue;
    group.sort((a, b) => a.dbId - b.dbId);
    for (let i = 0; i < group.length; i++) {
      result.set(group[i].dbId, i);
    }
  }
  return result;
}
