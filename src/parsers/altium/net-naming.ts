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
import { identifierKey, unescapeOverbar } from "./notation.js";

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

/**
 * Name a net. Two names of one rank fall to the first in sort order; a net no identifier
 * names takes its lowest pin's name. A name `taken` refuses is passed over.
 */
export const assignNetName = (
  net: AltiumNet,
  schematic: AltiumSchematic,
  options: NetNamingOptions = NAME_FROM_ANY,
  taken: (name: string, source: NetNameSource) => boolean = () => false
): void => {
  net.name = null;
  net.nameSource = undefined;
  net.pinNameSource = undefined;
  const claims = new Map<NetNameSource, string[]>();
  const pinsByRefdes = new Map<string, string[]>();
  for (const device of net.devices) {
    if (device.RECORD === RECORD_TYPES.PIN) {
      const refdes = pinDesignator(device, schematic);
      const pin = pinNumber(device);
      if (!refdes || !pin) continue;
      const pins = pinsByRefdes.get(refdes) ?? pinsByRefdes.set(refdes, []).get(refdes)!;
      if (!pins.includes(pin)) pins.push(pin);
      continue;
    }
    const source = device.RECORD === undefined ? undefined : RECORD_SOURCE[device.RECORD];
    const claimed = source && unescapeOverbar(claimedName(device) ?? "");
    if (source && claimed)
      (claims.get(source) ?? claims.set(source, []).get(source)!).push(claimed);
  }

  for (const source of namingOrder(options)) {
    if (!namingAllowed(source, options)) continue;
    const [name] = (claims.get(source) ?? []).filter((claimed) => !taken(claimed, source)).sort();
    if (name === undefined) continue;
    net.name = name;
    net.nameSource = source;
    return;
  }

  for (const refdes of [...pinsByRefdes.keys()].sort(compareRefdes)) {
    for (const pin of pinsByRefdes.get(refdes)!.sort(comparePinNumbers)) {
      const name = `Net${refdes}_${pin}`;
      if (taken(name, "pin")) continue;
      net.name = name;
      net.nameSource = "pin";
      net.pinNameSource = { refdes, pin };
      return;
    }
  }
};

/**
 * The nets that may share a name: those named by labels, power ports and harness labels,
 * and those named by ports; never those named by sheet entries.
 */
const nameKind = (source: NetNameSource): string =>
  source === "port" || source === "entry" || source === "pin" ? source : "label";

/**
 * Name a sheet's nets. Two nets that cannot join by name do not share one: names are
 * settled strongest first, and the net whose name ranks lower, or comes later, takes its
 * next name, settling at that name's rank.
 */
export const nameSheetNets = (
  nets: readonly AltiumNet[],
  schematic: AltiumSchematic,
  options: NetNamingOptions = NAME_FROM_ANY
): void => {
  for (const net of nets) assignNetName(net, schematic, options);
  const ranks = nameRanks(options);
  const held = new Map<string, string>();
  const taken = (name: string, source: NetNameSource): boolean => {
    const holder = held.get(identifierKey(name));
    return holder !== undefined && (holder !== nameKind(source) || holder === "entry");
  };
  const rankOf = (net: AltiumNet): number | undefined =>
    net.nameSource === undefined ? undefined : ranks[net.nameSource];
  for (let rank = 0; rank <= ranks.pin; rank++) {
    for (const net of nets) {
      if (rankOf(net) !== rank) continue;
      if (taken(net.name!, net.nameSource!)) {
        assignNetName(net, schematic, options, taken);
        if (rankOf(net) !== rank) continue;
      }
      held.set(identifierKey(net.name!), nameKind(net.nameSource!));
    }
  }
};
