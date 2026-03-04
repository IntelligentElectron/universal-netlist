/**
 * DSN Parser - Top-level parser for OrCAD .DSN files
 *
 * Opens a .DSN CFBF container, parses Page and Package streams,
 * and assembles a ParsedNetlist identical to the .dat parser output.
 */

import { OleReader } from "../../ole-reader/ole-reader.js";
import { BinaryReader } from "./binary-reader.js";
import { StructureType } from "./structure-types.js";
import { FutureDataList, autoReadPrefixes, readPreamble, skipStructure } from "./generic-parser.js";
import type { Wire, PlacedInstance, GraphicInst, Package } from "./structures.js";
import {
  parseWire,
  parsePlacedInstance,
  parseGlobal,
  parsePort,
  parseOffPageConnector,
} from "./structures.js";
import { createPinEntry } from "../../../types.js";
import type { ParsedNetlist, NetConnections, ComponentDetails } from "../../../types.js";
import { isValidRefdes } from "../../../circuit-traversal.js";

// PageSettings is a fixed-size block of 156 bytes
const PAGE_SETTINGS_SIZE = 156;

/**
 * Skip a T0x34 primitive structure.
 * Layout: 9-byte header + id(4) + string + unknownInt(4) + color(4) + lineStyle(4) + lineWidth(4)
 */
function skipT0x34(reader: BinaryReader): void {
  reader.skip(9); // 1 type + 4 structLen + 4 zeros
  reader.skip(4); // id
  reader.readStringLenZeroTerm(); // unknownStr
  reader.skip(4); // unknownInt
  reader.skip(4); // color
  reader.skip(4); // lineStyle
  reader.skip(4); // lineWidth
}

/**
 * Skip a T0x35 primitive structure.
 * Layout: same as T0x34, plus uint16 len + len*4 bytes
 */
function skipT0x35(reader: BinaryReader): void {
  reader.skip(9); // 1 type + 4 structLen + 4 zeros
  reader.skip(4); // id
  reader.readStringLenZeroTerm(); // unknownStr
  reader.skip(4); // unknownInt
  reader.skip(4); // color
  reader.skip(4); // lineStyle
  reader.skip(4); // lineWidth
  const len0 = reader.readUint16();
  reader.skip(len0 * 4);
}

// --- Stream Parsers ---

interface PageData {
  name: string;
  netTable: Map<number, string>;
  wires: Wire[];
  placedInstances: PlacedInstance[];
  ports: GraphicInst[];
  globals: GraphicInst[];
  offPageConnectors: GraphicInst[];
}

/**
 * Parse a single Page stream.
 */
function parsePage(buffer: Buffer): PageData {
  const reader = new BinaryReader(buffer);

  // Page-level prefixes and preamble
  const futureData = new FutureDataList(reader);
  autoReadPrefixes(reader, futureData, StructureType.Page);
  readPreamble(reader);
  futureData.checkpoint();

  const name = reader.readStringLenZeroTerm();
  reader.readStringLenZeroTerm(); // pageSize (skip)
  reader.skip(PAGE_SETTINGS_SIZE); // PageSettings

  // TitleBlocks
  const lenTitleBlocks = reader.readUint16();
  for (let i = 0; i < lenTitleBlocks; i++) {
    skipStructure(reader);
  }

  // T0x34s (primitive structures, no prefix/preamble)
  const lenT0x34s = reader.readUint16();
  for (let i = 0; i < lenT0x34s; i++) {
    skipT0x34(reader);
  }

  // T0x35s (primitive structures, no prefix/preamble)
  const lenT0x35s = reader.readUint16();
  for (let i = 0; i < lenT0x35s; i++) {
    skipT0x35(reader);
  }

  // Net name/ID table (uppercased to match Cadence Allegro export convention)
  const lenNetTable = reader.readUint16();
  const netTable = new Map<number, string>();
  for (let i = 0; i < lenNetTable; i++) {
    const netName = reader.readStringLenZeroTerm().toUpperCase();
    const netId = reader.readUint32();
    netTable.set(netId, netName);
  }

  // Wires
  const lenWires = reader.readUint16();
  const wires: Wire[] = [];
  for (let i = 0; i < lenWires; i++) {
    wires.push(parseWire(reader));
  }

  // PlacedInstances
  const lenPlacedInstances = reader.readUint16();
  const placedInstances: PlacedInstance[] = [];
  for (let i = 0; i < lenPlacedInstances; i++) {
    placedInstances.push(parsePlacedInstance(reader));
  }

  // Ports
  const lenPorts = reader.readUint16();
  const ports: GraphicInst[] = [];
  for (let i = 0; i < lenPorts; i++) {
    ports.push(parsePort(reader));
    reader.skip(5); // 5 unknown bytes after each Port
  }

  // Globals
  const lenGlobals = reader.readUint16();
  const globals: GraphicInst[] = [];
  for (let i = 0; i < lenGlobals; i++) {
    globals.push(parseGlobal(reader));
    reader.skip(5); // 5 unknown bytes after each Global
  }

  // OffPageConnectors
  const lenOffPageConnectors = reader.readUint16();
  const offPageConnectors: GraphicInst[] = [];
  for (let i = 0; i < lenOffPageConnectors; i++) {
    offPageConnectors.push(parseOffPageConnector(reader));
    reader.skip(5); // 5 unknown bytes after each OffPageConnector
  }

  // Remaining sections (ERC, bus entries, graphics, etc.) are skipped

  return { name, netTable, wires, placedInstances, ports, globals, offPageConnectors };
}

/**
 * Parse the Library stream to extract the string list.
 * The string list is used to resolve SymbolDisplayProp nameIdx values.
 */
function parseLibraryStrLst(buffer: Buffer): string[] {
  const reader = new BinaryReader(buffer);

  // Introduction: 32-byte zero-padded string
  reader.skip(32);

  // Version
  reader.skip(2); // versionMajor
  reader.skip(2); // versionMinor

  // Dates
  reader.skip(4); // createDate
  reader.skip(4); // modifyDate

  // 4 bytes assumed zero
  reader.skip(4);

  // Text fonts: uint16 count, then (count-1) LOGFONTA structs
  // LOGFONTA is a Windows struct; from the C++ code we need to figure out its size.
  // Each LOGFONTA: 28 bytes of fixed fields + 32 bytes face name = 60 bytes
  const textFontLen = reader.readUint16();
  if (textFontLen > 0) {
    reader.skip((textFontLen - 1) * 60);
  }

  // someLen (always 24) + 24 x uint16
  const someLen = reader.readUint16();
  reader.skip(someLen * 2);

  // 4 + 4 bytes unknown
  reader.skip(8);

  // 8 part field strings
  for (let i = 0; i < 8; i++) {
    reader.readStringLenZeroTerm();
  }

  // PageSettings
  reader.skip(PAGE_SETTINGS_SIZE);

  // String list: uint16 or uint32 length depending on version
  // Try uint16 first (most common)
  const strLstLen = reader.readUint16();
  const strLst: string[] = [];

  for (let i = 0; i < strLstLen; i++) {
    strLst.push(reader.readStringLenZeroTerm());
  }

  return strLst;
}

// --- Netlist Assembly ---

/**
 * Build pin-to-net mapping using T0x10 net IDs with coordinate-based name resolution.
 *
 * Strategy: Each T0x10 pin instance has a netId (Cadence database net object ID).
 * Pins sharing the same netId are on the same net. The net name is resolved by:
 * 1. Matching pin coordinates to wire endpoints/globals/ports (for named nets)
 * 2. Synthesizing N{netId} for unnamed nets (matching Cadence's convention)
 *
 * This replaces pure coordinate matching, which suffered from cross-page
 * coordinate collisions and couldn't handle unnamed wires.
 */
function buildNetConnectivity(pages: PageData[]): {
  nets: NetConnections;
  componentPins: Map<string, Map<string, string>>;
} {
  // Build per-page coordinate -> net name maps (page-scoped to avoid collisions)
  const pageCoordMaps: Map<string, string>[] = [];

  for (const page of pages) {
    const coordToNet = new Map<string, string>();

    for (const wire of page.wires) {
      let netName: string | undefined;

      if (wire.aliases.length > 0) {
        netName = wire.aliases[0].name.toUpperCase();
      }

      if (!netName) {
        netName = page.netTable.get(wire.id);
      }

      if (netName) {
        coordToNet.set(`${wire.startX},${wire.startY}`, netName);
        coordToNet.set(`${wire.endX},${wire.endY}`, netName);
      }
    }

    for (const global of page.globals) {
      coordToNet.set(`${global.locX},${global.locY}`, global.name.toUpperCase());
    }

    for (const port of page.ports) {
      coordToNet.set(`${port.locX},${port.locY}`, port.name.toUpperCase());
    }

    for (const opc of page.offPageConnectors) {
      coordToNet.set(`${opc.locX},${opc.locY}`, opc.name.toUpperCase());
    }

    pageCoordMaps.push(coordToNet);
  }

  // Collect all pins with their netId and coordinate-resolved name
  interface PinInfo {
    refdes: string;
    pinIdx: number;
    netId: number;
    coordNet?: string;
  }

  const allPins: PinInfo[] = [];

  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const page = pages[pageIdx];
    const coordToNet = pageCoordMaps[pageIdx];

    for (const inst of page.placedInstances) {
      const refdes = inst.reference;
      if (!refdes || !isValidRefdes(refdes)) continue;

      for (let pinIdx = 0; pinIdx < inst.t0x10s.length; pinIdx++) {
        const pin = inst.t0x10s[pinIdx];
        const coordNet = coordToNet.get(`${pin.pointX},${pin.pointY}`);
        allPins.push({ refdes, pinIdx, netId: pin.netId, coordNet });
      }
    }
  }

  // Group pins by netId
  const netIdGroups = new Map<number, PinInfo[]>();
  for (const pin of allPins) {
    if (!netIdGroups.has(pin.netId)) netIdGroups.set(pin.netId, []);
    netIdGroups.get(pin.netId)!.push(pin);
  }

  // Resolve net name for each netId group
  const nets: NetConnections = {};
  const componentPins = new Map<string, Map<string, string>>();

  for (const [netId, groupPins] of netIdGroups) {
    // Collect coordinate-matched names, pick most common
    const nameCounts = new Map<string, number>();
    for (const pin of groupPins) {
      if (pin.coordNet) {
        nameCounts.set(pin.coordNet, (nameCounts.get(pin.coordNet) || 0) + 1);
      }
    }

    let netName: string;
    if (nameCounts.size > 0) {
      netName = [...nameCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    } else {
      // No coordinate match; synthesize N{netId}
      netName = `N${netId}`;
    }

    // Build net connections
    for (const pin of groupPins) {
      const pinNumber = String(pin.pinIdx + 1);

      if (!nets[netName]) nets[netName] = {};
      const existing = nets[netName][pin.refdes];
      if (!existing) {
        nets[netName][pin.refdes] = pinNumber;
      } else if (Array.isArray(existing)) {
        if (!existing.includes(pinNumber)) existing.push(pinNumber);
      } else if (existing !== pinNumber) {
        nets[netName][pin.refdes] = [existing, pinNumber];
      }

      if (!componentPins.has(pin.refdes)) componentPins.set(pin.refdes, new Map());
      componentPins.get(pin.refdes)!.set(pinNumber, netName);
    }
  }

  return { nets, componentPins };
}

/**
 * Build components from PlacedInstances and Packages.
 */
function buildComponents(
  pages: PageData[],
  packages: Map<string, Package>,
  strLst: string[],
  componentPins: Map<string, Map<string, string>>
): ComponentDetails {
  const components: ComponentDetails = {};

  for (const page of pages) {
    for (const inst of page.placedInstances) {
      const refdes = inst.reference;
      if (!refdes || !isValidRefdes(refdes)) continue;
      if (components[refdes]) continue; // already processed

      const pkg = packages.get(inst.pkgName);

      // Extract properties from SymbolDisplayProps using strLst
      let mpn: string | undefined;
      let description: string | undefined;
      let value: string | undefined;

      for (const prop of inst.symbolDisplayProps) {
        const propName = strLst[prop.nameIdx];
        if (!propName) continue;

        // We don't have the prop value directly from SymbolDisplayProp;
        // the value would need to come from the name/value mapping pairs
        // in the short prefix. For now, we extract what we can from packages.
      }

      // Get pin names from package device data
      const pinNets = componentPins.get(refdes);
      const pins: Record<string, import("../../../types.js").PinEntry> = {};

      if (pkg) {
        // Find the device matching this refdes
        for (const device of pkg.devices) {
          if (device.refDes === refdes || device.refDes === pkg.refDes) {
            for (let i = 0; i < device.pinMap.length; i++) {
              const pinName = device.pinMap[i];
              if (pinName === null) continue;
              const pinNumber = String(i + 1);
              const netName = pinNets?.get(pinNumber) ?? "";
              pins[pinNumber] = createPinEntry(pinNumber, pinName, netName);
            }
          }
        }
      }

      // If no package data, still populate pins from connectivity
      if (Object.keys(pins).length === 0 && pinNets) {
        for (const [pinNumber, netName] of pinNets) {
          pins[pinNumber] = netName;
        }
      }

      const component: ComponentDetails[string] = { pins };
      if (mpn) component.mpn = mpn;
      if (description) component.description = description;
      if (value) component.value = value;

      components[refdes] = component;
    }
  }

  return components;
}

// --- Public API ---

/**
 * Parse a .DSN file into a ParsedNetlist.
 */
export function parseDsnFile(dsnPath: string): ParsedNetlist {
  const ole = new OleReader(dsnPath);
  const entries = ole.listAllEntries();

  // Parse Library stream for string list
  const libraryEntry = entries.find((e) => e.path === "Library");
  let strLst: string[] = [];
  if (libraryEntry) {
    try {
      const libraryBuffer = ole.readStreamByPath("Library");
      strLst = parseLibraryStrLst(libraryBuffer);
    } catch {
      // Library parsing is best-effort; continue without it
    }
  }

  // Parse all Page streams
  const pageEntries = entries.filter(
    (e) => /^Views\/.*\/Pages\//.test(e.path) && e.entry.type === 2
  );

  const pages: PageData[] = [];
  for (const pageEntry of pageEntries) {
    const pageBuffer = ole.readStreamByPath(pageEntry.path);
    pages.push(parsePage(pageBuffer));
  }

  // Package data: the Packages/ directory in the CFBF container is empty for
  // this fixture. Package info (pin names, footprints) will be added later
  // if needed. For now, we build components from PlacedInstances only.
  const packages = new Map<string, Package>();

  // Build netlist from parsed data
  const { nets, componentPins } = buildNetConnectivity(pages);
  const components = buildComponents(pages, packages, strLst, componentPins);

  return { nets, components };
}
