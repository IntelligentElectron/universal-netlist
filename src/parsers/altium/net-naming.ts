/**
 * What a net is called.
 *
 * A net takes the name of its strongest identifier: a labelled signal harness
 * (`<label>.<entry>`), a net label, a power port, a port. A power port goes first when the
 * project gives it priority. A sheet entry names nothing. A net no identifier names is
 * called after its lowest pin, `Net<designator>_<pin>`.
 */

import {
  RECORD_TYPES,
  type AltiumNet,
  type AltiumSchematic,
  type NetNameSource,
  type PinNameSource,
} from "./types.js";
import { fieldText } from "./records.js";
import { pinDesignator, pinNumber } from "./components.js";
import { firstFreeName, identifierKey } from "./notation.js";

/** The project options that decide which identifiers name a net, and in what order. */
export interface NetNamingOptions {
  /** `AllowPortNetNames`, off unless the project sets it. */
  allowPortNetNames: boolean;
  /** `PowerPortNamesTakePriority`, off unless the project sets it. */
  powerPortNamesTakePriority: boolean;
}

/** A sheet read on its own: every identifier names, power ports first. */
export const NAME_FROM_ANY: NetNamingOptions = {
  allowPortNetNames: true,
  powerPortNamesTakePriority: true,
};

/** The name source each identifier record is. A harness entry names only a labelled harness. */
const RECORD_SOURCE: Readonly<Record<string, NetNameSource>> = {
  [RECORD_TYPES.POWER_PORT]: "power",
  [RECORD_TYPES.HARNESS_ENTRY]: "harness",
  [RECORD_TYPES.NET_LABEL]: "label",
  [RECORD_TYPES.PORT]: "port",
};

/** The name sources, strongest first. */
const namingOrder = (options: NetNamingOptions): NetNameSource[] =>
  options.powerPortNamesTakePriority
    ? ["power", "harness", "label", "port", "pin"]
    : ["harness", "label", "power", "port", "pin"];

/** Each name source's rank, lower being stronger. */
export const nameRanks = (options: NetNamingOptions): Readonly<Record<NetNameSource, number>> =>
  Object.fromEntries(namingOrder(options).map((source, rank) => [source, rank])) as Record<
    NetNameSource,
    number
  >;

const namingAllowed = (source: NetNameSource, options: NetNamingOptions): boolean =>
  source !== "port" || options.allowPortNetNames;

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

/**
 * Two pin names, `Net<designator>_<pin>`, in the order a net takes them: by designator,
 * then pin. Undefined when either is not a pin name.
 */
export const comparePinNetNames = (a: string, b: string): number | undefined => {
  const pinName = /^Net(.+)_([^_]+)$/;
  const [x, y] = [a.match(pinName), b.match(pinName)];
  if (!x || !y) return undefined;
  return compareRefdes(x[1], y[1]) || comparePinNumbers(x[2], y[2]);
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
  pin?: PinNameSource;
  /** The lowest pin's name, to be numbered past every name held when its turn comes. */
  numbered?: boolean;
}

/**
 * The names a net's identifiers give it, in the order it takes them: strongest source first,
 * two of one source in sort order.
 */
const identifierNames = (net: AltiumNet, options: NetNamingOptions): Candidate[] => {
  const claims = new Map<NetNameSource, Map<string, number>>();
  for (const device of net.devices) {
    const source = device.RECORD === undefined ? undefined : RECORD_SOURCE[device.RECORD];
    const name = source && claimedName(device);
    if (!source || !name) continue;
    const names = claims.get(source) ?? claims.set(source, new Map()).get(source)!;
    if (!names.has(name)) names.set(name, device.index);
  }
  return namingOrder(options)
    .filter((source) => namingAllowed(source, options))
    .flatMap((source) => {
      const names = claims.get(source) ?? new Map<string, number>();
      return [...names.keys()].sort().map((name) => ({ name, source, claim: names.get(name)! }));
    });
};

/** The name a pin gives its net. */
export const pinNetName = ({ refdes, pin }: PinNameSource): string => `Net${refdes}_${pin}`;

/** The names a net's pins give it: lowest designator first, then lowest pin. */
const pinNames = (net: AltiumNet, schematic: AltiumSchematic): Candidate[] => {
  const pins = new Map<string, Map<string, number>>();
  for (const device of net.devices) {
    if (device.RECORD !== RECORD_TYPES.PIN) continue;
    const refdes = pinDesignator(device, schematic);
    const pin = pinNumber(device);
    if (!refdes || !pin) continue;
    const numbers = pins.get(refdes) ?? pins.set(refdes, new Map()).get(refdes)!;
    if (!numbers.has(pin)) numbers.set(pin, device.index);
  }
  return [...pins.keys()].sort(compareRefdes).flatMap((refdes) => {
    const numbers = pins.get(refdes)!;
    return [...numbers.keys()].sort(comparePinNumbers).map((pin) => ({
      name: pinNetName({ refdes, pin }),
      source: "pin" as const,
      claim: numbers.get(pin)!,
      pin: { refdes, pin },
    }));
  });
};

/**
 * Name a sheet's nets, no two alike ignoring case, pinless nets among them. Nets choose in
 * turn: the net whose next name ranks strongest first, and between two of one rank the one
 * whose claiming record comes first. A net whose next name is taken moves on to the one
 * after. A net with pins whose every name is taken is, at its turn among pin names, called
 * after its lowest pin numbered past every name then held; a net without pins goes unnamed.
 */
export const nameSheetNets = (
  nets: readonly AltiumNet[],
  schematic: AltiumSchematic,
  options: NetNamingOptions = NAME_FROM_ANY
): void => {
  const ranks = nameRanks(options);
  const give = (net: AltiumNet, candidate: Candidate | undefined, name = candidate?.name): void => {
    net.name = name ?? null;
    net.nameSource = candidate?.source;
    net.pinNameSource = candidate?.pin;
  };

  interface Entry {
    net: AltiumNet;
    candidates: Candidate[];
    pinsAdded: boolean;
    next: number;
  }
  /**
   * Move an entry to its next candidate: its pin names once its identifiers run out, and
   * after them its lowest pin's name numbered.
   */
  const advance = (entry: Entry): Candidate | undefined => {
    entry.next++;
    if (entry.next === entry.candidates.length && !entry.pinsAdded) {
      entry.pinsAdded = true;
      const pins = pinNames(entry.net, schematic);
      entry.candidates.push(...pins);
      if (pins.length > 0) entry.candidates.push({ ...pins[0], numbered: true });
    }
    return entry.candidates[entry.next];
  };
  const before = (a: Entry, b: Entry): number => {
    const [x, y] = [a.candidates[a.next], b.candidates[b.next]];
    return (
      ranks[x.source] - ranks[y.source] ||
      Number(x.numbered ?? false) - Number(y.numbered ?? false) ||
      x.claim - y.claim
    );
  };

  const pending: Entry[] = [];
  for (const net of nets) {
    const entry: Entry = {
      net,
      candidates: identifierNames(net, options),
      pinsAdded: false,
      next: -1,
    };
    give(net, undefined);
    if (advance(entry)) pending.push(entry);
  }
  pending.sort(before);

  const held = new Set<string>();
  const isHeld = (candidate: Candidate): boolean =>
    !candidate.numbered && held.has(identifierKey(candidate.name));
  for (let i = 0; i < pending.length; i++) {
    const entry = pending[i];
    let candidate: Candidate | undefined = entry.candidates[entry.next];
    if (!isHeld(candidate)) {
      const name = candidate.numbered ? firstFreeName(candidate.name, held) : candidate.name;
      give(entry.net, candidate, name);
      held.add(identifierKey(name));
      continue;
    }
    do candidate = advance(entry);
    while (candidate && isHeld(candidate));
    if (!candidate) continue;
    let [low, high] = [i + 1, pending.length];
    while (low < high) {
      const middle = (low + high) >> 1;
      if (before(pending[middle], entry) <= 0) low = middle + 1;
      else high = middle;
    }
    pending.splice(low, 0, entry);
  }
};
