/**
 * What a net is called.
 *
 * A net takes the name of its strongest identifier: a labelled signal harness
 * (`<label>.<entry>`), a net label, a power port, a port, a sheet entry. A power port
 * goes first when the project gives it priority. A net no identifier names is called
 * after its lowest pin, `Net<designator>_<pin>`.
 */

import { RECORD_TYPES, type AltiumNet, type AltiumSchematic, type NetNameSource } from "./types.js";
import { fieldText } from "./records.js";
import { pinDesignator, pinNumber } from "./components.js";
import { identifierKey } from "./notation.js";

/** The project options that decide which identifiers name a net, and in what order. */
export interface NetNamingOptions {
  /** `AllowPortNetNames`, off unless the project sets it. */
  allowPortNetNames: boolean;
  /** `AllowSheetEntryNetNames`, on unless the project clears it. */
  allowSheetEntryNetNames: boolean;
  /** `PowerPortNamesTakePriority`, off unless the project sets it. */
  powerPortNamesTakePriority: boolean;
}

/** A sheet read on its own: every identifier names, power ports first. */
export const NAME_FROM_ANY: NetNamingOptions = {
  allowPortNetNames: true,
  allowSheetEntryNetNames: true,
  powerPortNamesTakePriority: true,
};

/** The name source each identifier record is. A harness entry names only a labelled harness. */
const RECORD_SOURCE: Readonly<Record<string, NetNameSource>> = {
  [RECORD_TYPES.POWER_PORT]: "power",
  [RECORD_TYPES.HARNESS_ENTRY]: "harness",
  [RECORD_TYPES.NET_LABEL]: "label",
  [RECORD_TYPES.PORT]: "port",
  [RECORD_TYPES.SHEET_ENTRY]: "entry",
};

/** The name sources, strongest first. */
const namingOrder = (options: NetNamingOptions): NetNameSource[] =>
  options.powerPortNamesTakePriority
    ? ["power", "harness", "label", "port", "entry", "pin"]
    : ["harness", "label", "power", "port", "entry", "pin"];

/** Each name source's rank, lower being stronger. */
export const nameRanks = (options: NetNamingOptions): Readonly<Record<NetNameSource, number>> =>
  Object.fromEntries(namingOrder(options).map((source, rank) => [source, rank])) as Record<
    NetNameSource,
    number
  >;

const namingAllowed = (source: NetNameSource, options: NetNamingOptions): boolean =>
  source === "port"
    ? options.allowPortNetNames
    : source === "entry"
      ? options.allowSheetEntryNetNames
      : true;

/** Text as Altium orders designators and pins in a net name: punctuation before letters. */
const collate = new Intl.Collator("en").compare;

/** Pin numbers in numeric order where both are numbers, numbers first, then by text. */
const comparePinNumbers = (a: string, b: string): number => {
  const numberA = parseInt(a, 10);
  const numberB = parseInt(b, 10);
  if (!Number.isNaN(numberA) && !Number.isNaN(numberB)) return numberA - numberB;
  if (!Number.isNaN(numberA)) return -1;
  if (!Number.isNaN(numberB)) return 1;
  return collate(a, b);
};

/**
 * Designators by prefix, then number, then any suffix: `R9` before `R11`, a bare
 * prefix before the same prefix with a number.
 */
const compareRefdes = (a: string, b: string): number => {
  const split = /^([^0-9]*)(\d+)?(.*)$/;
  const [, prefixA = "", digitsA, restA = ""] = a.match(split) ?? [];
  const [, prefixB = "", digitsB, restB = ""] = b.match(split) ?? [];
  if (prefixA !== prefixB) return collate(prefixA, prefixB);
  if (digitsA === undefined || digitsB === undefined) {
    if (digitsA === digitsB) return collate(restA, restB);
    return digitsA === undefined ? -1 : 1;
  }
  return parseInt(digitsA, 10) - parseInt(digitsB, 10) || collate(restA, restB);
};

/** The name an identifier claims; a harness entry claims one only on a labelled harness. */
const claimedName = (device: AltiumNet["devices"][number]): string | undefined =>
  device.RECORD === RECORD_TYPES.HARNESS_ENTRY
    ? device.harnessNetName || undefined
    : fieldText(device, "Text", "Name");

/** A name a net can take, and the record that claims it. */
interface Candidate {
  name: string;
  source: NetNameSource;
  /** Index of the claiming record. */
  claim: number;
  pin?: { refdes: string; pin: string };
}

/**
 * A net's names in the order it takes them: identifiers strongest source first, two of one
 * source in sort order; then its pins, lowest designator and pin first.
 */
const candidatesOf = (
  net: AltiumNet,
  schematic: AltiumSchematic,
  options: NetNamingOptions
): Candidate[] => {
  const claims = new Map<NetNameSource, Map<string, number>>();
  const pins = new Map<string, Map<string, number>>();
  for (const device of net.devices) {
    if (device.RECORD === RECORD_TYPES.PIN) {
      const refdes = pinDesignator(device, schematic);
      const pin = pinNumber(device);
      if (!refdes || !pin) continue;
      const numbers = pins.get(refdes) ?? pins.set(refdes, new Map()).get(refdes)!;
      if (!numbers.has(pin)) numbers.set(pin, device.index);
      continue;
    }
    const source = device.RECORD === undefined ? undefined : RECORD_SOURCE[device.RECORD];
    const name = source && claimedName(device);
    if (!source || !name) continue;
    const names = claims.get(source) ?? claims.set(source, new Map()).get(source)!;
    if (!names.has(name)) names.set(name, device.index);
  }

  const candidates: Candidate[] = [];
  for (const source of namingOrder(options)) {
    if (!namingAllowed(source, options)) continue;
    const names = claims.get(source) ?? new Map<string, number>();
    for (const name of [...names.keys()].sort()) {
      candidates.push({ name, source, claim: names.get(name)! });
    }
  }
  for (const refdes of [...pins.keys()].sort(compareRefdes)) {
    const numbers = pins.get(refdes)!;
    for (const pin of [...numbers.keys()].sort(comparePinNumbers)) {
      candidates.push({
        name: `Net${refdes}_${pin}`,
        source: "pin",
        claim: numbers.get(pin)!,
        pin: { refdes, pin },
      });
    }
  }
  return candidates;
};

/**
 * Name a sheet's nets, no two alike ignoring case. Names are given strongest first; of two
 * nets claiming one name at one rank, the one whose record comes first keeps it, and the
 * other takes its next name. A net with pins whose every name is taken is numbered after
 * its lowest pin.
 */
export const nameSheetNets = (
  nets: readonly AltiumNet[],
  schematic: AltiumSchematic,
  options: NetNamingOptions = NAME_FROM_ANY
): void => {
  const ranks = nameRanks(options);
  const queue = nets.map((net) => {
    net.name = null;
    net.nameSource = undefined;
    net.pinNameSource = undefined;
    return { net, candidates: candidatesOf(net, schematic, options), next: 0 };
  });
  type Entry = (typeof queue)[number];
  const before = (a: Entry, b: Entry): number => {
    const [x, y] = [a.candidates[a.next], b.candidates[b.next]];
    return ranks[x.source] - ranks[y.source] || x.claim - y.claim;
  };
  const pending = queue.filter((entry) => entry.candidates.length > 0).sort(before);

  const held = new Set<string>();
  const give = (net: AltiumNet, name: string, candidate: Candidate): void => {
    net.name = name;
    net.nameSource = candidate.source;
    net.pinNameSource = candidate.pin;
    held.add(identifierKey(name));
  };
  for (let i = 0; i < pending.length; i++) {
    const entry = pending[i];
    const candidate = entry.candidates[entry.next];
    if (!held.has(identifierKey(candidate.name))) {
      give(entry.net, candidate.name, candidate);
      continue;
    }
    do entry.next++;
    while (
      entry.next < entry.candidates.length &&
      held.has(identifierKey(entry.candidates[entry.next].name))
    );
    if (entry.next < entry.candidates.length) {
      let at = i + 1;
      while (at < pending.length && before(pending[at], entry) <= 0) at++;
      pending.splice(at, 0, entry);
      continue;
    }
    const lowestPin = entry.candidates.find((option) => option.source === "pin");
    if (!lowestPin) continue;
    let n = 2;
    while (held.has(identifierKey(`${lowestPin.name}_${n}`))) n++;
    give(entry.net, `${lowestPin.name}_${n}`, { ...lowestPin, pin: undefined });
  }
};
