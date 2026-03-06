/**
 * DSN Structure Parsers - Netlist-critical types
 *
 * Port of OpenOrCadParser structure parsers.
 * Each parser reads prefixes, preamble, fields, and checkpoints.
 */

import { BinaryReader } from "./binary-reader.js";
import { StructureType } from "./structure-types.js";
import {
  FutureDataList,
  autoReadPrefixes,
  readPreamble,
  skipStructure,
  type PrefixPropertyPair,
} from "./generic-parser.js";

// --- Parsed structure types ---

export interface SymbolDisplayProp {
  nameIdx: number;
  x: number;
  y: number;
  textFontIdx: number;
  rotation: number;
  propColor: number;
}

export interface Alias {
  locX: number;
  locY: number;
  name: string;
}

export interface Wire {
  segmentId: number;
  id: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  aliases: Alias[];
}

export interface T0x10 {
  pinIndex: number; // 1-based logical pin index for pinMap lookup
  pointX: number;
  pointY: number;
  netId: number;
  symbolDisplayProps: SymbolDisplayProp[];
}

export interface PlacedInstance {
  pkgName: string;
  dbId: number;
  reference: string;
  sourcePackage: string;
  partValueIdx: number;
  prefixProperties: PrefixPropertyPair[];
  locX: number;
  locY: number;
  symbolDisplayProps: SymbolDisplayProp[];
  t0x10s: T0x10[];
}

export interface GraphicInst {
  name: string;
  dbId: number;
  locX: number;
  locY: number;
  /** Bounding box: x1, y1 (lower-left) to x2, y2 (upper-right) */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Pairing ID from the 8 unknown bytes (first uint32). Used for OPC cross-page matching. */
  pairingId: number;
  symbolDisplayProps: SymbolDisplayProp[];
}

export interface Device {
  unitRef: string;
  refDes: string;
  pinMap: (string | null)[];
}

export interface Package {
  name: string;
  refDes: string;
  pcbFootprint: string;
  devices: Device[];
}

// --- Parser functions ---

export function parseSymbolDisplayProp(reader: BinaryReader): SymbolDisplayProp {
  const futureData = new FutureDataList(reader);
  autoReadPrefixes(reader, futureData, StructureType.SymbolDisplayProp);
  readPreamble(reader);
  futureData.checkpoint();

  const nameIdx = reader.readUint32();
  const x = reader.readInt16();
  const y = reader.readInt16();

  const rotFontBitField = reader.readUint16();
  const textFontIdx = rotFontBitField & 0x3fff;
  const rotation = rotFontBitField >> 14;

  const propColor = reader.readUint8();
  reader.skip(2); // visibility
  reader.skip(1); // assumed 0x00

  futureData.checkpoint();

  return { nameIdx, x, y, textFontIdx, rotation, propColor };
}

export function parseAlias(reader: BinaryReader): Alias {
  const futureData = new FutureDataList(reader);
  autoReadPrefixes(reader, futureData, StructureType.Alias);
  readPreamble(reader);
  futureData.checkpoint();

  const locX = reader.readInt32();
  const locY = reader.readInt32();
  reader.skip(4); // color
  reader.skip(4); // rotation
  reader.skip(4); // textFontIdx
  const name = reader.readStringLenZeroTerm();

  futureData.checkpoint();

  return { locX, locY, name };
}

export function parseWire(reader: BinaryReader): Wire {
  const futureData = new FutureDataList(reader);
  autoReadPrefixes(reader, futureData); // accepts WireScalar or WireBus
  readPreamble(reader);
  futureData.checkpoint();

  const segmentId = reader.readUint32();
  const id = reader.readUint32();
  reader.skip(4); // color
  const startX = reader.readInt32();
  const startY = reader.readInt32();
  const endX = reader.readInt32();
  const endY = reader.readInt32();
  reader.skip(1); // unknown

  const lenAliases = reader.readUint16();
  const aliases: Alias[] = [];
  for (let i = 0; i < lenAliases; i++) {
    aliases.push(parseAlias(reader));
  }

  const lenSymbolDisplayProps = reader.readUint16();
  for (let i = 0; i < lenSymbolDisplayProps; i++) {
    parseSymbolDisplayProp(reader); // read but don't store
  }

  reader.skip(4); // lineWidth
  reader.skip(4); // lineStyle

  futureData.checkpoint();

  return { segmentId, id, startX, startY, endX, endY, aliases };
}

export function parseT0x10(reader: BinaryReader): T0x10 {
  const futureData = new FutureDataList(reader);
  autoReadPrefixes(reader, futureData, StructureType.T0x10);
  readPreamble(reader);
  futureData.checkpoint();

  const sth = reader.readUint16();
  const pinIndex = sth < 32768 ? sth : 65536 - sth;
  const pointX = reader.readInt16();
  const pointY = reader.readInt16();
  const netId = reader.readUint32();
  reader.skip(4); // unknownInt

  const lenSymbolDisplayProps = reader.readUint16();
  const symbolDisplayProps: SymbolDisplayProp[] = [];
  for (let i = 0; i < lenSymbolDisplayProps; i++) {
    symbolDisplayProps.push(parseSymbolDisplayProp(reader));
  }

  futureData.checkpoint();

  return { pinIndex, pointX, pointY, netId, symbolDisplayProps };
}

export function parsePlacedInstance(reader: BinaryReader): PlacedInstance {
  const futureData = new FutureDataList(reader);
  const { properties: prefixProperties } = autoReadPrefixes(
    reader,
    futureData,
    StructureType.PlacedInstance
  );
  readPreamble(reader);
  futureData.checkpoint();

  reader.skip(8); // unknown
  const pkgName = reader.readStringLenZeroTerm();
  const dbId = reader.readUint32();
  reader.skip(8); // unknown
  const locX = reader.readInt16();
  const locY = reader.readInt16();
  reader.skip(4); // unknown

  const lenSymbolDisplayProps = reader.readUint16();
  const symbolDisplayProps: SymbolDisplayProp[] = [];
  for (let i = 0; i < lenSymbolDisplayProps; i++) {
    symbolDisplayProps.push(parseSymbolDisplayProp(reader));
  }

  reader.skip(1); // unknown
  futureData.checkpoint();

  const reference = reader.readStringLenZeroTerm();
  const partValueIdx = reader.readUint32();
  reader.skip(10); // unknown

  const lenT0x10s = reader.readUint16();
  const t0x10s: T0x10[] = [];
  for (let i = 0; i < lenT0x10s; i++) {
    t0x10s.push(parseT0x10(reader));
  }

  futureData.checkpoint();

  const sourcePackage = reader.readStringLenZeroTerm();
  reader.skip(2); // unknown

  futureData.checkpoint();

  return {
    pkgName,
    dbId,
    reference,
    sourcePackage,
    partValueIdx,
    prefixProperties,
    locX,
    locY,
    symbolDisplayProps,
    t0x10s,
  };
}

/**
 * Parse StructGraphicInst (base for Global, Port, OffPageConnector).
 * Note: Y coordinates are read before X in this structure.
 */
function parseGraphicInstBase(reader: BinaryReader, futureData: FutureDataList): GraphicInst {
  readPreamble(reader);
  futureData.checkpoint();

  // 8 unknown bytes: first uint32 is the pairing ID (used for OPC matching)
  const pairingId = reader.readUint32();
  reader.skip(4); // second uint32 (constant per design)
  const name = reader.readStringLenZeroTerm();
  const dbId = reader.readUint32();

  // Y before X!
  const locY = reader.readInt16();
  const locX = reader.readInt16();
  const y2 = reader.readInt16();
  const x2 = reader.readInt16();
  const x1 = reader.readInt16();
  const y1 = reader.readInt16();
  reader.skip(1); // color (uint8)
  reader.skip(1); // unknown
  reader.skip(1); // unknown (probably structure ID)
  reader.skip(1); // unknown

  const lenSymbolDisplayProps = reader.readUint16();
  const symbolDisplayProps: SymbolDisplayProp[] = [];
  for (let i = 0; i < lenSymbolDisplayProps; i++) {
    symbolDisplayProps.push(parseSymbolDisplayProp(reader));
  }

  const unknownFlag = reader.readUint8();
  if (unknownFlag === 0x02) {
    // StructSthInPages0 - skip it
    skipStructure(reader);
  }
  // Other flags (0x21, 0x22, 0x23, 0x40, 0x4b): do nothing

  futureData.checkpoint();

  return { name, dbId, locX, locY, x1, y1, x2, y2, pairingId, symbolDisplayProps };
}

export function parseGlobal(reader: BinaryReader): GraphicInst {
  const futureData = new FutureDataList(reader);
  autoReadPrefixes(reader, futureData, StructureType.Global);
  const inst = parseGraphicInstBase(reader, futureData);

  return inst;
}

export function parsePort(reader: BinaryReader): GraphicInst {
  const futureData = new FutureDataList(reader);
  autoReadPrefixes(reader, futureData, StructureType.Port);
  const inst = parseGraphicInstBase(reader, futureData);
  reader.skip(9); // unknown (Port-specific)
  futureData.checkpoint();

  return inst;
}

export function parseOffPageConnector(reader: BinaryReader): GraphicInst {
  const futureData = new FutureDataList(reader);
  autoReadPrefixes(reader, futureData, StructureType.OffPageConnector);
  const inst = parseGraphicInstBase(reader, futureData);

  return inst;
}

export function parseDevice(reader: BinaryReader): Device {
  const futureData = new FutureDataList(reader);
  autoReadPrefixes(reader, futureData, StructureType.Device);
  readPreamble(reader);
  futureData.checkpoint();

  const unitRef = reader.readStringLenZeroTerm();
  const refDes = reader.readStringLenZeroTerm();

  const pinCount = reader.readUint16();
  const pinMap: (string | null)[] = [];

  for (let i = 0; i < pinCount; i++) {
    const strLen = reader.readInt16();
    if (strLen === -1) {
      pinMap.push(null);
      continue;
    }
    // Put back the 2 bytes we just read (they're the string length)
    reader.seek(reader.tell() - 2);
    const pinName = reader.readStringLenZeroTerm();
    reader.skip(1); // bitMapPinGrpCfg (pinIgnore + pinGroup)
    pinMap.push(pinName);
  }

  futureData.checkpoint();

  return { unitRef, refDes, pinMap };
}

export function parsePackage(reader: BinaryReader): Package {
  const futureData = new FutureDataList(reader);
  autoReadPrefixes(reader, futureData, StructureType.Package);
  readPreamble(reader);
  futureData.checkpoint();

  const name = reader.readStringLenZeroTerm();
  reader.readStringLenZeroTerm(); // sourceLibrary (skip)

  futureData.checkpoint();

  const refDes = reader.readStringLenZeroTerm();
  reader.readStringLenZeroTerm(); // unknownStr1 (skip)
  const pcbFootprint = reader.readStringLenZeroTerm();

  const lenDevices = reader.readUint16();
  const devices: Device[] = [];
  for (let i = 0; i < lenDevices; i++) {
    devices.push(parseDevice(reader));
  }

  futureData.checkpoint();

  return { name, refDes, pcbFootprint, devices };
}

// --- Cache stream structures ---

export interface SymbolPin {
  name: string;
}

export function parseSymbolPin(reader: BinaryReader): SymbolPin {
  const futureData = new FutureDataList(reader);
  autoReadPrefixes(reader, futureData); // accepts SymbolPinScalar (0x1A) or SymbolPinBus (0x1B)
  readPreamble(reader);
  futureData.checkpoint();

  const name = reader.readStringLenZeroTerm();
  // start_x(4) + start_y(4) + hotpt_x(4) + hotpt_y(4) + pin_shape(2) + unknown(2) + port_type(4) + unknown(4)
  reader.skip(28);

  const lenSymbolDisplayProps = reader.readUint16();
  for (let i = 0; i < lenSymbolDisplayProps; i++) {
    parseSymbolDisplayProp(reader);
  }

  futureData.checkpoint();

  return { name };
}

export interface LibraryPart {
  name: string;
  pinNames: string[];
  defaultValue?: string;
}

export function parseLibraryPart(reader: BinaryReader): LibraryPart {
  const futureData = new FutureDataList(reader);
  autoReadPrefixes(reader, futureData, StructureType.LibraryPart);
  readPreamble(reader);
  futureData.checkpoint();

  const name = reader.readStringLenZeroTerm();
  reader.readStringLenZeroTerm(); // sourceLibrary

  futureData.checkpoint();

  reader.skip(4); // unknown

  // Skip primitives (graphical shapes: Line, Rect, Arc, etc.)
  // Primitives use a non-standard format, so skip to the next checkpoint boundary
  reader.readUint16(); // lenPrimitives (consumed but not iterated)
  futureData.skipToNextBoundary();

  const lenSymbolPins = reader.readUint16();
  const pinNames: string[] = [];
  for (let i = 0; i < lenSymbolPins; i++) {
    const pin = parseSymbolPin(reader);
    pinNames.push(pin.name);
  }

  const lenSdps = reader.readUint16();
  for (let i = 0; i < lenSdps; i++) {
    parseSymbolDisplayProp(reader);
  }

  futureData.checkpoint();

  // Try reading optional GeneralProperties block
  let defaultValue: string | undefined;
  try {
    reader.readStringLenZeroTerm(); // impl_path
    reader.readStringLenZeroTerm(); // impl
    reader.readStringLenZeroTerm(); // ref_des
    const partValue = reader.readStringLenZeroTerm(); // part_value
    if (partValue) defaultValue = partValue;
    reader.skip(2); // properties bitfield + padding
    futureData.checkpoint();
  } catch {
    // GeneralProperties is optional
  }

  return { name, pinNames, defaultValue };
}
