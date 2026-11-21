/**
 * KiCad differential pairs. KiCad declares no pair: its router and DRC pair two
 * nets by name, and this reads the same pairs, less those that carry supplies.
 * See docs/decision-tables/kicad-diff-pairs.
 */

import type { ComponentDetails, NetConnections, PinType } from "../../types.js";

const POLARITY: Readonly<Record<string, string>> = { "+": "-", "-": "+", P: "N", N: "P" };

/**
 * The net KiCad pairs `name` with, as KiCad's `BOARD::MatchDpSuffix` finds it:
 * past trailing digits and `_`, the last character is `+`, `-`, `P` or `N`, and
 * the partner swaps it. The pair is named without that character, and without a
 * `_` it leaves dangling (`TRD0_P` is `TRD0`, `LVDS_P0` is `LVDS_0`).
 */
export const kicadPairPartner = (name: string): { partner: string; pair: string } | undefined => {
  for (let i = name.length - 1; i >= 0; i--) {
    const ch = name[i];
    if ((ch >= "0" && ch <= "9") || ch === "_") continue;
    if (!Object.hasOwn(POLARITY, ch)) return undefined;
    const [head, tail] = [name.slice(0, i), name.slice(i + 1)];
    const dangling = head.endsWith("_") && (tail === "" || tail.startsWith("_"));
    const pair = (dangling ? head.slice(0, -1) : head) + tail;
    return pair ? { partner: head + POLARITY[ch] + tail, pair } : undefined;
  }
  return undefined;
};

const SUPPLY_PIN_TYPES: ReadonlySet<PinType | undefined> = new Set<PinType>([
  "power",
  "power_in",
  "power_out",
]);

/** Whether a pin on the net is a supply pin by its electrical type. */
const carriesSupply = (net: string, nets: NetConnections, components: ComponentDetails): boolean =>
  Object.entries(nets[net]).some(([refdes, pins]) =>
    pins.some((pin) => {
      const entry = components[refdes]?.pins[pin];
      return typeof entry === "object" && SUPPLY_PIN_TYPES.has(entry.type);
    })
  );

/**
 * Each net in a pair, with the pair's name as its `DIFFERENTIAL_PAIR` property;
 * undefined when there is none. A pair whose nets carry a supply pin (`V+` and
 * `V-` feeding an op amp, `BAT+` and `BAT-`) is a supply, not a pair. Pairs whose
 * names would be one (`D+`/`D-` and `DP`/`DN` both make `D`) are each named after
 * their positive net, so a pair name always names two nets.
 */
export const kicadDifferentialPairs = (
  nets: NetConnections,
  components: ComponentDetails
): Record<string, Record<string, string>> | undefined => {
  const found: { positive: string; negative: string; pair: string }[] = [];
  for (const net of Object.keys(nets)) {
    const match = kicadPairPartner(net);
    // Each pair once, from its positive net: polarity `+` or `P` before trailing digits and `_`.
    if (!match || !Object.hasOwn(nets, match.partner) || !/[+P][\d_]*$/.test(net)) continue;
    if (carriesSupply(net, nets, components) || carriesSupply(match.partner, nets, components)) {
      continue;
    }
    found.push({ positive: net, negative: match.partner, pair: match.pair });
  }
  if (found.length === 0) return undefined;
  const uses = new Map<string, number>();
  for (const { pair } of found) uses.set(pair, (uses.get(pair) ?? 0) + 1);
  const pairs: Record<string, Record<string, string>> = {};
  for (const { positive, negative, pair } of found) {
    const name = uses.get(pair)! > 1 ? positive : pair;
    pairs[positive] = { DIFFERENTIAL_PAIR: name };
    pairs[negative] = { DIFFERENTIAL_PAIR: name };
  }
  return pairs;
};
