/**
 * Component Builder
 *
 * Builds component details (MPN, value, pins with names) from
 * PlacedInstances and resolved pin connectivity.
 */

import type { ComponentDetails } from "../../../types.js";
import { createPinEntry, type PinEntry } from "../../../types.js";
import { isValidRefdes, hasDnsValueMarker } from "../../../circuit-traversal.js";
import type { PrefixPropertyPair } from "./generic-parser.js";
import type { CachedLibraryPart, PinMapData } from "./structure-types.js";
import type { PlacedInstance } from "./structures.js";
import type { PageData } from "./page-parser.js";
import { resolvePinNumber, isPinIgnored } from "./pin-resolver.js";

/**
 * Property names holding the design's own part number, in precedence order.
 *
 * A part record carries its properties in whatever order Cadence wrote them,
 * and the C++ reference (`GenericParser::read_single_prefix_short`) keeps that
 * order verbatim, so precedence has to be applied here rather than read off the
 * record. Scanning the record once and taking the first name that looks like a
 * part number lets the byte order decide: two instances of one part whose
 * records list the same properties in different orders then report part numbers
 * from different namespaces.
 */
const PART_NUMBER_KEYS = ["PART_NUMBER", "Part Number", "PART NUMBER", "PN"] as const;

/**
 * Property names holding the manufacturer's own part number, in precedence order.
 *
 * `MPN` is last despite naming the field exactly. Libraries that populate it by
 * hand populate it with whatever was nearby, commonly the library symbol's own
 * name, so a more specific spelling is preferred wherever the record offers
 * one and `MPN` is what remains.
 *
 * The list is long because no schematic library is obliged to agree with
 * another on the spelling, and the failure is asymmetric: a name missing here
 * makes a design report no manufacturer part number at all, which is harder to
 * notice than reporting a wrong one.
 *
 * Distributor part numbers are deliberately absent. A distributor's SKU is a
 * third namespace, neither the design's number nor the manufacturer's, and
 * putting one here would misattribute it to the manufacturer.
 */
const MANUFACTURER_PN_KEYS = [
  "Manufacturer PN",
  "MANUFACTURER_PN",
  "Manufacturer Part Number",
  "Vendor Part Number",
  "Vendor P/N",
  "MF_PART_NUMBER",
  "MPN",
] as const;

/**
 * Property names holding the manufacturer's name, in precedence order.
 *
 * An MPN identifies a part only within a manufacturer, so this is what turns
 * `mpn` from a string into a key. The misspelling is deliberate: it is in use.
 */
const MANUFACTURER_KEYS = ["Manufacturer", "MANUFACTURER", "Manufacture"] as const;

/**
 * Read the first property named by `keys` that carries a value.
 *
 * The key list is the outer loop, so the caller's precedence wins over the
 * order the record happens to store its properties in.
 */
function readProperty(
  prefixProperties: readonly PrefixPropertyPair[],
  strLst: string[],
  keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    for (const [nameIdx, valIdx] of prefixProperties) {
      if (nameIdx >= strLst.length || strLst[nameIdx] !== key) continue;
      if (valIdx < strLst.length && strLst[valIdx]) return strLst[valIdx];
    }
  }
  return undefined;
}

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

  // Try sourcePackage.Normal (e.g., pkgName="IC_VQFN48A.Normal" but the
  // cachedPart is keyed as "IC_VQFN48.Normal")
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
            if (t0x10.pinIndex > 0 && !isPinIgnored(t0x10, inst, pmd, deviceIndex)) {
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

      // Two part numbers in two namespaces, reported as two fields. One
      // manufacturer number maps to several internal ones, so neither can be
      // derived from the other and a caller given one field cannot tell which
      // it was handed. Each is omitted when the record does not carry it:
      // there is no fallback between them and none to the package name, since
      // a package name in `mpn` is a footprint claiming to be an orderable part.
      const internalPn = readProperty(inst.prefixProperties, strLst, PART_NUMBER_KEYS);
      const mpn = readProperty(inst.prefixProperties, strLst, MANUFACTURER_PN_KEYS);
      const manufacturer = readProperty(inst.prefixProperties, strLst, MANUFACTURER_KEYS);

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
      // The marker is the only thing on the schematic that says a part is not
      // stuffed, and cleaning it out of the value erases it, so read it first.
      let dns = false;
      if (value) {
        dns = hasDnsValueMarker(value);
        value = cleanDnsFromValue(value);
      }

      // Build pins with names from cached library parts
      const pinNets = componentPins.get(refdes);
      const pins: Record<string, PinEntry> = {};
      const cachedPart = findCachedPart(inst, cachedParts);

      if (pinNets) {
        // Build pinNumber -> pinIndex map for pin name lookup
        const pinNumToIndex = new Map<string, number>();
        // A pin the section has no pad for is absent from every net, so it must
        // not claim a pin-number slot here either: it would relabel the real pin
        // that shares that number with the ignored pin's function name.
        for (const t0x10 of inst.t0x10s) {
          if (t0x10.pinIndex > 0 && !isPinIgnored(t0x10, inst, pmd, deviceIndex)) {
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

      components[refdes] = { value, pins };
      if (mpn) components[refdes].mpn = mpn;
      if (internalPn) components[refdes].internal_pn = internalPn;
      if (manufacturer) components[refdes].manufacturer = manufacturer;
      if (dns) components[refdes].dns = true;
    }
  }

  // Post-process: disambiguate duplicate pin names across all components.
  // Multi-unit components have pins merged from multiple PlacedInstances,
  // so disambiguation must happen after all units are collected.
  disambiguatePinNames(components);

  return components;
}
