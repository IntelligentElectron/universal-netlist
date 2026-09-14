/**
 * Altium Net Extractor
 *
 * Extracts net information from Altium schematics by analyzing
 * wires, pins, power ports, and net labels.
 */

import type { AltiumRecord, AltiumSchematic, AltiumNet } from "./types.js";
import { RECORD_TYPES } from "./types.js";
import { findAllConnectedComponents } from "./connectivity.js";
import { findRecordByIndex } from "./hierarchy.js";
import { duplicateInstanceIndices, pinBelongsToInstance } from "./part-pins.js";
import { attachBusMembers } from "./bus.js";
import {
  field,
  polylinePoints,
  portEnds,
  scaledField,
  scaledPoint,
  sheetEntryPoint,
  toNumber,
} from "./coordinates.js";

const unescapeAltiumOverbar = (name: string): string =>
  name.includes("\\") ? name.replace(/\\/g, "") : name;

/**
 * Get the net name from a globally-named device.
 *
 * NET_LABEL and POWER_PORT use Text/TEXT.
 * PORT and SHEET_ENTRY use Name/NAME.
 */
const getDeviceNetName = (device: AltiumRecord): string | undefined => {
  for (const key of ["Text", "TEXT", "Name", "NAME"]) {
    const val = device[key];
    if (val !== undefined && val !== null && val !== "") return String(val);
  }
  return undefined;
};

/**
 * Whether a pin record is a connection point: it belongs to the part and
 * display mode its instance draws, and that instance is not a duplicate
 * designator (see part-pins.ts). A pin with no owner is kept.
 */
const pinIsLive = (
  pin: AltiumRecord,
  schematic: AltiumSchematic,
  duplicates: ReadonlySet<number>
): boolean => {
  const ownerIndexValue = pin.OwnerIndex ?? pin.OWNERINDEX;
  if (ownerIndexValue === undefined || ownerIndexValue === null || ownerIndexValue === "") {
    return true;
  }

  const ownerIndex = parseInt(String(ownerIndexValue), 10);
  const parent = findRecordByIndex(schematic, ownerIndex);
  if (!parent) {
    return true;
  }
  if (duplicates.has(parent.index)) return false;
  return pinBelongsToInstance(pin, parent);
};

/**
 * Find all devices that can be part of a net.
 *
 * These are: wires (27), pins (2), net labels (25), power ports (17)
 */
const findConnectableDevices = (schematic: AltiumSchematic): AltiumRecord[] => {
  const devices: AltiumRecord[] = [];
  const duplicates = duplicateInstanceIndices(schematic);
  const connectableTypes = new Set<string>([
    RECORD_TYPES.WIRE,
    RECORD_TYPES.PIN,
    RECORD_TYPES.NET_LABEL,
    RECORD_TYPES.POWER_PORT,
    RECORD_TYPES.PORT,
    // Harness entries are given a Location by readHarnessConnectors(); a wire
    // landing on one joins the signal that entry names.
    RECORD_TYPES.HARNESS_ENTRY,
    // A sheet entry is positioned by positionSheetEntries() from the sheet
    // symbol that owns it; a wire landing on it joins the signal the entry
    // carries down to the child sheet.
    RECORD_TYPES.SHEET_ENTRY,
  ]);

  const collectDevices = (records: AltiumRecord[]): void => {
    for (const record of records) {
      if (record.RECORD === RECORD_TYPES.SHEET_SYMBOL) positionSheetEntries(record);
      // A harness-typed entry carries a bundle, which the harness code joins; a
      // bus-notation entry meets a bus line, which is not traced. Neither is a
      // single-signal connection point, and an entry that could not be placed
      // must not sit at the origin touching every other such entry.
      if (record.RECORD === RECORD_TYPES.SHEET_ENTRY && !isSignalSheetEntry(record)) {
        continue;
      }
      if (record.RECORD === RECORD_TYPES.PIN && !pinIsLive(record, schematic, duplicates)) {
        continue;
      }
      // An entry whose connector had no coordinates was never positioned. Leaving
      // it out keeps it from sitting at the origin, where every other such entry
      // would appear to touch it.
      if (record.RECORD === RECORD_TYPES.HARNESS_ENTRY && record["Location.X"] === undefined) {
        continue;
      }
      if (record.RECORD && connectableTypes.has(record.RECORD)) {
        devices.push(record);
      }
      if (record.children) {
        collectDevices(record.children);
      }
    }
  };

  collectDevices(schematic.records);
  return devices;
};

/**
 * Whether a sheet entry is a single-signal connection point with a position.
 */
export const isSignalSheetEntry = (entry: AltiumRecord): boolean => {
  if (entry.HarnessType ?? entry.HARNESSTYPE) return false;
  const name = String(entry.Name ?? entry.NAME ?? "");
  if (!name || /\[/.test(name) || /^Repeat\(/i.test(name)) return false;
  return entry.coords !== undefined && entry.coords.length > 0;
};

/** Place a sheet symbol's entries on its edges. */
const positionSheetEntries = (symbol: AltiumRecord): void => {
  for (const entry of symbol.children ?? []) {
    if (entry.RECORD === RECORD_TYPES.SHEET_ENTRY) entry.coords = [sheetEntryPoint(symbol, entry)];
  }
};

/**
 * A pin's two ends: its location and the tip `PinLength` away, turned by the low
 * two bits of `PinConglomerate` in quarter turns. A wire meets it anywhere; another
 * pin meets only its tip.
 */
const calculatePinCoordinates = (device: AltiumRecord): void => {
  const [locationX, locationY] = scaledPoint(device);
  const pinLength = scaledField(device, "PinLength");
  const rotationRadians = ((toNumber(field(device, "PinConglomerate")) & 0x03) * Math.PI) / 2;
  device.coords = [
    [locationX, locationY],
    [
      Math.round(locationX + Math.cos(rotationRadians) * pinLength),
      Math.round(locationY + Math.sin(rotationRadians) * pinLength),
    ],
  ];
};

const calculateDeviceCoordinates = (device: AltiumRecord): void => {
  if (device.RECORD === RECORD_TYPES.PIN) {
    calculatePinCoordinates(device);
  } else if (device.RECORD === RECORD_TYPES.PORT) {
    device.coords = portEnds(device);
  } else if (device.RECORD === RECORD_TYPES.WIRE) {
    device.coords = polylinePoints(device);
  } else if (device.RECORD === RECORD_TYPES.SHEET_ENTRY) {
    // Placed from its sheet symbol by positionSheetEntries().
  } else {
    device.coords = [scaledPoint(device)];
  }
};

const getPinNumber = (device: AltiumRecord): string | null => {
  const designator = device.Designator ?? device.DESIGNATOR;
  if (designator !== undefined && designator !== null && designator !== "") {
    return String(designator);
  }
  const name = device.Name ?? device.NAME;
  if (name !== undefined && name !== null && name !== "") {
    return String(name);
  }
  return null;
};

const getRefdesForPin = (device: AltiumRecord, schematic: AltiumSchematic): string | null => {
  const ownerIndexValue = device.OwnerIndex ?? device.OWNERINDEX;
  if (ownerIndexValue === undefined || ownerIndexValue === null || ownerIndexValue === "") {
    return null;
  }

  const ownerIndex = parseInt(String(ownerIndexValue), 10);
  const parent = findRecordByIndex(schematic, ownerIndex);

  if (!parent?.children) {
    return null;
  }

  for (const child of parent.children) {
    if (child.RECORD !== RECORD_TYPES.DESIGNATOR) {
      continue;
    }
    const textValue = child.Text ?? child.TEXT ?? child.Name ?? child.NAME;
    if (textValue !== undefined && textValue !== null && textValue !== "") {
      return String(textValue);
    }
  }

  return null;
};

const comparePinNumbers = (a: string, b: string): number => {
  const aNum = Number.parseInt(a, 10);
  const bNum = Number.parseInt(b, 10);

  if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) {
    return aNum - bNum;
  }

  if (!Number.isNaN(aNum)) return -1;
  if (!Number.isNaN(bNum)) return 1;

  return a.localeCompare(b);
};

/**
 * Order two designators the way a designer reads them.
 *
 * A designator is a prefix and a number, and the number counts: R9 comes before
 * R11. Compared as text it does not, because "1" sorts before "9", and the net
 * Altium calls `NetR9_2` would be named after R11 instead. Anything after the
 * number, as in the `R5A` of a multi-part symbol, breaks the tie last.
 */
const compareRefdes = (a: string, b: string): number => {
  const split = /^([^0-9]*)(\d+)?(.*)$/;
  const [, aPrefix = "", aDigits, aRest = ""] = a.match(split) ?? [];
  const [, bPrefix = "", bDigits, bRest = ""] = b.match(split) ?? [];

  if (aPrefix !== bPrefix) return aPrefix.localeCompare(bPrefix);

  // A bare prefix sorts ahead of the same prefix carrying a number.
  if (aDigits === undefined || bDigits === undefined) {
    if (aDigits === bDigits) return aRest.localeCompare(bRest);
    return aDigits === undefined ? -1 : 1;
  }

  const byNumber = Number.parseInt(aDigits, 10) - Number.parseInt(bDigits, 10);
  if (byNumber !== 0) return byNumber;

  return aRest.localeCompare(bRest);
};

const collectPinCandidates = (
  net: AltiumNet,
  schematic: AltiumSchematic
): Map<string, string[]> => {
  const refdesPins = new Map<string, string[]>();

  for (const device of net.devices) {
    if (device.RECORD !== RECORD_TYPES.PIN) {
      continue;
    }
    const refdes = getRefdesForPin(device, schematic);
    const pinNumber = getPinNumber(device);
    if (!refdes || !pinNumber) {
      continue;
    }
    if (!refdesPins.has(refdes)) {
      refdesPins.set(refdes, []);
    }
    const pins = refdesPins.get(refdes)!;
    if (!pins.includes(pinNumber)) {
      pins.push(pinNumber);
    }
  }

  return refdesPins;
};

/** Where a net's name came from, as the naming rules rank them. */
export type NetNameSource = NonNullable<AltiumNet["nameSource"]>;

/**
 * Which of the weaker identifiers may name a net, and which of the stronger
 * comes first.
 *
 * `allowPortNetNames` and `allowSheetEntryNetNames` are the project's
 * `AllowPortNetNames` and `AllowSheetEntryNetNames` options. Altium leaves the
 * first off and the second on by default, so a net reaching a child sheet only
 * through a port is usually named after a pin, or after the sheet entry on the
 * parent once the two are joined.
 *
 * `powerPortNamesTakePriority` is `PowerPortNamesTakePriority`, off by
 * default: a net label outranks a power port on the same net unless the
 * project says otherwise. Altium's connectivity guide lists the order as net
 * labels, power ports, ports, then pins, with power ports moved to the front by
 * this option.
 */
export interface NetNamingOptions {
  allowPortNetNames: boolean;
  allowSheetEntryNetNames: boolean;
  powerPortNamesTakePriority: boolean;
}

/**
 * A lone document is read with every identifier allowed to name its net and
 * power ports first, which is how the parser has always read a single sheet.
 */
export const NAME_FROM_ANY: NetNamingOptions = {
  allowPortNetNames: true,
  allowSheetEntryNetNames: true,
  powerPortNamesTakePriority: true,
};

/**
 * Naming devices, strongest claim on the net's name first.
 *
 * A labelled signal harness replaces the wire's own label with
 * `<harness label>.<entry name>` for every net the harness carries, so it
 * outranks the label. The label outranks a port, which only names the signal
 * where it crosses a sheet boundary, and a port outranks a sheet entry. A
 * power port names a global net and goes first when the project gives it
 * priority; otherwise it falls behind the label, as Altium's guide has it.
 *
 * A harness entry never names a net. Its name belongs to a member of a bundle,
 * not to the net, so it is only unique within its harness: naming nets after
 * entries would put every sensor's `SIGNAL` under one name.
 */
const NAMING_DEVICES: Readonly<Record<NetNameSource, string | undefined>> = {
  power: RECORD_TYPES.POWER_PORT,
  harness: RECORD_TYPES.HARNESS_ENTRY,
  label: RECORD_TYPES.NET_LABEL,
  port: RECORD_TYPES.PORT,
  entry: RECORD_TYPES.SHEET_ENTRY,
  pin: undefined,
};

/** The name sources in the order they claim a net's name, strongest first. */
export const namingOrder = (options: NetNamingOptions): NetNameSource[] =>
  options.powerPortNamesTakePriority
    ? ["power", "harness", "label", "port", "entry", "pin"]
    : ["harness", "label", "power", "port", "entry", "pin"];

/**
 * How strongly each kind of identifier claims a merged net's name: the rank
 * Altium applies when one net carries several, lower being stronger. Verified
 * against the misko3 board for labels against ports: every net that a label
 * and a port both name is called after the label there.
 */
export const nameRanks = (options: NetNamingOptions): Readonly<Record<NetNameSource, number>> => {
  const ranks = {} as Record<NetNameSource, number>;
  namingOrder(options).forEach((source, rank) => {
    ranks[source] = rank;
  });
  return ranks;
};

/**
 * The name a device claims for its net, or undefined when it claims none.
 *
 * A harness entry claims one only where the harness line it belongs to carries
 * a net label, which is the case Altium names from.
 */
const claimedNetName = (device: AltiumRecord): string | undefined => {
  if (device.RECORD === RECORD_TYPES.HARNESS_ENTRY) {
    const harnessNetName = device.harnessNetName;
    return typeof harnessNetName === "string" && harnessNetName ? harnessNetName : undefined;
  }
  return getDeviceNetName(device);
};

/**
 * Assign a name to a net.
 *
 * The naming devices are tried in the order `namingOrder` gives, and a net
 * none of them names is called after its lowest pin, `Net<Refdes>_<Pin>`.
 *
 * Where a net carries two names of the same rank, two net labels either side
 * of a harness, say, the first in the device order wins, which is the order
 * the records appear in the file.
 */
const namingAllowed = (source: NetNameSource, options: NetNamingOptions): boolean => {
  if (source === "port") return options.allowPortNetNames;
  if (source === "entry") return options.allowSheetEntryNetNames;
  return true;
};

export const assignNetName = (
  net: AltiumNet,
  schematic: AltiumSchematic,
  options: NetNamingOptions = NAME_FROM_ANY
): void => {
  for (const source of namingOrder(options)) {
    const type = NAMING_DEVICES[source];
    if (type === undefined || !namingAllowed(source, options)) continue;
    for (const device of net.devices) {
      if (device.RECORD !== type) continue;
      const nameValue = claimedNetName(device);
      if (nameValue) {
        net.name = unescapeAltiumOverbar(nameValue);
        net.nameSource = source;
        return;
      }
    }
  }

  const refdesPins = collectPinCandidates(net, schematic);
  if (refdesPins.size === 0) {
    return;
  }

  const sortedRefdes = Array.from(refdesPins.keys()).sort(compareRefdes);
  const selectedRefdes = sortedRefdes[0];
  const pinNumbers = refdesPins.get(selectedRefdes);
  if (!pinNumbers || pinNumbers.length === 0) {
    return;
  }

  pinNumbers.sort(comparePinNumbers);
  const selectedPin = pinNumbers[0];
  net.name = `Net${selectedRefdes}_${selectedPin}`;
  net.nameSource = "pin";
  net.pinNameSource = { refdes: selectedRefdes, pin: selectedPin };
};

/**
 * Extract all nets from the schematic.
 *
 * This function:
 * 1. Finds all connectable devices (wires, pins, labels, power ports)
 * 2. Calculates coordinates for each device
 * 3. Groups connected devices into nets
 * 4. Assigns names to nets based on power ports, labels, or pin names
 */
export const extractNets = (
  schematic: AltiumSchematic,
  naming: NetNamingOptions = NAME_FROM_ANY
): AltiumNet[] => {
  // Find all connectable devices
  const devices = findConnectableDevices(schematic);

  // Calculate coordinates for each device
  for (const device of devices) {
    calculateDeviceCoordinates(device);
  }

  // Group connected devices into nets using optimized algorithm
  const components = findAllConnectedComponents(devices);

  // Convert to AltiumNet objects
  const nets: AltiumNet[] = [];
  for (const connectedDevices of components) {
    // Sort by index for consistency
    connectedDevices.sort((a, b) => a.index - b.index);

    const net: AltiumNet = {
      name: null,
      devices: connectedDevices,
    };

    nets.push(net);
  }

  // Assign names to nets
  for (const net of nets) {
    assignNetName(net, schematic, naming);
  }

  // A bus joins its labelled member nets to the range identifiers it reaches;
  // a member nothing here labels becomes a pinless net carrying only those.
  const unlabelledMembers = attachBusMembers(schematic, nets);

  return [...nets, ...unlabelledMembers];
};

/**
 * Metadata about net types, used for multi-channel expansion.
 */
export interface NetClassification {
  /** Net names that contain PORT devices (cross-sheet signals) */
  portNetNames: Set<string>;
  /** Net names assigned by POWER_PORT devices (global power) */
  powerNetNames: Set<string>;
}

/**
 * Classify nets by their type (port, power, or local).
 */
export const classifyNets = (nets: AltiumNet[]): NetClassification => {
  const portNetNames = new Set<string>();
  const powerNetNames = new Set<string>();

  for (const net of nets) {
    if (!net.name) continue;

    const hasPort = net.devices.some((d) => d.RECORD === RECORD_TYPES.PORT);
    const hasPowerPort = net.devices.some((d) => d.RECORD === RECORD_TYPES.POWER_PORT);

    if (hasPort) portNetNames.add(net.name);
    if (hasPowerPort) powerNetNames.add(net.name);
  }

  return { portNetNames, powerNetNames };
};

/**
 * Get net list with schematic (for compatibility with Python API).
 */
export const determineNetList = (
  schematic: AltiumSchematic
): AltiumSchematic & { nets: AltiumNet[] } => {
  const nets = extractNets(schematic);
  return {
    ...schematic,
    nets,
  };
};
