/**
 * Circuit traversal utilities for netlist analysis
 * Pure functions for identifying power/ground nets and passive components
 */

import { createHash } from "crypto";
import { getPinNet } from "./types.js";
import type { NetConnections, ComponentDetails, CircuitComponent } from "./types.js";

// Regex patterns for net classification.
// A "stop" net is any power or ground rail, so the three patterns below are
// derived from these shared alternation fragments to keep them in sync — adding
// a rail to POWER_NET_ALTERNATIVES automatically extends STOP_NET_PATTERN too.
// Ground tokens allow a trailing `\w*` so suffixed grounds are caught the same
// way the power rails are (e.g. KiCad's default `GNDREF`, plus `GNDD`, `GNDS`,
// `GNDPWR`, `AGND1`). The leading `^` anchor keeps this a prefix match, so a
// signal-ground like `SIG_GND` is still NOT classified as ground.
// Trade-off: because `\w` includes `_`, names like `GND_SENSE`/`GND_RETURN` now
// classify as ground. This is intentional — such names are almost always real
// ground domains (`GND_DIGITAL`, `GND_ANALOG`, `GND_CHASSIS`), and a missed
// ground that floods traversal is far worse than a false positive here.
const GROUND_NET_ALTERNATIVES = "GND\\w*|VSS\\w*|AGND\\w*|DGND\\w*|PGND\\w*|SGND\\w*|CGND\\w*";
const POWER_NET_ALTERNATIVES =
  "VCC\\w*|VDD\\w*|VIN\\w*|VOUT\\w*|VBAT\\w*|VBUS\\w*|VSYS\\w*|VREG\\w*|PWR_\\w+|RAIL_\\w+|PP\\w*|PN\\w*|LD_PP\\w*|LD_PN\\w*|[+-]?\\d+V\\d*\\w*|[+-].+";

const GROUND_NET_PATTERN = new RegExp(`^(${GROUND_NET_ALTERNATIVES})$`, "i");
const POWER_NET_PATTERN = new RegExp(`^(${POWER_NET_ALTERNATIVES})$`, "i");
const STOP_NET_PATTERN = new RegExp(
  `^(${GROUND_NET_ALTERNATIVES}|${POWER_NET_ALTERNATIVES})$`,
  "i"
);
const DNS_PATTERN =
  /(?:^|[_,\s])(DNS|DNP|DNF|DNI|DNM|NF|NC)(?:$|[_,\s])|DO\s*NOT\s*(STUFF|POPULATE|INSTALL|FIT|MOUNT)|NOT\s*(POPULATED|FITTED|CONNECTED|MOUNTED)|NO\s*POP/i;

/**
 * KiCad prefixes nets declared in a sub-sheet with their sheet path
 * (`/Sheet/GND`, or `/GND` for a net on the root sheet). Net classification
 * keys off the base name, so reduce to the final path segment before matching;
 * otherwise the leading slash defeats the `^`-anchored patterns and a ground
 * like `/GND` is treated as an ordinary signal.
 */
export const stripSheetPath = (netName: string): string => {
  const slash = netName.lastIndexOf("/");
  return slash === -1 ? netName : netName.slice(slash + 1);
};

/**
 * Check if a net name matches the ground pattern.
 */
export const isGroundNet = (netName: string): boolean =>
  GROUND_NET_PATTERN.test(stripSheetPath(netName));

/**
 * Check if a net name matches the power pattern.
 */
export const isPowerNet = (netName: string): boolean =>
  POWER_NET_PATTERN.test(stripSheetPath(netName));

/**
 * Check if a net name matches the stop pattern (power or ground).
 */
export const isStopNet = (netName: string): boolean =>
  STOP_NET_PATTERN.test(stripSheetPath(netName));

/**
 * Determine if a component is a traversable passive (R/RS, L, C, FB).
 */
const PASSIVE_PREFIXES = new Set(["RS", "R", "FR", "L", "C", "FB"]);

export const isPassive = (refdes: string): boolean => PASSIVE_PREFIXES.has(getRefdesPrefix(refdes));

/**
 * Determine if a component is a test point (refdes prefix TP), e.g. TP1, TP12.
 */
export const isTestpoint = (refdes: string): boolean => getRefdesPrefix(refdes) === "TP";

/**
 * Check if a string is a valid refdes (letters followed by alphanumerics).
 * Filters out Cadence instance paths like "@DESIGN.SHEET:INS123@PART".
 */
export const isValidRefdes = (refdes: string): boolean => /^[A-Z][A-Z0-9_]*$/i.test(refdes);

/**
 * Extract a refdes prefix (letters only).
 */
export const getRefdesPrefix = (refdes: string): string => {
  const match = refdes.toUpperCase().match(/^[A-Z]+/);
  return match ? match[0] : refdes.toUpperCase();
};

/**
 * Check if a refdes matches a prefix filter.
 */
export const matchesRefdesType = (refdes: string, type: string): boolean =>
  getRefdesPrefix(refdes) === type.toUpperCase();

/**
 * Detect Do Not Stuff components using common markers.
 */
export const isDnsComponent = (component?: {
  mpn?: string | null;
  description?: string;
  comment?: string;
}): boolean => {
  if (!component) return false;
  const haystack = `${component.mpn ?? ""} ${component.description ?? ""} ${component.comment ?? ""}`;
  return DNS_PATTERN.test(haystack);
};

/**
 * Strip DNS marker tokens from a comma-separated string.
 * Removes tokens matching DNS_PATTERN entirely, and strips trailing
 * `_DNS`, `_DNI`, `_DNP`, `_DNF` suffixes from remaining tokens.
 * Returns undefined if the result is empty.
 */
export const stripDnsMarkers = (str: string): string | undefined => {
  const tokens = str.split(",").reduce<string[]>((acc, raw) => {
    const token = raw.trim();
    if (!token) return acc;
    // Strip _DNS/_DNI/_DNP/_DNF/_DNM/_NF/_NC and anything after it
    const cleaned = token.replace(/[_\s](DNS|DNP|DNF|DNI|DNM|NF|NC)([_\s].*)?$/i, "");
    // Drop the token entirely if nothing remains or it's a standalone marker
    if (!cleaned || DNS_PATTERN.test(cleaned)) return acc;
    acc.push(cleaned);
    return acc;
  }, []);
  return tokens.length > 0 ? tokens.join(",") : undefined;
};

/**
 * Generate a natural sort key for strings with numbers.
 * Allows proper sorting like: U1, U2, U10 (instead of U1, U10, U2)
 */
export const naturalSortKey = (s: string | number): Array<string | number> => {
  const str = String(s);
  const parts = str.split(/(\d+)/);
  return parts.map((part) => {
    const num = parseInt(part, 10);
    return isNaN(num) ? part.toLowerCase() : num;
  });
};

/**
 * Natural sort comparator function.
 * Usage: array.sort(naturalSort)
 */
export const naturalSort = (a: string, b: string): number => {
  const aKey = naturalSortKey(a);
  const bKey = naturalSortKey(b);

  for (let i = 0; i < Math.min(aKey.length, bKey.length); i++) {
    const aVal = aKey[i];
    const bVal = bKey[i];

    if (aVal < bVal) return -1;
    if (aVal > bVal) return 1;
  }

  return aKey.length - bKey.length;
};

/**
 * Compute a stable hash for a circuit.
 * Components with the same XNET produce identical hashes regardless of query starting point.
 *
 * The canonical form covers connectivity only (refdes + per-net pin assignments).
 * Display metadata is deliberately excluded so that the same physical circuit
 * hashes identically no matter which backend parsed it: `mpn` is a best-effort,
 * backend-dependent field (the .dat path reports the pstxprt `MFGR_PN` or a
 * netlister part-name string truncated to 31 chars, while the .DSN path reports
 * an MPN-ish property or the bare `sourcePackage` symbol name), so hashing it
 * made every cross-backend comparison of an identical circuit mismatch. `value`
 * was already excluded for the same reason.
 */
export const computeCircuitHash = (components: CircuitComponent[]): string => {
  if (!components || components.length === 0) {
    return "0".repeat(16);
  }

  const sortedComponents = [...components].sort((a, b) => naturalSort(a.refdes, b.refdes));

  const canonicalForm = sortedComponents.map((comp) => ({
    refdes: comp.refdes,
    connections: comp.connections
      .map((conn) => ({
        pins: [...conn.pins].sort(naturalSort),
        net: conn.net,
      }))
      .sort((a, b) => a.net.localeCompare(b.net)),
  }));

  const canonicalJson = JSON.stringify(canonicalForm);
  const hash = createHash("sha256").update(canonicalJson).digest("hex");
  return hash.substring(0, 16);
};

interface FlatCircuitEntry {
  refdes: string;
  pin: string;
  net: string;
  mpn?: string;
  description?: string;
  comment?: string;
  value?: string;
  dns?: boolean;
}

export interface TraversalResult {
  components: CircuitComponent[];
  visited_nets: string[];
  skipped: Record<string, number>;
}

export interface TraversalOptions {
  skipTypes?: string[];
  includeDns?: boolean;
}

/**
 * Group flat pin connections by component (refdes).
 * Consolidates multiple pin entries for the same component.
 * Aggregates pins by net - multiple pins on the same net are grouped together.
 */
const groupCircuitPins = (
  flat: FlatCircuitEntry[],
  visitedNets: string[],
  skipped: Record<string, number>
): TraversalResult => {
  const byRefdes = new Map<
    string,
    {
      refdes: string;
      mpn?: string;
      description?: string;
      comment?: string;
      value?: string;
      dns?: boolean;
      netToPins: Map<string, string[]>;
    }
  >();

  for (const entry of flat) {
    let comp = byRefdes.get(entry.refdes);
    if (!comp) {
      comp = {
        refdes: entry.refdes,
        mpn: entry.mpn,
        description: entry.description,
        comment: entry.comment,
        value: entry.value,
        dns: entry.dns,
        netToPins: new Map(),
      };
      byRefdes.set(entry.refdes, comp);
    }

    if (!comp.netToPins.has(entry.net)) {
      comp.netToPins.set(entry.net, []);
    }
    const pinsForNet = comp.netToPins.get(entry.net)!;
    if (!pinsForNet.includes(entry.pin)) {
      pinsForNet.push(entry.pin);
    }
  }

  const components: CircuitComponent[] = [];
  for (const comp of byRefdes.values()) {
    const connections: Array<{ net: string; pins: string[] }> = [];

    for (const [net, pinList] of comp.netToPins.entries()) {
      connections.push({
        net,
        pins: pinList.sort(naturalSort),
      });
    }

    connections.sort((a, b) => naturalSort(a.pins[0] || "", b.pins[0] || ""));

    components.push({
      refdes: comp.refdes,
      mpn: comp.mpn,
      description: comp.description,
      comment: comp.comment,
      value: comp.value,
      dns: comp.dns,
      connections,
    });
  }

  return {
    components,
    visited_nets: visitedNets,
    skipped,
  };
};

/**
 * Traverse circuit from a starting net, following passive components.
 * Uses BFS to explore connections through R, L, C, FB components.
 * Stops at active components and power/ground nets.
 */
export const traverseCircuitFromNet = (
  startNet: string,
  nets: NetConnections,
  components: ComponentDetails,
  options: TraversalOptions = {}
): TraversalResult => {
  if (!startNet || !nets[startNet]) {
    return { components: [], visited_nets: [], skipped: {} };
  }

  const skipTypes = (options.skipTypes ?? []).map((type) => type.trim().toUpperCase());
  const includeDns = options.includeDns ?? false;
  const skipped: Record<string, number> = {};
  const skippedComponents = new Set<string>();

  const shouldSkipComponent = (
    refdes: string,
    _component: ComponentDetails[string] | undefined,
    isDns: boolean
  ): boolean => {
    if (!includeDns && isDns) {
      return true;
    }

    const prefix = getRefdesPrefix(refdes);
    const matchedType = skipTypes.find((type) => prefix === type);
    if (matchedType) {
      if (!skippedComponents.has(refdes)) {
        skippedComponents.add(refdes);
        skipped[matchedType] = (skipped[matchedType] || 0) + 1;
      }
      return true;
    }

    return false;
  };

  const visitedNets = new Set<string>([startNet]);
  const visitedPins = new Set<string>();
  const queue: string[] = [startNet];
  const flatCircuit: FlatCircuitEntry[] = [];

  while (queue.length > 0) {
    const currentNet = queue.shift()!;
    const netConnections = nets[currentNet] || {};

    for (const [refdes, pins] of Object.entries(netConnections)) {
      const comp = components[refdes];

      const dns = comp?.dns ?? false;
      if (shouldSkipComponent(refdes, comp, dns)) {
        continue;
      }

      const dnsFlag = includeDns && dns ? true : undefined;

      for (const pin of pins) {
        const pinId = `${refdes}:${pin}`;
        if (visitedPins.has(pinId)) continue;
        visitedPins.add(pinId);

        flatCircuit.push({
          refdes,
          pin,
          net: currentNet,
          mpn: comp?.mpn,
          description: comp?.description,
          comment: comp?.comment,
          value: comp?.value,
          dns: dnsFlag,
        });

        if (comp?.pins && isPassive(refdes)) {
          for (const [otherPin, otherNet] of Object.entries(comp.pins)) {
            if (otherPin === pin) continue;

            const otherPinId = `${refdes}:${otherPin}`;
            if (visitedPins.has(otherPinId)) continue;
            visitedPins.add(otherPinId);
            const otherNetName = getPinNet(otherNet);

            flatCircuit.push({
              refdes,
              pin: otherPin,
              net: otherNetName,
              mpn: comp?.mpn,
              description: comp?.description,
              comment: comp?.comment,
              value: comp?.value,
              dns: dnsFlag,
            });

            if (visitedNets.has(otherNetName)) continue;

            visitedNets.add(otherNetName);

            if (isStopNet(otherNetName)) continue;

            const otherNetConns = nets[otherNetName] || {};
            let hasPassiveToFollow = false;

            for (const [otherRefdes] of Object.entries(otherNetConns)) {
              const otherComp = components[otherRefdes];

              const otherDns = otherComp?.dns ?? false;
              if (shouldSkipComponent(otherRefdes, otherComp, otherDns)) {
                continue;
              }

              const otherDnsFlag = includeDns && otherDns ? true : undefined;
              if (isPassive(otherRefdes)) {
                hasPassiveToFollow = true;
              } else {
                const pinsOnNet = otherNetConns[otherRefdes];
                for (const activePin of pinsOnNet) {
                  const activePinId = `${otherRefdes}:${activePin}`;
                  if (!visitedPins.has(activePinId)) {
                    visitedPins.add(activePinId);
                    flatCircuit.push({
                      refdes: otherRefdes,
                      pin: activePin,
                      net: otherNetName,
                      mpn: otherComp?.mpn,
                      description: otherComp?.description,
                      comment: otherComp?.comment,
                      value: otherComp?.value,
                      dns: otherDnsFlag,
                    });
                  }
                }
              }
            }

            if (hasPassiveToFollow) {
              queue.push(otherNetName);
            }
          }
        }
      }
    }
  }

  return groupCircuitPins(flatCircuit, Array.from(visitedNets), skipped);
};
