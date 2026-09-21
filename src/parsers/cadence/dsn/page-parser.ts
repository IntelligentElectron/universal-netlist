/**
 * Page & Package Stream Parsers
 *
 * Parses Page OLE streams (schematic pages) and Package OLE streams
 * (component definitions with pin maps).
 *
 * Port of OpenOrCadParser StreamPage.cpp / StreamPackage.cpp
 */

import { BinaryReader } from "./binary-reader.js";
import { StructureType } from "./structure-types.js";
import { FutureDataList, autoReadPrefixes, readPreamble, skipStructure } from "./generic-parser.js";
import type {
  Wire,
  PlacedInstance,
  DrawnInstance,
  GraphicInst,
  LibraryPart,
  Package,
} from "./structures.js";
import type { Placement } from "./hierarchy-expander.js";
import {
  parseWire,
  parsePlacedInstance,
  parseDrawnInstance,
  parseGlobal,
  parsePort,
  parseOffPageConnector,
  parsePackage,
  parseLibraryPart,
} from "./structures.js";

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

export interface PageData {
  name: string;
  netTable: Map<number, string[]>;
  wires: Wire[];
  placedInstances: PlacedInstance[];
  /** The hierarchical blocks drawn on the page, each placing a child schematic. */
  drawnInstances: DrawnInstance[];
  ports: GraphicInst[];
  globals: GraphicInst[];
  offPageConnectors: GraphicInst[];
  /**
   * Set on a copy of the page made for one placement of the hierarchical block
   * that draws its schematic; absent on a page read as it is. See
   * hierarchy-expander.ts.
   */
  placement?: Placement;
}

/** Parse a single Page stream. */
export function parsePage(buffer: Buffer): PageData {
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

  // Net name/ID table (uppercased to match Cadence Allegro export convention).
  // Multiple names can map to the same netId (e.g., "VOLUP" and "GPIO2"),
  // so we store all names per netId to let hierarchy preference resolve ties.
  const lenNetTable = reader.readUint16();
  const netTable = new Map<number, string[]>();
  for (let i = 0; i < lenNetTable; i++) {
    const netName = reader.readStringLenZeroTerm().toUpperCase();
    const netId = reader.readUint32();
    const existing = netTable.get(netId);
    if (existing) {
      existing.push(netName);
    } else {
      netTable.set(netId, [netName]);
    }
  }

  // Wires
  const lenWires = reader.readUint16();
  const wires: Wire[] = [];
  for (let i = 0; i < lenWires; i++) {
    wires.push(parseWire(reader));
  }

  // PlacedInstances, interleaved with the DrawnInstances that place
  // hierarchical blocks. OpenOrCadParser reads this list generically and skips
  // DrawnInstance as unimplemented; its body is read here (see structures.ts).
  const lenPlacedInstances = reader.readUint16();
  const placedInstances: PlacedInstance[] = [];
  const drawnInstances: DrawnInstance[] = [];
  for (let i = 0; i < lenPlacedInstances; i++) {
    if (reader.peek(1)[0] === StructureType.DrawnInstance) {
      // Best-effort: a block record this parser cannot read is skipped by its
      // own boundary, which costs that placement and nothing else on the page.
      const start = reader.tell();
      try {
        drawnInstances.push(parseDrawnInstance(reader));
      } catch {
        reader.seek(start);
        skipStructure(reader);
      }
      continue;
    }
    placedInstances.push(parsePlacedInstance(reader));
  }

  // Ports
  const lenPorts = reader.readUint16();
  const ports: GraphicInst[] = [];
  for (let i = 0; i < lenPorts; i++) {
    ports.push(parsePort(reader));
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

  return {
    name,
    netTable,
    wires,
    placedInstances,
    drawnInstances,
    ports,
    globals,
    offPageConnectors,
  };
}

export interface PackageStreamResult {
  pkg: Package;
  libraryParts: LibraryPart[];
}

/**
 * Parse a Package OLE stream into a Package structure and LibraryParts.
 *
 * Layout: uint16 lenPartCells -> [PartCell + LibraryParts]... -> Package.
 * LibraryParts contain SymbolPin names used for pin name enrichment.
 */
export function parsePackageStream(buffer: Buffer): PackageStreamResult {
  const reader = new BinaryReader(buffer);
  const libraryParts: LibraryPart[] = [];
  const lenPartCells = reader.readUint16();
  for (let i = 0; i < lenPartCells; i++) {
    skipStructure(reader); // PartCell
    const lenLibraryParts = reader.readUint16();
    for (let j = 0; j < lenLibraryParts; j++) {
      const pos = reader.tell();
      try {
        libraryParts.push(parseLibraryPart(reader));
      } catch {
        // Fall back to skipping if parsing fails
        reader.seek(pos);
        skipStructure(reader);
      }
    }
  }
  return { pkg: parsePackage(reader), libraryParts };
}
