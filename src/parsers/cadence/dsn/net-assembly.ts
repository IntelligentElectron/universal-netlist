/**
 * Net Assembly
 *
 * Turns the collected pins into named nets: pins grouped by net id, names
 * resolved and disambiguated across pages, and the pins no wire reaches
 * matched to the nets the Hierarchy stream still lists.
 */

import type { NetConnections } from "../../../types.js";
import type { PinInfo } from "./net-pins.js";

function addPinToNet(
  nets: NetConnections,
  componentPins: Map<string, Map<string, string>>,
  netName: string,
  refdes: string,
  pinNumber: string
): void {
  if (!nets[netName]) nets[netName] = {};
  const existing = nets[netName][refdes];
  if (!existing) {
    nets[netName][refdes] = [pinNumber];
  } else if (!existing.includes(pinNumber)) {
    existing.push(pinNumber);
  }
  if (!componentPins.has(refdes)) componentPins.set(refdes, new Map());
  componentPins.get(refdes)!.set(pinNumber, netName);
}

/**
 * Disambiguate duplicate net names that appear on multiple pages.
 *
 * When the same net name appears on N pages as separate wire groups, the
 * Cadence DAT export keeps one bare and appends _<dbObjectId> to the rest.
 * The dbObjectId is a Cadence-internal net object ID not directly in the DSN,
 * but the hierarchy stream contains these suffixed names. We match page
 * groups to hierarchy suffixes using sort order: both the Cadence object IDs
 * and the page-local min pin IDs are allocated sequentially, so sorting by
 * either yields the same order.
 *
 * A candidate is only a collision rename if it clears two gates, because a
 * designer's own sibling net must never be mistaken for one:
 *
 * 1. The suffix must be entirely digits. A dbObjectId always is; `parseInt()`
 *    alone is too lenient, since it stops at the first non-digit and reads a
 *    rail-named sibling like `FOO_N_1V8` as suffix 1.
 * 2. The name must not already be some wire group's resolved name. A collision
 *    rename exists only in the hierarchy stream — it is never drawn as a wire
 *    label — so a name a page actually resolved to cannot be one. This is what
 *    catches an entirely-numeric family like `FOO_N_01/_02/_04`, which clears
 *    gate 1 on its own.
 *
 * Without both, the two-pointer condition `suffix <= minNetId` is trivially
 * true for such small suffixes, so every page group of the real `FOO_N` gets
 * renamed into a sibling: the bare net vanishes and its pins are silently
 * merged into unrelated real nets.
 *
 * Mutates netIdToName in place to apply suffixed names.
 */
export function disambiguateCrossPageNets(
  netIdToName: Map<number, string>,
  netIdGroups: Map<number, PinInfo[]>,
  canonicalNetNames: Set<string>
): void {
  // Group netIds by (resolvedName, pageIdx)
  const nameToPageGroups = new Map<string, Map<number, number[]>>();
  for (const [netId, name] of netIdToName) {
    if (!nameToPageGroups.has(name)) nameToPageGroups.set(name, new Map());
    const pageMap = nameToPageGroups.get(name)!;
    const pageIdx = netIdGroups.get(netId)![0].pageIdx;
    if (!pageMap.has(pageIdx)) pageMap.set(pageIdx, []);
    pageMap.get(pageIdx)!.push(netId);
  }

  for (const [name, pageMap] of nameToPageGroups) {
    if (pageMap.size <= 1) continue;

    // Find all suffixed variants in the hierarchy (e.g., GPIO0_21859572)
    const prefix = name + "_";
    const suffixedHier: { suffix: number; fullName: string }[] = [];
    for (const hierName of canonicalNetNames) {
      if (hierName.startsWith(prefix)) {
        // Claimed by a wire group => designer-authored sibling, not a rename.
        if (nameToPageGroups.has(hierName)) continue;
        const rawSuffix = hierName.substring(prefix.length);
        // A dbObjectId is entirely digits. parseInt() alone is too lenient: it
        // stops at the first non-digit, so a rail-named sibling like `_1V8`
        // reads as suffix 1.
        if (!/^\d+$/.test(rawSuffix)) continue;
        suffixedHier.push({ suffix: parseInt(rawSuffix), fullName: hierName });
      }
    }
    if (suffixedHier.length === 0) continue;
    suffixedHier.sort((a, b) => a.suffix - b.suffix);

    // Sort page groups by min netId
    const pageGroups: { pageIdx: number; minNetId: number; netIds: number[] }[] = [];
    for (const [pageIdx, netIds] of pageMap) {
      pageGroups.push({ pageIdx, minNetId: Math.min(...netIds), netIds });
    }
    pageGroups.sort((a, b) => a.minNetId - b.minNetId);

    // Two-pointer match: hierarchy suffixes track monotonically with page min
    // netIds. The page with no matching suffix keeps the bare name.
    let si = 0;
    for (let pi = 0; pi < pageGroups.length && si < suffixedHier.length; pi++) {
      if (suffixedHier[si].suffix <= pageGroups[pi].minNetId) {
        for (const nid of pageGroups[pi].netIds) {
          netIdToName.set(nid, suffixedHier[si].fullName);
        }
        si++;
      }
    }
  }
}

/**
 * Resolve the net name for a group of pins sharing the same netId.
 * Priority: hierarchy-canonical name > majority vote > fallback N{netId}.
 */
function resolveNetIdName(netId: number, pins: PinInfo[], canonicalNetNames: Set<string>): string {
  const nameCounts = new Map<string, number>();
  for (const pin of pins) {
    if (pin.coordNet) {
      nameCounts.set(pin.coordNet, (nameCounts.get(pin.coordNet) || 0) + 1);
    }
  }
  if (nameCounts.size === 0) return `N${netId}`;

  const canonicalMatch = [...nameCounts.keys()].find((n) => canonicalNetNames.has(n));
  if (canonicalMatch) return canonicalMatch;

  return [...nameCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * Classify pins into categories by netId type.
 *
 * Returns:
 * - noConnect: pins with netId=0 and no wire connection (unconnected)
 * - sentinelWired: sentinel pins (0xFFFFFFFF) touching a wire (have coordNet)
 * - sentinelWireless: sentinel pins grouped by page:coord (pin-to-pin overlaps)
 * - netIdGroups: normal pins grouped by netId
 */
function classifyPins(allPins: PinInfo[]): {
  noConnect: PinInfo[];
  sentinelWired: PinInfo[];
  sentinelWireless: Map<string, PinInfo[]>;
  netIdGroups: Map<number, PinInfo[]>;
} {
  const noConnect: PinInfo[] = [];
  const sentinelWired: PinInfo[] = [];
  const sentinelWireless = new Map<string, PinInfo[]>();
  const netIdGroups = new Map<number, PinInfo[]>();

  for (const pin of allPins) {
    if (pin.netId === 0) {
      if (pin.coordNet) {
        sentinelWired.push(pin); // connected via wire geometry despite no netId
      } else {
        noConnect.push(pin);
      }
    } else if (pin.netId === 0xffffffff) {
      if (pin.coordNet) {
        sentinelWired.push(pin);
      } else {
        const key = `${pin.pageIdx}:${pin.coord}`;
        if (!sentinelWireless.has(key)) sentinelWireless.set(key, []);
        sentinelWireless.get(key)!.push(pin);
      }
    } else {
      if (!netIdGroups.has(pin.netId)) netIdGroups.set(pin.netId, []);
      netIdGroups.get(pin.netId)!.push(pin);
    }
  }

  return { noConnect, sentinelWired, sentinelWireless, netIdGroups };
}

/**
 * Match pin-to-pin sentinel groups to unmatched hierarchy net names.
 *
 * Pin-to-pin connections (overlapping pins, no wire) have no net name in
 * the DSN page data. The hierarchy stream contains their canonical names
 * as N{dbObjectId} entries. After all wire-based nets are resolved, the
 * remaining unmatched N{number} hierarchy names correspond to these groups.
 *
 * Matching relies on Cadence allocating object IDs sequentially: sorting
 * hierarchy names by numeric value and groups by coordinate produces the
 * same relative order.
 */
function resolveWirelessSentinelNets(
  groups: Map<string, PinInfo[]>,
  canonicalNetNames: Set<string>,
  usedNetNames: Set<string>
): { netName: string; pins: PinInfo[] }[] {
  const multiPinGroups = [...groups.entries()]
    .filter(([, pins]) => pins.length >= 2)
    .sort(([a], [b]) => (a < b ? -1 : 1));

  if (multiPinGroups.length === 0) return [];

  const unmatchedHierNames = [...canonicalNetNames]
    .filter((n) => /^N\d+$/.test(n) && !usedNetNames.has(n))
    .sort((a, b) => parseInt(a.substring(1)) - parseInt(b.substring(1)));

  return multiPinGroups.map(([key, pins], i) => ({
    netName: i < unmatchedHierNames.length ? unmatchedHierNames[i] : `N${key.replace(":", "_")}`,
    pins,
  }));
}

/**
 * Assemble nets from collected pins.
 *
 * Pins are classified into four categories (see classifyPins), then each
 * category is resolved independently:
 * 1. No-connect pins (netId=0, no wire) -> "NC"
 * 2. Sentinel pins on wires (netId=0xFFFFFFFF, has coordNet) -> use wire name
 * 3. Normal pins (netId>0) -> group by netId, resolve name, disambiguate
 * 4. Sentinel pin-to-pin overlaps (no wire) -> match to hierarchy names
 */
export function assembleNets(
  allPins: PinInfo[],
  canonicalNetNames: Set<string>
): {
  nets: NetConnections;
  componentPins: Map<string, Map<string, string>>;
} {
  const nets: NetConnections = {};
  const componentPins = new Map<string, Map<string, string>>();
  const { noConnect, sentinelWired, sentinelWireless, netIdGroups } = classifyPins(allPins);

  // 1. No-connect pins
  for (const pin of noConnect) {
    addPinToNet(nets, componentPins, "NC", pin.refdes, pin.pinNumber);
  }

  // 2. Sentinel pins connected via wires
  for (const pin of sentinelWired) {
    addPinToNet(nets, componentPins, pin.coordNet!, pin.refdes, pin.pinNumber);
  }

  // 3. Normal pins: resolve names, disambiguate cross-page duplicates, assign
  const netIdToName = new Map<number, string>();
  for (const [netId, pins] of netIdGroups) {
    netIdToName.set(netId, resolveNetIdName(netId, pins, canonicalNetNames));
  }
  disambiguateCrossPageNets(netIdToName, netIdGroups, canonicalNetNames);

  for (const [netId, pins] of netIdGroups) {
    const netName = netIdToName.get(netId)!;
    for (const pin of pins) {
      addPinToNet(nets, componentPins, netName, pin.refdes, pin.pinNumber);
    }
  }

  // 4. Pin-to-pin sentinel connections (wireless overlaps)
  const wirelessNets = resolveWirelessSentinelNets(
    sentinelWireless,
    canonicalNetNames,
    new Set(Object.keys(nets))
  );
  for (const { netName, pins } of wirelessNets) {
    for (const pin of pins) {
      addPinToNet(nets, componentPins, netName, pin.refdes, pin.pinNumber);
    }
  }

  return { nets, componentPins };
}
