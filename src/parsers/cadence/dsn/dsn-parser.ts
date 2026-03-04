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

  // Net name/ID table
  const lenNetTable = reader.readUint16();
  const netTable = new Map<number, string>();
  for (let i = 0; i < lenNetTable; i++) {
    const netName = reader.readStringLenZeroTerm();
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
 * Build pin-to-net mapping using geometric coordinate matching.
 *
 * Strategy: Each wire has start/end coordinates and aliases (net names).
 * Each PlacedInstance has T0x10 pin instances with coordinates.
 * Globals have coordinates and names (power net names).
 * A pin connects to a net when its coordinates match a wire endpoint.
 *
 * We also build a coordinate-to-net lookup from all wire endpoints.
 */
function buildNetConnectivity(pages: PageData[]): {
  nets: NetConnections;
  componentPins: Map<string, Map<string, string>>;
} {
  // Build coordinate -> net name mapping from all wires
  const coordToNet = new Map<string, string>();

  // Also track wire ID -> net name from both aliases and net table
  for (const page of pages) {
    for (const wire of page.wires) {
      let netName: string | undefined;

      // Primary: get net name from wire aliases
      if (wire.aliases.length > 0) {
        netName = wire.aliases[0].name;
      }

      // Fallback: get net name from page net table using wire ID
      if (!netName) {
        netName = page.netTable.get(wire.id);
      }

      if (netName) {
        const startKey = `${wire.startX},${wire.startY}`;
        const endKey = `${wire.endX},${wire.endY}`;
        coordToNet.set(startKey, netName);
        coordToNet.set(endKey, netName);
      }
    }

    // Add global (power symbol) coordinates -> net name
    for (const global of page.globals) {
      const key = `${global.locX},${global.locY}`;
      coordToNet.set(key, global.name);
    }

    // Add port coordinates -> net name
    for (const port of page.ports) {
      const key = `${port.locX},${port.locY}`;
      coordToNet.set(key, port.name);
    }

    // Add off-page connector coordinates -> net name
    for (const opc of page.offPageConnectors) {
      const key = `${opc.locX},${opc.locY}`;
      coordToNet.set(key, opc.name);
    }
  }

  // Now match pin coordinates to nets
  const nets: NetConnections = {};
  const componentPins = new Map<string, Map<string, string>>();

  for (const page of pages) {
    for (const inst of page.placedInstances) {
      const refdes = inst.reference;
      if (!refdes || !isValidRefdes(refdes)) continue;

      for (let pinIdx = 0; pinIdx < inst.t0x10s.length; pinIdx++) {
        const pin = inst.t0x10s[pinIdx];
        const pinKey = `${pin.pointX},${pin.pointY}`;
        const netName = coordToNet.get(pinKey);

        if (netName) {
          const pinNumber = String(pinIdx + 1);

          // Add to nets
          if (!nets[netName]) nets[netName] = {};
          const existing = nets[netName][refdes];
          if (!existing) {
            nets[netName][refdes] = pinNumber;
          } else if (Array.isArray(existing)) {
            if (!existing.includes(pinNumber)) existing.push(pinNumber);
          } else if (existing !== pinNumber) {
            nets[netName][refdes] = [existing, pinNumber];
          }

          // Track pin -> net for component building
          if (!componentPins.has(refdes)) componentPins.set(refdes, new Map());
          componentPins.get(refdes)!.set(pinNumber, netName);
        }
      }
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
