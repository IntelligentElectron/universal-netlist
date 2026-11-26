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
  /** 0 hidden, 1 value, 2 name and value, 3 name (docs/cadence-dsn-format.md §9.1.2). */
  displayMode: number;
}

export interface Alias {
  locX: number;
  locY: number;
  name: string;
}

export interface Wire {
  /** A bus wire (type 21) rather than a scalar one (type 20). */
  bus: boolean;
  /** Junction dots: bit 0 at the start, bit 1 at the end. */
  junctions: number;
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
  /** +0x06: the `db_id` of the wire ending at the pin; 0 or 0xFFFFFFFF for none (§7.4). */
  wireId: number;
  /** +0x0A: the pin's SchematicNet id when no wire gives it one, else 0 (§7.4). */
  netId: number;
  symbolDisplayProps: SymbolDisplayProp[];
}

export interface PlacedInstance {
  pkgName: string;
  /**
   * String-table index of the library the part was placed from (§7.4). The
   * Cache keeps one definition per name and library, so this picks the
   * instance's own among same-named ones (§5.6).
   */
  libraryIdx?: number;
  /** The library `libraryIdx` names, resolved by the design parser. */
  library?: string;
  dbId: number;
  reference: string;
  sourcePackage: string;
  partValueIdx: number;
  prefixProperties: PrefixPropertyPair[];
  locX: number;
  locY: number;
  /** Stored bounding box, page coordinates: all zero on a few records. */
  box: Box;
  /** Quarter turns counterclockwise, 0 to 3, applied after the mirror. */
  rotation: number;
  mirrored: boolean;
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
  /**
   * The part's PACK_SHORT groups as pin indices: the pins of each group are
   * shorted inside the package (§5.8). Set from the library part; absent when
   * it has none.
   */
  packShort?: number[][];
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
  /** The block's stored outline, page coordinates. */
  box: Box;
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
  /** Quarter turns counterclockwise, 0 to 3, applied after the mirror. */
  rotation: number;
  mirrored: boolean;
  symbolDisplayProps: SymbolDisplayProp[];
  /**
   * Ports, Globals and off-page connectors: the `db_id` of the wire at the
   * connection point, from the trailer; 0 when no wire touches it (§7.10, §7.11).
   */
  wireId?: number;
  /** Ports: the port type code from the trailer (§7.10). */
  portType?: number;
  /**
   * Ports, Globals and off-page connectors: the connection point, its cached
   * symbol's single pin hot point placed on the page (§7.7, §11.4); undefined
   * when the Cache holds no such symbol.
   */
  connection?: [number, number];
}

/** A rectangle in page coordinates (1/100 inch). */
export interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** The page's title block: its fields and where the page sits in the set. */
export interface TitleBlock {
  /** The title-block fields, as `(name index, value index)` string-table pairs. */
  properties: PrefixPropertyPair[];
  /** Its graphic-instance base: symbol name, location, box, transform and displays. */
  base: GraphicInst;
  pageNumber: number;
  pageCount: number;
}

/** A 45-degree stub joining a wire to a bus. */
export interface BusEntry {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Bits 8-9 of the transform word are quarter turns, bit 10 the mirror. */
const decodeTransform = (word: number) => ({
  rotation: (word >> 8) & 3,
  mirrored: (word & 0x400) !== 0,
});

export interface Device {
  unitRef: string;
  /** The part cell this device belongs to (§5.4). */
  cellName: string;
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
  reader.skip(1); // opaque byte
  const displayMode = reader.readUint16();

  futureData.checkpoint();

  return { nameIdx, x, y, textFontIdx, rotation, propColor, displayMode };
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
  const { structType } = autoReadPrefixes(reader, futureData); // WireScalar or WireBus
  readPreamble(reader);
  futureData.checkpoint();

  const segmentId = reader.readUint32();
  const id = reader.readUint32();
  reader.skip(4); // color
  const startX = reader.readInt32();
  const startY = reader.readInt32();
  const endX = reader.readInt32();
  const endY = reader.readInt32();
  const junctions = reader.readUint8(); // bit 0 dot at start, bit 1 dot at end (§7.8)

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

  return {
    bus: structType === StructureType.WireBus,
    junctions,
    segmentId,
    id,
    startX,
    startY,
    endX,
    endY,
    aliases,
  };
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
  const wireId = reader.readUint32();
  const netId = reader.readUint32();

  const lenSymbolDisplayProps = reader.readUint16();
  const symbolDisplayProps: SymbolDisplayProp[] = [];
  for (let i = 0; i < lenSymbolDisplayProps; i++) {
    symbolDisplayProps.push(parseSymbolDisplayProp(reader));
  }

  futureData.checkpoint();

  return { pinIndex, pointX, pointY, wireId, netId, symbolDisplayProps };
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

  reader.skip(4); // internal instance name index
  const libraryIdx = reader.readUint32();
  const pkgName = reader.readStringLenZeroTerm();
  const dbId = reader.readUint32();
  const box = readBox(reader);
  const locX = reader.readInt16();
  const locY = reader.readInt16();
  const { rotation, mirrored } = decodeTransform(reader.readUint16());
  reader.skip(2); // type echo, reserved byte

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
    libraryIdx,
    dbId,
    reference,
    sourcePackage,
    partValueIdx,
    prefixProperties,
    locX,
    locY,
    box,
    rotation,
    mirrored,
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
  const box = readBox(reader);
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

  return { dbId, reference, ports, pins, locX, locY, box };
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

  // Box corners Y before X, then the location X before Y. OpenOrCadParser reads
  // this as loc, y2, x2, x1, y1; the location then falls inside the box on every
  // record (docs/cadence-dsn-format.md chapter 7).
  const { x1, y1, x2, y2 } = readBox(reader);
  const locX = reader.readInt16();
  const locY = reader.readInt16();
  const { rotation, mirrored } = decodeTransform(reader.readUint16());
  reader.skip(2); // type echo, reserved byte

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

  return {
    name,
    dbId,
    locX,
    locY,
    x1,
    y1,
    x2,
    y2,
    pairingId,
    rotation,
    mirrored,
    symbolDisplayProps,
  };
}

/** A stored bounding box: corners y before x (docs/cadence-dsn-format.md §7.2). */
function readBox(reader: BinaryReader): Box {
  const y1 = reader.readInt16();
  const x1 = reader.readInt16();
  const y2 = reader.readInt16();
  const x2 = reader.readInt16();
  return { x1, y1, x2, y2 };
}

/** A TitleBlock (65): graphic-instance base, then a 12-byte trailer (§7.13). */
export function parseTitleBlock(reader: BinaryReader): TitleBlock {
  const futureData = new FutureDataList(reader);
  const { properties } = autoReadPrefixes(reader, futureData, StructureType.TitleBlock);
  const base = parseGraphicInstBase(reader, futureData);
  reader.skip(4); // keep in lower-right corner
  const pageCount = reader.readUint32();
  const pageNumber = reader.readUint32();
  futureData.checkpoint();
  return { properties, base, pageNumber, pageCount };
}

/** A BusEntry (29): a 28-byte body holding its two end points (§7.12). */
export function parseBusEntry(reader: BinaryReader): BusEntry {
  const futureData = new FutureDataList(reader);
  autoReadPrefixes(reader, futureData, StructureType.BusEntry);
  readPreamble(reader);
  futureData.checkpoint();
  reader.skip(4); // header word, 48 on every record
  const x1 = reader.readInt32();
  const y1 = reader.readInt32();
  const x2 = reader.readInt32();
  const y2 = reader.readInt32();
  reader.skip(8); // reserved
  futureData.checkpoint();
  return { x1, y1, x2, y2 };
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
  inst.wireId = reader.readUint32();
  reader.skip(1); // flag (§7.10)
  inst.portType = reader.readUint32();
  futureData.checkpoint();

  return inst;
}

/** A marker Capture's design rules check left on a page (§7.14). */
export interface ErcMarker {
  message: string;
  detail: string;
  location: string;
  x: number;
  y: number;
}

/** An ErcObject: the graphic-instance base, then three strings (§7.14). */
export function parseErcObject(reader: BinaryReader): ErcMarker {
  const futureData = new FutureDataList(reader);
  autoReadPrefixes(reader, futureData, StructureType.ERCObject);
  const inst = parseGraphicInstBase(reader, futureData);
  const message = reader.readStringLenZeroTerm();
  const detail = reader.readStringLenZeroTerm();
  const location = reader.readStringLenZeroTerm();
  futureData.checkpoint();
  return { message, detail, location, x: inst.locX, y: inst.locY };
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
  const cellName = reader.readStringLenZeroTerm();

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

  return { unitRef, cellName, pinMap, pinIgnore };
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
  /** Inner end of the pin line, symbol coordinates. */
  startX: number;
  startY: number;
  /** The connection point. */
  hotX: number;
  hotY: number;
  /** Shape bits: 0x20 visible, 0x80 global (docs/cadence-dsn-format.md §5.2.5). */
  shape: number;
  pinType: number;
}

export function parseSymbolPin(reader: BinaryReader): SymbolPin {
  const futureData = new FutureDataList(reader);
  autoReadPrefixes(reader, futureData); // accepts SymbolPinScalar (0x1A) or SymbolPinBus (0x1B)
  readPreamble(reader);
  futureData.checkpoint();

  const name = reader.readStringLenZeroTerm();
  const startX = reader.readInt32();
  const startY = reader.readInt32();
  const hotX = reader.readInt32();
  const hotY = reader.readInt32();
  const shape = reader.readUint16();
  reader.skip(2); // opaque word
  const pinType = reader.readUint32();
  reader.skip(4); // type tag and opaque bytes

  const lenSymbolDisplayProps = reader.readUint16();
  for (let i = 0; i < lenSymbolDisplayProps; i++) {
    parseSymbolDisplayProp(reader);
  }

  futureData.checkpoint();

  return { name, startX, startY, hotX, hotY, shape, pinType };
}

export interface LibraryPart {
  name: string;
  pinNames: string[];
  /** Each pin slot's `pin_type` (§5.2.5), -1 for an empty slot; parallel to `pinNames`. */
  pinTypes: number[];
  /** Each pin slot's shape bits (§5.2.5), 0 for an empty slot; parallel to `pinNames`. */
  pinShapes: number[];
  defaultValue?: string;
  /** The short prefix's (name, value) string-list index pairs, such as PACK_SHORT. */
  properties: PrefixPropertyPair[];
}

export function parseLibraryPart(reader: BinaryReader): LibraryPart {
  const futureData = new FutureDataList(reader);
  const { properties } = autoReadPrefixes(reader, futureData, StructureType.LibraryPart);
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
  const pinTypes: number[] = [];
  const pinShapes: number[] = [];
  for (let i = 0; i < lenSymbolPins; i++) {
    // C++ reference: 0x00 byte marks a "convert view" pin placeholder.
    // Skip the marker and push empty string to maintain index alignment
    // for T0x10.pinIndex lookups in component-builder.ts.
    if (reader.peek(1)[0] === 0x00) {
      reader.skip(1);
      pinNames.push("");
      pinTypes.push(-1);
      pinShapes.push(0);
      continue;
    }
    const pin = parseSymbolPin(reader);
    pinNames.push(pin.name);
    pinTypes.push(pin.pinType);
    pinShapes.push(pin.shape);
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

  return { name, pinNames, pinTypes, pinShapes, defaultValue, properties };
}
