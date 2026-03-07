/**
 * Component Builder
 *
 * Builds component details (MPN, value, pins with names) from
 * PlacedInstances and resolved pin connectivity.
 */

import type { ComponentDetails } from "../../../types.js";
import { createPinEntry, type PinEntry } from "../../../types.js";
import { isValidRefdes } from "../../../circuit-traversal.js";
import type { CachedLibraryPart, PinMapData } from "./structure-types.js";
import type { PlacedInstance } from "./structures.js";
import type { PageData } from "./page-parser.js";
import { resolvePinNumber } from "./pin-resolver.js";

/** Property name keys recognized as MPN fields in prefix properties. */
const MPN_KEYS = new Set(["Part Number", "PART_NUMBER", "MPN", "Manufacturer PN"]);

/** DNS markers that Cadence embeds in value strings. */
const DNS_MARKERS = /(?:,\s*(?:DNI|DNM|DNP|DNS|NC)|(?:DNI|DNM|DNP|DNS),\s*|_NC$)/gi;

/**
 * Strip DNS (Do Not Stuff) markers from component values.
 * Cadence sometimes embeds "DNI", "DNP", "DNM", or "_NC" in the value field
 * (e.g., "10K,DNI", "DNI,0", "10K_NC"), but the DAT export strips them.
 */
function cleanDnsFromValue(value: string): string {
  const cleaned = value.replace(DNS_MARKERS, "").trim();
  return cleaned || value;
}

/**
 * Find the CachedLibraryPart for a PlacedInstance, trying multiple key strategies:
 * 1. Exact pkgName match
 * 2. sourcePackage + ".Normal" (when pkgName has unit suffix like "FOO_0A.Normal")
 * 3. Suffix-stripped sourcePackage + ".Normal"
 */
function findCachedPart(
  inst: PlacedInstance,
  cachedParts: Map<string, CachedLibraryPart>
): CachedLibraryPart | undefined {
  const direct = cachedParts.get(inst.pkgName);
  if (direct) return direct;

  // Try sourcePackage.Normal (e.g., pkgName="IC_RF_CC1310F128RGZT_VQFN48A.Normal"
  // but cachedPart is keyed as "IC_RF_CC1310F128RGZT_VQFN48.Normal")
  const dotIdx = inst.pkgName.indexOf(".");
  const variant = dotIdx >= 0 ? inst.pkgName.substring(dotIdx) : ".Normal";
  const spKey = inst.sourcePackage + variant;
  if (spKey !== inst.pkgName) {
    const spMatch = cachedParts.get(spKey);
    if (spMatch) return spMatch;
  }

  // Try stripped sourcePackage (remove trailing _N)
  const stripped = inst.sourcePackage.replace(/_\d+$/, "");
  if (stripped !== inst.sourcePackage) {
    const strippedKey = stripped + variant;
    const strippedMatch = cachedParts.get(strippedKey);
    if (strippedMatch) return strippedMatch;
  }

  return undefined;
}

/**
 * Disambiguate duplicate pin names within each component by appending #pinNum.
 * Matches Cadence DAT export behavior (e.g., GND appears on pins 10 and 11
 * becomes GND#10 and GND#11).
 */
function disambiguatePinNames(components: ComponentDetails): void {
  for (const comp of Object.values(components)) {
    // Count occurrences of each pin name
    const nameCounts = new Map<string, number>();
    for (const [, entry] of Object.entries(comp.pins)) {
      const name = typeof entry === "string" ? undefined : entry.name;
      if (name) nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
    }

    // Append #pinNum to duplicates
    for (const [pinNum, entry] of Object.entries(comp.pins)) {
      if (typeof entry !== "string" && nameCounts.get(entry.name)! > 1) {
        comp.pins[pinNum] = { name: `${entry.name}#${pinNum}`, net: entry.net };
      }
    }
  }
}

/** Build components from PlacedInstances, enriched with MPN, value, and pin names. */
export function buildComponents(
  pages: PageData[],
  componentPins: Map<string, Map<string, string>>,
  strLst: string[],
  cachedParts: Map<string, CachedLibraryPart>,
  pmd: PinMapData,
  deviceIndexMap: Map<number, number>
): ComponentDetails {
  const components: ComponentDetails = {};

  for (const page of pages) {
    for (const inst of page.placedInstances) {
      const refdes = inst.reference;
      if (!refdes || !isValidRefdes(refdes)) continue;
      const deviceIndex = deviceIndexMap.get(inst.dbId);

      // For multi-unit components (same refdes, multiple PlacedInstances),
      // merge pins from each unit into the existing component entry.
      if (components[refdes]) {
        const existing = components[refdes];
        const pinNets = componentPins.get(refdes);
        if (pinNets) {
          const unitCachedPart = findCachedPart(inst, cachedParts);
          const pinNumToIndex = new Map<string, number>();
          for (const t0x10 of inst.t0x10s) {
            if (t0x10.pinIndex > 0) {
              pinNumToIndex.set(resolvePinNumber(t0x10, inst, pmd, deviceIndex), t0x10.pinIndex);
            }
          }
          for (const [pinNumber, netName] of pinNets) {
            if (existing.pins[pinNumber]) continue;
            let pinName: string | undefined;
            if (unitCachedPart) {
              const idx = pinNumToIndex.get(pinNumber);
              if (idx !== undefined && idx - 1 < unitCachedPart.pinNames.length) {
                pinName = unitCachedPart.pinNames[idx - 1]?.toUpperCase();
              }
            }
            existing.pins[pinNumber] = createPinEntry(pinNumber, pinName, netName);
          }
        }
        continue;
      }

      // Resolve MPN from prefix properties, fallback to sourcePackage
      let mpn: string | undefined;
      for (const [nameIdx, valIdx] of inst.prefixProperties) {
        if (nameIdx < strLst.length && MPN_KEYS.has(strLst[nameIdx])) {
          if (valIdx < strLst.length && strLst[valIdx]) {
            mpn = strLst[valIdx];
            break;
          }
        }
      }
      if (!mpn) mpn = inst.sourcePackage;

      // Resolve value (3-source priority)
      let value: string | undefined;
      // Source A: prefix property with key "Value"
      for (const [nameIdx, valIdx] of inst.prefixProperties) {
        if (nameIdx < strLst.length && strLst[nameIdx] === "Value") {
          if (valIdx < strLst.length && strLst[valIdx]) {
            value = strLst[valIdx];
            break;
          }
        }
      }
      // Source B: partValueIdx in PlacedInstance body
      if (!value && inst.partValueIdx > 0 && inst.partValueIdx < strLst.length) {
        const v = strLst[inst.partValueIdx];
        if (v) value = v;
      }
      // Source C: cached library part default value
      if (!value) {
        const cached = findCachedPart(inst, cachedParts);
        if (cached?.defaultValue) value = cached.defaultValue;
      }
      // Strip DNS markers from values (e.g., "10K,DNI" -> "10K", "DNI,0" -> "0")
      if (value) value = cleanDnsFromValue(value);

      // Build pins with names from cached library parts
      const pinNets = componentPins.get(refdes);
      const pins: Record<string, PinEntry> = {};
      const cachedPart = findCachedPart(inst, cachedParts);

      if (pinNets) {
        // Build pinNumber -> pinIndex map for pin name lookup
        const pinNumToIndex = new Map<string, number>();
        for (const t0x10 of inst.t0x10s) {
          if (t0x10.pinIndex > 0) {
            pinNumToIndex.set(resolvePinNumber(t0x10, inst, pmd, deviceIndex), t0x10.pinIndex);
          }
        }

        for (const [pinNumber, netName] of pinNets) {
          let pinName: string | undefined;
          if (cachedPart) {
            const idx = pinNumToIndex.get(pinNumber);
            if (idx !== undefined && idx - 1 < cachedPart.pinNames.length) {
              pinName = cachedPart.pinNames[idx - 1]?.toUpperCase();
            }
          }
          pins[pinNumber] = createPinEntry(pinNumber, pinName, netName);
        }
      }

      components[refdes] = { mpn, value, pins };
    }
  }

  // Post-process: disambiguate duplicate pin names across all components.
  // Multi-unit components have pins merged from multiple PlacedInstances,
  // so disambiguation must happen after all units are collected.
  disambiguatePinNames(components);

  return components;
}
