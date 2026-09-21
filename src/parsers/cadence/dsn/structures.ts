/**
 * DSN Structure Parsers - Netlist-critical types
 *
 * Port of OpenOrCadParser structure parsers.
 * Each parser reads prefixes, preamble, fields, and checkpoints.
 */

import { BinaryReader } from "./binary-reader.js";
import { StructureType, structureTypeName } from "./structure-types.js";
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
  /**
   * 0-based section (device) index within a multi-section package, read from
   * the uint16 following sourcePackage. Single-section parts carry 0.
   */
  sectionIndex: number;
  /**
   * Pin numbers this occurrence of the part assigns, by pin index, where they
   * differ from the section the page record draws. Set by the hierarchy
   * expander from the occurrence's `Number` pin properties; absent on a page
   * read as it is.
   */
  pinNumbers?: ReadonlyMap<number, string>;
}

/**
 * A hierarchical block drawn on a page: one placement of a child schematic.
 *
 * The record is a PlacedInstance with an empty package name whose body embeds
 * the block symbol as a LibraryPart, so the symbol's pins name the block's
 * hierarchical ports in pin order. Its pins carry the same records as a part's
 * pins, and their positions are where the parent page's wires reach the block.
 */
export interface DrawnInstance {
  /** The id the Hierarchy stream's block occurrence names. */
  dbId: number;
  /** The instance name, such as `MV1`; Capture suffixes it onto the placement's local nets. */
  reference: string;
  /** Hierarchical port names, in pin order: `ports[i]` is the port of the pin with index `i + 1`. */
  ports: string[];
  pins: T0x10[];
  locX: number;
  locY: number;
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
  /** strLst index for the net name (first uint32 of body). OPCs with the same index share the same net. */
  pairingId: number;
  symbolDisplayProps: SymbolDisplayProp[];
}

export interface Device {
  unitRef: string;
  refDes: string;
  pinMap: (string | null)[];
  /**
   * Per-pin "Pin Ignore" flag, bit 7 of the byte following each pin name
   * (OrCAD's Pin Properties -> Ignore). Parallel to `pinMap`.
   *
   * A section of a multi-section package that has no pad for one of the part's
   * logical pins marks that pin ignored. Cadence's own netlist writer drops it:
   * a quad RJ45's `SHD2` pin exports as `PIN_NUMBER='(0,0,0,S5)'`, present only
   * on the fourth section.
   */
  pinIgnore: boolean[];
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

/**
 * Parse a pin record: a T0x10 on a PlacedInstance, or a T0x10 or T0x11 on a
 * DrawnInstance. The two types share one body; a DrawnInstance draws some of
 * its pins under each.
 */
export function parseT0x10(reader: BinaryReader): T0x10 {
  const futureData = new FutureDataList(reader);
  const { structType } = autoReadPrefixes(reader, futureData);
  if (structType !== StructureType.T0x10 && structType !== StructureType.T0x11) {
    throw new Error(
      `Expected structure type T0x10 or T0x11, got ${structureTypeName[structType] ?? structType}`
    );
  }
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
  const sectionIndex = reader.readUint16();

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
    sectionIndex,
  };
}

/** The byte a DrawnInstance writes before its embedded block symbol. */
const DRAWN_INSTANCE_SYMBOL_MARKER = 0x18;

/**
 * Parse a DrawnInstance, the record OpenOrCadParser skips as unimplemented.
 *
 * The body follows PlacedInstance up to its display properties, then a marker
 * byte and the embedded LibraryPart replace the byte PlacedInstance skips, and
 * the reference, part-value index, ten bytes and pin list follow as in a
 * PlacedInstance. There is no source package or section after the pins.
 */
export function parseDrawnInstance(reader: BinaryReader): DrawnInstance {
  const futureData = new FutureDataList(reader);
  autoReadPrefixes(reader, futureData, StructureType.DrawnInstance);
  readPreamble(reader);
  futureData.checkpoint();

  reader.skip(8); // unknown
  reader.readStringLenZeroTerm(); // package name, empty on a drawn instance
  const dbId = reader.readUint32();
  reader.skip(8); // unknown
  const locX = reader.readInt16();
  const locY = reader.readInt16();
  reader.skip(4); // unknown

  const lenSymbolDisplayProps = reader.readUint16();
  for (let i = 0; i < lenSymbolDisplayProps; i++) {
    parseSymbolDisplayProp(reader);
  }

  futureData.checkpoint();

  let ports: string[] = [];
  if (reader.readUint8() === DRAWN_INSTANCE_SYMBOL_MARKER) {
    ports = parseLibraryPart(reader).pinNames;
  }

  const reference = reader.readStringLenZeroTerm();
  reader.skip(4); // part value index
  reader.skip(10); // unknown

  const lenPins = reader.readUint16();
  const pins: T0x10[] = [];
  for (let i = 0; i < lenPins; i++) {
    pins.push(parseT0x10(reader));
  }

  futureData.readRestOfStructure();

  return { dbId, reference, ports, pins, locX, locY };
}

/**
 * Parse StructGraphicInst (base for Global, Port, OffPageConnector).
 * Note: Y coordinates are read before X in this structure.
 */
function parseGraphicInstBase(reader: BinaryReader, futureData: FutureDataList): GraphicInst {
  readPreamble(reader);
  futureData.checkpoint();

  // First uint32: strLst index for net name (e.g., "LOL", "VCC_3V3")
  // Second uint32: strLst index for source library path (e.g., "CAPSYM.OLB")
  const pairingId = reader.readUint32();
  reader.skip(4); // libStrIdx (not used)
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
  const pinIgnore: boolean[] = [];

  for (let i = 0; i < pinCount; i++) {
    const strLen = reader.readInt16();
    if (strLen === -1) {
      pinMap.push(null);
      pinIgnore.push(false);
      continue;
    }
    // Put back the 2 bytes we just read (they're the string length)
    reader.seek(reader.tell() - 2);
    const pinName = reader.readStringLenZeroTerm();
    // bitMapPinGrpCfg: bit 7 is Pin Ignore, bits 6..0 are the pin group
    const bitMapPinGrpCfg = reader.readUint8();
    pinMap.push(pinName);
    pinIgnore.push((bitMapPinGrpCfg & 0x80) !== 0);
  }

  futureData.checkpoint();

  return { unitRef, refDes, pinMap, pinIgnore };
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
    // C++ reference: 0x00 byte marks a "convert view" pin placeholder.
    // Skip the marker and push empty string to maintain index alignment
    // for T0x10.pinIndex lookups in component-builder.ts.
    if (reader.peek(1)[0] === 0x00) {
      reader.skip(1);
      pinNames.push("");
      continue;
    }
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
