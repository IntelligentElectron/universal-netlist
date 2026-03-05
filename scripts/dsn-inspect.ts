/**
 * DSN Inspector
 *
 * Inspect internal DSN structures for debugging: wire graphs, T0x10 net IDs,
 * coordinate matching, and per-component pin analysis.
 *
 * Usage:
 *   npx tsx scripts/dsn-inspect.ts <dsn-file> summary         # Wire/pin statistics
 *   npx tsx scripts/dsn-inspect.ts <dsn-file> component U11    # Pin details for a component
 *   npx tsx scripts/dsn-inspect.ts <dsn-file> net HDMI_1V8     # All pins on a net
 *   npx tsx scripts/dsn-inspect.ts <dsn-file> netid 21667305   # Trace a T0x10 netId
 *   npx tsx scripts/dsn-inspect.ts <dsn-file> unnamed          # List unnamed wire groups
 */

import { OleReader } from "../src/parsers/ole-reader/ole-reader.js";
import { BinaryReader } from "../src/parsers/cadence/dsn/binary-reader.js";
import { StructureType } from "../src/parsers/cadence/dsn/structure-types.js";
import {
  FutureDataList,
  autoReadPrefixes,
  readPreamble,
  skipStructure,
} from "../src/parsers/cadence/dsn/generic-parser.js";
import {
  parseWire,
  parseSymbolDisplayProp,
  parseGlobal,
  parsePort,
  parseOffPageConnector,
} from "../src/parsers/cadence/dsn/structures.js";
import type { Wire, GraphicInst } from "../src/parsers/cadence/dsn/structures.js";
import { isValidRefdes } from "../src/circuit-traversal.js";

const PAGE_SETTINGS_SIZE = 156;

function skipT0x34(r: BinaryReader) {
  r.skip(9);
  r.skip(4);
  r.readStringLenZeroTerm();
  r.skip(16);
}

function skipT0x35(r: BinaryReader) {
  r.skip(9);
  r.skip(4);
  r.readStringLenZeroTerm();
  r.skip(16);
  const l = r.readUint16();
  r.skip(l * 4);
}

function parseT0x10Full(reader: BinaryReader) {
  const futureData = new FutureDataList(reader);
  autoReadPrefixes(reader, futureData, StructureType.T0x10);
  readPreamble(reader);
  futureData.checkpoint();

  const sth = reader.readUint16();
  const pointX = reader.readInt16();
  const pointY = reader.readInt16();
  const netId = reader.readUint32();
  reader.readUint32(); // unknownInt

  const lenSymbolDisplayProps = reader.readUint16();
  for (let i = 0; i < lenSymbolDisplayProps; i++) {
    parseSymbolDisplayProp(reader);
  }

  futureData.checkpoint();

  return { pointX, pointY, netId, sth };
}

// ---------------------------------------------------------------------------
// Data collection
// ---------------------------------------------------------------------------

interface PageInfo {
  name: string;
  netTable: Map<number, string>;
  wires: Wire[];
  coordToNet: Map<string, string>;
  pins: {
    refdes: string;
    pinIdx: number;
    x: number;
    y: number;
    netId: number;
    sth: number;
    coordNet?: string;
  }[];
  globals: GraphicInst[];
  ports: GraphicInst[];
  offPageConnectors: GraphicInst[];
}

function collectPages(dsnPath: string): PageInfo[] {
  const ole = new OleReader(dsnPath);
  const entries = ole.listAllEntries();
  const pageEntries = entries.filter(
    (e) => /^Views\/.*\/Pages\//.test(e.path) && e.entry.type === 2
  );

  const pages: PageInfo[] = [];

  for (const pe of pageEntries) {
    const buf = ole.readStreamByPath(pe.path);
    const r = new BinaryReader(buf);
    const fd = new FutureDataList(r);
    autoReadPrefixes(r, fd, StructureType.Page);
    readPreamble(r);
    fd.checkpoint();
    const name = r.readStringLenZeroTerm();
    r.readStringLenZeroTerm();
    r.skip(PAGE_SETTINGS_SIZE);

    const lt = r.readUint16();
    for (let i = 0; i < lt; i++) skipStructure(r);
    const l34 = r.readUint16();
    for (let i = 0; i < l34; i++) skipT0x34(r);
    const l35 = r.readUint16();
    for (let i = 0; i < l35; i++) skipT0x35(r);

    const lnt = r.readUint16();
    const netTable = new Map<number, string>();
    for (let i = 0; i < lnt; i++) {
      const n = r.readStringLenZeroTerm().toUpperCase();
      const id = r.readUint32();
      netTable.set(id, n);
    }

    const coordToNet = new Map<string, string>();
    const lw = r.readUint16();
    const wires: Wire[] = [];
    for (let i = 0; i < lw; i++) {
      const w = parseWire(r);
      wires.push(w);
      let netName: string | undefined;
      if (w.aliases.length > 0) netName = w.aliases[0].name.toUpperCase();
      else if (netTable.has(w.id)) netName = netTable.get(w.id)!;
      if (netName) {
        coordToNet.set(`${w.startX},${w.startY}`, netName);
        coordToNet.set(`${w.endX},${w.endY}`, netName);
      }
    }

    const pins: PageInfo["pins"] = [];
    const li = r.readUint16();
    for (let i = 0; i < li; i++) {
      const instFd = new FutureDataList(r);
      autoReadPrefixes(r, instFd, StructureType.PlacedInstance);
      readPreamble(r);
      instFd.checkpoint();
      r.skip(8);
      r.readStringLenZeroTerm(); // pkgName
      r.skip(4);
      r.skip(8);
      r.readInt16(); // locX
      r.readInt16(); // locY
      r.skip(4);
      const lenSdp = r.readUint16();
      for (let j = 0; j < lenSdp; j++) parseSymbolDisplayProp(r);
      r.skip(1);
      instFd.checkpoint();
      const reference = r.readStringLenZeroTerm();
      r.skip(14);

      const lenT0x10 = r.readUint16();
      for (let j = 0; j < lenT0x10; j++) {
        const pin = parseT0x10Full(r);
        if (reference && isValidRefdes(reference)) {
          pins.push({
            refdes: reference,
            pinIdx: j,
            x: pin.pointX,
            y: pin.pointY,
            netId: pin.netId,
            sth: pin.sth,
            coordNet: coordToNet.get(`${pin.pointX},${pin.pointY}`),
          });
        }
      }

      instFd.checkpoint();
      r.readStringLenZeroTerm(); // sourcePackage
      r.skip(2);
      instFd.checkpoint();
    }

    const lp = r.readUint16();
    const ports: GraphicInst[] = [];
    for (let i = 0; i < lp; i++) {
      const port = parsePort(r);
      r.skip(5);
      ports.push(port);
      coordToNet.set(`${port.locX},${port.locY}`, port.name.toUpperCase());
    }

    const lg = r.readUint16();
    const globals: GraphicInst[] = [];
    for (let i = 0; i < lg; i++) {
      const global = parseGlobal(r);
      r.skip(5);
      globals.push(global);
      coordToNet.set(`${global.locX},${global.locY}`, global.name.toUpperCase());
    }

    const lo = r.readUint16();
    const offPageConnectors: GraphicInst[] = [];
    for (let i = 0; i < lo; i++) {
      const opc = parseOffPageConnector(r);
      r.skip(5);
      offPageConnectors.push(opc);
      coordToNet.set(`${opc.locX},${opc.locY}`, opc.name.toUpperCase());
    }

    pages.push({ name, netTable, wires, coordToNet, pins, globals, ports, offPageConnectors });
  }

  return pages;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function cmdSummary(pages: PageInfo[]) {
  let totalWires = 0;
  let namedByAlias = 0;
  let namedByTable = 0;
  let unnamed = 0;
  let totalPins = 0;
  let pinsWithCoord = 0;
  let pinsWithoutCoord = 0;
  const refdesSet = new Set<string>();
  const netIdSet = new Set<number>();

  for (const page of pages) {
    for (const w of page.wires) {
      totalWires++;
      if (w.aliases.length > 0) namedByAlias++;
      else if (page.netTable.has(w.id)) namedByTable++;
      else unnamed++;
    }
    for (const pin of page.pins) {
      totalPins++;
      refdesSet.add(pin.refdes);
      netIdSet.add(pin.netId);
      if (pin.coordNet) pinsWithCoord++;
      else pinsWithoutCoord++;
    }
  }

  console.log("\n=== DSN Summary ===\n");
  console.log(`Pages: ${pages.length}`);
  console.log(`  ${pages.map((p) => p.name).join(", ")}`);
  console.log(`\nWires: ${totalWires}`);
  console.log(`  Named by alias: ${namedByAlias}`);
  console.log(`  Named by net table: ${namedByTable}`);
  console.log(`  Unnamed: ${unnamed}`);
  console.log(`\nComponents: ${refdesSet.size}`);
  console.log(`Pins: ${totalPins}`);
  console.log(`  With coordinate match: ${pinsWithCoord}`);
  console.log(`  Without coordinate match: ${pinsWithoutCoord}`);
  console.log(`Unique net IDs (T0x10.netId): ${netIdSet.size}`);
}

function cmdComponent(pages: PageInfo[], refdesFilter: string) {
  console.log(`\n=== Component: ${refdesFilter} ===\n`);

  // Build netId -> resolved name map
  const netIdNames = new Map<number, string>();
  for (const page of pages) {
    for (const pin of page.pins) {
      if (pin.coordNet && !netIdNames.has(pin.netId)) {
        netIdNames.set(pin.netId, pin.coordNet);
      }
    }
  }

  for (const page of pages) {
    const compPins = page.pins.filter((p) => p.refdes === refdesFilter);
    if (compPins.length === 0) continue;

    console.log(`Page: ${page.name} (${compPins.length} pins)`);
    console.log("Idx  Sth  Coords          NetId         CoordNet             ResolvedNet");
    console.log("---  ---  --------------  ------------  -------------------  -------------------");

    for (const pin of compPins) {
      const resolved = netIdNames.get(pin.netId) || `N${pin.netId}`;
      const match = pin.coordNet === resolved ? "" : pin.coordNet ? " !" : "";
      console.log(
        `${String(pin.pinIdx).padStart(3)}  ${String(pin.sth).padStart(3)}  ` +
          `(${String(pin.x).padStart(5)},${String(pin.y).padStart(5)})  ` +
          `${String(pin.netId).padStart(12)}  ` +
          `${(pin.coordNet || "(none)").padEnd(20)} ${resolved}${match}`
      );
    }
    console.log();
  }
}

function cmdNet(pages: PageInfo[], netNameFilter: string) {
  const upper = netNameFilter.toUpperCase();
  console.log(`\n=== Net: ${upper} ===\n`);

  // Find all pins whose coordinate resolves to this net
  for (const page of pages) {
    const matching = page.pins.filter((p) => p.coordNet === upper);
    if (matching.length === 0) continue;

    console.log(`Page: ${page.name}`);
    for (const pin of matching) {
      console.log(`  ${pin.refdes} pin[${pin.pinIdx}] at (${pin.x},${pin.y}) netId=${pin.netId}`);
    }
  }

  // Also find wires with this net name
  console.log(`\nWires:`);
  for (const page of pages) {
    for (const w of page.wires) {
      let wNet: string | undefined;
      if (w.aliases.length > 0) wNet = w.aliases[0].name.toUpperCase();
      else if (page.netTable.has(w.id)) wNet = page.netTable.get(w.id)!;
      if (wNet === upper) {
        console.log(
          `  [${page.name}] wire id=${w.id} (${w.startX},${w.startY})-(${w.endX},${w.endY})`
        );
      }
    }
  }
}

function cmdNetId(pages: PageInfo[], netIdStr: string) {
  const netId = parseInt(netIdStr, 10);
  console.log(`\n=== NetId: ${netId} ===\n`);

  const allPins = pages.flatMap((page) =>
    page.pins.filter((p) => p.netId === netId).map((p) => ({ ...p, page: page.name }))
  );

  if (allPins.length === 0) {
    console.log("No pins found with this netId.");
    return;
  }

  console.log(`Found ${allPins.length} pins:`);
  for (const pin of allPins) {
    console.log(
      `  [${pin.page}] ${pin.refdes} pin[${pin.pinIdx}] at (${pin.x},${pin.y}) coord=${pin.coordNet || "(none)"}`
    );
  }

  const coordNames = new Set(allPins.map((p) => p.coordNet).filter(Boolean));
  if (coordNames.size > 0) {
    console.log(`\nCoordinate-resolved names: ${[...coordNames].join(", ")}`);
  } else {
    console.log(`\nNo coordinate match. Synthesized name: N${netId}`);
  }
}

function cmdUnnamed(pages: PageInfo[]) {
  console.log("\n=== Unnamed Wire Groups ===\n");

  for (const page of pages) {
    const unnamedWires = page.wires.filter(
      (w) => w.aliases.length === 0 && !page.netTable.has(w.id)
    );

    if (unnamedWires.length === 0) continue;

    // Group by wire ID
    const groups = new Map<number, Wire[]>();
    for (const w of unnamedWires) {
      if (!groups.has(w.id)) groups.set(w.id, []);
      groups.get(w.id)!.push(w);
    }

    console.log(`Page: ${page.name} (${unnamedWires.length} unnamed wires, ${groups.size} groups)`);
    for (const [wireId, wires] of groups) {
      const coords = wires.map((w) => `(${w.startX},${w.startY})-(${w.endX},${w.endY})`);
      console.log(`  wireId=${wireId}: ${coords.join(", ")}`);

      // Check if any pin connects at these wire endpoints
      for (const w of wires) {
        for (const pin of page.pins) {
          if (
            (pin.x === w.startX && pin.y === w.startY) ||
            (pin.x === w.endX && pin.y === w.endY)
          ) {
            console.log(
              `    -> ${pin.refdes} pin[${pin.pinIdx}] at (${pin.x},${pin.y}) netId=${pin.netId}`
            );
          }
        }
      }
    }
    console.log();
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

if (args.length < 2) {
  console.log("Usage:");
  console.log("  npx tsx scripts/dsn-inspect.ts <dsn-file> summary");
  console.log("  npx tsx scripts/dsn-inspect.ts <dsn-file> component <REFDES>");
  console.log("  npx tsx scripts/dsn-inspect.ts <dsn-file> net <NET_NAME>");
  console.log("  npx tsx scripts/dsn-inspect.ts <dsn-file> netid <ID>");
  console.log("  npx tsx scripts/dsn-inspect.ts <dsn-file> unnamed");
  process.exit(1);
}

const [dsnPath, command, ...rest] = args;
const pages = collectPages(dsnPath);

switch (command) {
  case "summary":
    cmdSummary(pages);
    break;
  case "component":
    if (!rest[0]) {
      console.error("Missing refdes argument");
      process.exit(1);
    }
    cmdComponent(pages, rest[0]);
    break;
  case "net":
    if (!rest[0]) {
      console.error("Missing net name argument");
      process.exit(1);
    }
    cmdNet(pages, rest[0]);
    break;
  case "netid":
    if (!rest[0]) {
      console.error("Missing netId argument");
      process.exit(1);
    }
    cmdNetId(pages, rest[0]);
    break;
  case "unnamed":
    cmdUnnamed(pages);
    break;
  default:
    console.error(`Unknown command: ${command}`);
    process.exit(1);
}
