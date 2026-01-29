/**
 * Altium Net Extractor
 *
 * Extracts net information from Altium schematics by analyzing
 * wires, pins, power ports, and net labels.
 */

import type { AltiumRecord, AltiumSchematic, AltiumNet } from './types.js';
import { RECORD_TYPES } from './types.js';
import { findAllConnectedComponents } from './connectivity.js';
import { findRecordByIndex } from './hierarchy.js';

const COORDINATE_SCALE = 10000;

const toNumber = (value: unknown): number => {
  if (value === undefined || value === null || value === '') {
    return 0;
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const scaledCoordinate = (base: unknown, frac: unknown): number => {
  return Math.round(toNumber(base) * COORDINATE_SCALE + toNumber(frac));
};

const pinMatchesCurrentPart = (pin: AltiumRecord, schematic: AltiumSchematic): boolean => {
  const ownerIndexValue = pin.OwnerIndex ?? pin.OWNERINDEX;
  if (ownerIndexValue === undefined || ownerIndexValue === null || ownerIndexValue === '') {
    return true;
  }

  const ownerIndex = parseInt(String(ownerIndexValue), 10);
  const parent = findRecordByIndex(schematic, ownerIndex);
  if (!parent) {
    return true;
  }

  const parentPartId = parent.CURRENTPARTID ?? parent.CurrentPartId ?? parent.CurrentPartID;
  const pinPartId = pin.OwnerPartId ?? pin.OWNERPARTID;
  if (
    parentPartId === undefined ||
    parentPartId === null ||
    parentPartId === '' ||
    pinPartId === undefined ||
    pinPartId === null ||
    pinPartId === ''
  ) {
    return true;
  }

  return String(parentPartId) === String(pinPartId);
};

/**
 * Find all devices that can be part of a net.
 *
 * These are: wires (27), pins (2), net labels (25), power ports (17)
 */
const findConnectableDevices = (schematic: AltiumSchematic): AltiumRecord[] => {
  const devices: AltiumRecord[] = [];
  const connectableTypes = new Set<string>([
    RECORD_TYPES.WIRE,
    RECORD_TYPES.PIN,
    RECORD_TYPES.NET_LABEL,
    RECORD_TYPES.POWER_PORT,
  ]);

  const collectDevices = (records: AltiumRecord[]): void => {
    for (const record of records) {
      if (record.RECORD === RECORD_TYPES.PIN && !pinMatchesCurrentPart(record, schematic)) {
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
 * Calculate pin coordinates.
 *
 * Pin rotation is encoded in PINCONGLOMERATE (lower 2 bits * 90 degrees).
 * The endpoint is calculated using: location + rotation * pin_length.
 * We keep both the pin origin and endpoint so connectivity works at either end.
 */
const calculatePinCoordinates = (device: AltiumRecord): void => {
  const locationX = scaledCoordinate(
    device['Location.X'] ?? device['LOCATION.X'],
    device['Location.X_Frac'] ?? device['LOCATION.X_FRAC']
  );
  const locationY = scaledCoordinate(
    device['Location.Y'] ?? device['LOCATION.Y'],
    device['Location.Y_Frac'] ?? device['LOCATION.Y_FRAC']
  );
  const pinLength = scaledCoordinate(
    device['PinLength'] ?? device['PINLENGTH'],
    device['PinLength_Frac'] ?? device['PINLENGTH_FRAC']
  );
  const pinConglomerate = parseInt(
    String(device['PinConglomerate'] || device['PINCONGLOMERATE'] || '0'),
    10
  );

  // Extract rotation from lower 2 bits (0-3 -> 0, 90, 180, 270 degrees)
  const rotationIndex = pinConglomerate & 0x03;
  const rotationDegrees = rotationIndex * 90;
  const rotationRadians = (rotationDegrees / 180) * Math.PI;

  // Calculate pin endpoint
  const endX = Math.round(locationX + Math.cos(rotationRadians) * pinLength);
  const endY = Math.round(locationY + Math.sin(rotationRadians) * pinLength);

  device.coords = [
    [locationX, locationY],
    [endX, endY],
  ];
};

/**
 * Calculate wire coordinates.
 *
 * Wires have coordinates stored as X1,Y1,X2,Y2,... pairs.
 */
const calculateWireCoordinates = (device: AltiumRecord): void => {
  const coords: Array<[number, number]> = [];

  // Pattern: X1, Y1, X2, Y2, etc.
  const coordPattern = /^X(\d+)$/;

  // Find all X coordinate keys and extract their indices
  const indices: number[] = [];
  for (const key of Object.keys(device)) {
    const match = key.match(coordPattern);
    if (match) {
      indices.push(parseInt(match[1], 10));
    }
  }

  // Sort indices and build coordinate array
  indices.sort((a, b) => a - b);

  for (const idx of indices) {
    const x = scaledCoordinate(device[`X${idx}`], device[`X${idx}_Frac`] ?? device[`X${idx}_FRAC`]);
    const y = scaledCoordinate(device[`Y${idx}`], device[`Y${idx}_Frac`] ?? device[`Y${idx}_FRAC`]);
    coords.push([x, y]);
  }

  device.coords = coords;
};

/**
 * Calculate simple location coordinates.
 *
 * Used for power ports, net labels, etc.
 */
const calculateSimpleCoordinates = (device: AltiumRecord): void => {
  const x = scaledCoordinate(
    device['Location.X'] ?? device['LOCATION.X'],
    device['Location.X_Frac'] ?? device['LOCATION.X_FRAC']
  );
  const y = scaledCoordinate(
    device['Location.Y'] ?? device['LOCATION.Y'],
    device['Location.Y_Frac'] ?? device['LOCATION.Y_FRAC']
  );
  device.coords = [[x, y]];
};

/**
 * Calculate coordinates for a device.
 *
 * Different device types have coordinates stored differently:
 * - Pins: calculated from location + rotation + pin length
 * - Wires: multiple X/Y coordinate pairs (X1,Y1,X2,Y2,...)
 * - Others: simple LOCATION.X and LOCATION.Y
 */
const calculateDeviceCoordinates = (device: AltiumRecord): void => {
  if (device.RECORD === RECORD_TYPES.PIN) {
    calculatePinCoordinates(device);
  } else if (device.RECORD === RECORD_TYPES.WIRE) {
    calculateWireCoordinates(device);
  } else {
    calculateSimpleCoordinates(device);
  }
};

const getPinNumber = (device: AltiumRecord): string | null => {
  const designator = device.Designator ?? device.DESIGNATOR;
  if (designator !== undefined && designator !== null && designator !== '') {
    return String(designator);
  }
  const name = device.Name ?? device.NAME;
  if (name !== undefined && name !== null && name !== '') {
    return String(name);
  }
  return null;
};

const getRefdesForPin = (device: AltiumRecord, schematic: AltiumSchematic): string | null => {
  const ownerIndexValue = device.OwnerIndex ?? device.OWNERINDEX;
  if (ownerIndexValue === undefined || ownerIndexValue === null || ownerIndexValue === '') {
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
    if (textValue !== undefined && textValue !== null && textValue !== '') {
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

const collectPinCandidates = (net: AltiumNet, schematic: AltiumSchematic): Map<string, string[]> => {
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

/**
 * Assign a name to a net.
 *
 * Priority:
 * 1. Power port TEXT value
 * 2. Net label TEXT value
 * 3. Pin-derived name (Net<Refdes>_<Pin>) using the lowest refdes/pin in the net
 */
const assignNetName = (net: AltiumNet, schematic: AltiumSchematic): void => {
  // Try power ports and net labels first
  for (const device of net.devices) {
    if (
      (device.RECORD === RECORD_TYPES.POWER_PORT || device.RECORD === RECORD_TYPES.NET_LABEL) &&
      (device.Text !== undefined || device.TEXT !== undefined)
    ) {
      const textValue = device.Text ?? device.TEXT;
      if (textValue !== undefined && textValue !== null && textValue !== '') {
        net.name = String(textValue);
        return;
      }
    }
  }

  const refdesPins = collectPinCandidates(net, schematic);
  if (refdesPins.size === 0) {
    return;
  }

  const sortedRefdes = Array.from(refdesPins.keys()).sort((a, b) => a.localeCompare(b));
  const selectedRefdes = sortedRefdes[0];
  const pinNumbers = refdesPins.get(selectedRefdes);
  if (!pinNumbers || pinNumbers.length === 0) {
    return;
  }

  pinNumbers.sort(comparePinNumbers);
  const selectedPin = pinNumbers[0];
  net.name = `Net${selectedRefdes}_${selectedPin}`;
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
export const extractNets = (schematic: AltiumSchematic): AltiumNet[] => {
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
    assignNetName(net, schematic);
  }

  return nets;
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
