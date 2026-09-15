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
import { unescapeOverbar } from "./notation.js";

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

/** The record each name source is read from. A harness entry names only a labelled harness. */
const NAMING_RECORD: Readonly<Record<Exclude<NetNameSource, "pin">, string>> = {
  power: RECORD_TYPES.POWER_PORT,
  harness: RECORD_TYPES.HARNESS_ENTRY,
  label: RECORD_TYPES.NET_LABEL,
  port: RECORD_TYPES.PORT,
  entry: RECORD_TYPES.SHEET_ENTRY,
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

/** Pin numbers in numeric order where both are numbers, numbers first, then by text. */
const comparePinNumbers = (a: string, b: string): number => {
  const numberA = parseInt(a, 10);
  const numberB = parseInt(b, 10);
  if (!Number.isNaN(numberA) && !Number.isNaN(numberB)) return numberA - numberB;
  if (!Number.isNaN(numberA)) return -1;
  if (!Number.isNaN(numberB)) return 1;
  return a.localeCompare(b);
};

/**
 * Designators by prefix, then number, then any suffix: `R9` before `R11`, a bare
 * prefix before the same prefix with a number.
 */
const compareRefdes = (a: string, b: string): number => {
  const split = /^([^0-9]*)(\d+)?(.*)$/;
  const [, prefixA = "", digitsA, restA = ""] = a.match(split) ?? [];
  const [, prefixB = "", digitsB, restB = ""] = b.match(split) ?? [];
  if (prefixA !== prefixB) return prefixA.localeCompare(prefixB);
  if (digitsA === undefined || digitsB === undefined) {
    if (digitsA === digitsB) return restA.localeCompare(restB);
    return digitsA === undefined ? -1 : 1;
  }
  return parseInt(digitsA, 10) - parseInt(digitsB, 10) || restA.localeCompare(restB);
};

/** The name an identifier claims; a harness entry claims one only on a labelled harness. */
const claimedName = (device: AltiumNet["devices"][number]): string | undefined =>
  device.RECORD === RECORD_TYPES.HARNESS_ENTRY
    ? device.harnessNetName || undefined
    : fieldText(device, "Text", "Name");

/**
 * Name a net. Two names of one rank fall to the first in record order; a net no
 * identifier names takes its lowest pin's name.
 */
export const assignNetName = (
  net: AltiumNet,
  schematic: AltiumSchematic,
  options: NetNamingOptions = NAME_FROM_ANY
): void => {
  for (const source of namingOrder(options)) {
    if (source === "pin" || !namingAllowed(source, options)) continue;
    for (const device of net.devices) {
      if (device.RECORD !== NAMING_RECORD[source]) continue;
      const name = claimedName(device);
      if (name) {
        net.name = unescapeOverbar(name);
        net.nameSource = source;
        return;
      }
    }
  }

  const pinsByRefdes = new Map<string, string[]>();
  for (const device of net.devices) {
    if (device.RECORD !== RECORD_TYPES.PIN) continue;
    const refdes = pinDesignator(device, schematic);
    const pin = pinNumber(device);
    if (!refdes || !pin) continue;
    const pins = pinsByRefdes.get(refdes) ?? pinsByRefdes.set(refdes, []).get(refdes)!;
    if (!pins.includes(pin)) pins.push(pin);
  }
  if (pinsByRefdes.size === 0) return;

  const refdes = [...pinsByRefdes.keys()].sort(compareRefdes)[0];
  const pin = pinsByRefdes.get(refdes)!.sort(comparePinNumbers)[0];
  net.name = `Net${refdes}_${pin}`;
  net.nameSource = "pin";
  net.pinNameSource = { refdes, pin };
};
