/**
 * A sheet's nets: the connection points it draws, joined by geometry and by name.
 */

import { RECORD_TYPES, type AltiumNet, type AltiumRecord, type AltiumSchematic } from "./types.js";
import { field, fieldText, toNumber } from "./records.js";
import { duplicateInstanceIndices, pinIsLive } from "./components.js";
import { findAllConnectedComponents } from "./connectivity.js";
import { attachBusMembers } from "./bus.js";
import { nameSheetNets, NAME_FROM_ANY, type NetNamingOptions } from "./net-naming.js";
import {
  polylinePoints,
  portEnds,
  scaledField,
  scaledPoint,
  sheetEntryPoint,
} from "./coordinates.js";

/**
 * Whether a sheet entry is a single-signal connection point. A harness-typed entry
 * carries a bundle and a range or `Repeat()` entry meets a bus; neither is one.
 */
export const isSignalSheetEntry = (entry: AltiumRecord): boolean => {
  if (field(entry, "HarnessType")) return false;
  const name = fieldText(entry, "Name") ?? "";
  if (!name || name.includes("[") || /^Repeat\(/i.test(name)) return false;
  return entry.coords !== undefined && entry.coords.length > 0;
};

/**
 * A pin's two ends: its location, and its tip `PinLength` away, turned by the low two
 * bits of `PinConglomerate` in quarter turns.
 */
const pinEnds = (pin: AltiumRecord): [number, number][] => {
  const [x, y] = scaledPoint(pin);
  const length = scaledField(pin, "PinLength");
  const angle = ((toNumber(field(pin, "PinConglomerate")) & 0x03) * Math.PI) / 2;
  return [
    [x, y],
    [Math.round(x + Math.cos(angle) * length), Math.round(y + Math.sin(angle) * length)],
  ];
};

/** The records that can join a net, each given its connection points. */
const connectionPoints = (schematic: AltiumSchematic): AltiumRecord[] => {
  const duplicates = duplicateInstanceIndices(schematic);
  const devices: AltiumRecord[] = [];
  const collect = (records: AltiumRecord[]): void => {
    for (const record of records) {
      switch (record.RECORD) {
        case RECORD_TYPES.SHEET_SYMBOL:
          for (const entry of record.children ?? []) {
            if (entry.RECORD === RECORD_TYPES.SHEET_ENTRY) {
              entry.coords = [sheetEntryPoint(record, entry)];
            }
          }
          break;
        case RECORD_TYPES.SHEET_ENTRY:
          if (!isSignalSheetEntry(record)) continue;
          devices.push(record);
          break;
        case RECORD_TYPES.PIN:
          if (!pinIsLive(record, schematic, duplicates)) continue;
          record.coords = pinEnds(record);
          devices.push(record);
          break;
        case RECORD_TYPES.PORT:
          record.coords = portEnds(record);
          devices.push(record);
          break;
        case RECORD_TYPES.WIRE:
          record.coords = polylinePoints(record);
          devices.push(record);
          break;
        case RECORD_TYPES.HARNESS_ENTRY:
          // An entry of a connector without coordinates has no place.
          if (record["Location.X"] === undefined) continue;
          record.coords = [scaledPoint(record)];
          devices.push(record);
          break;
        case RECORD_TYPES.NET_LABEL:
        case RECORD_TYPES.POWER_PORT:
          record.coords = [scaledPoint(record)];
          devices.push(record);
          break;
      }
      if (record.children) collect(record.children);
    }
  };
  collect(schematic.records);
  return devices;
};

/** Extract and name a sheet's nets, bus members included. */
export const extractNets = (
  schematic: AltiumSchematic,
  naming: NetNamingOptions = NAME_FROM_ANY
): AltiumNet[] => {
  const nets: AltiumNet[] = findAllConnectedComponents(connectionPoints(schematic)).map(
    (devices) => ({ name: null, devices: devices.sort((a, b) => a.index - b.index) })
  );
  nameSheetNets(nets, schematic, naming);
  return [...nets, ...attachBusMembers(schematic, nets)];
};
