/**
 * DSN Inspector
 *
 * Single tool for inspecting all internal DSN structures: OLE streams, hierarchy,
 * net tables, wire graphs, pins, symbols, and coordinate matching.
 *
 * Usage:
 *   node --import tsx scripts/dsn-inspect.ts <dsn-file> <command> [args...]
 *
 * Commands:
 *   summary                        Wire/pin statistics
 *   component <REFDES>             Pin details for a component
 *   net <NET_NAME>                 All pins on a net
 *   netid <ID>                     Trace a T0x10 netId
 *   unnamed                        List unnamed wire groups
 *   nettable [filter]              Per-page net table entries
 *   symbols [page]                 Ports, globals, OPCs with full detail
 *   wire <page> <name-regex>       Search wires by name pattern
 *   wiretrace <page> <x> <y>       Trace wire connectivity via union-find
 *   conflicts                      Wire alias vs net table discrepancies
 *   hierarchy                      Hierarchy stream net names and IDs
 *   streams                        List all OLE container streams
 *   stream <path> [offset] [len]   Hex dump of a specific OLE stream
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
// Page-level commands
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

  for (const page of pages) {
    const matching = page.pins.filter((p) => p.coordNet === upper);
    if (matching.length === 0) continue;

    console.log(`Page: ${page.name}`);
    for (const pin of matching) {
      console.log(`  ${pin.refdes} pin[${pin.pinIdx}] at (${pin.x},${pin.y}) netId=${pin.netId}`);
    }
  }

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

    const groups = new Map<number, Wire[]>();
    for (const w of unnamedWires) {
      if (!groups.has(w.id)) groups.set(w.id, []);
      groups.get(w.id)!.push(w);
    }

    console.log(`Page: ${page.name} (${unnamedWires.length} unnamed wires, ${groups.size} groups)`);
    for (const [wireId, wires] of groups) {
      const coords = wires.map((w) => `(${w.startX},${w.startY})-(${w.endX},${w.endY})`);
      console.log(`  wireId=${wireId}: ${coords.join(", ")}`);

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

function cmdNettable(pages: PageInfo[], filter?: string) {
  const upper = filter?.toUpperCase();

  for (const page of pages) {
    const entries: { name: string; id: number; wireCount: number }[] = [];
    for (const [id, name] of page.netTable) {
      if (upper && !name.includes(upper)) continue;
      const wireCount = page.wires.filter((w) => w.id === id).length;
      entries.push({ name, id, wireCount });
    }

    if (entries.length === 0) continue;

    console.log(`\n=== ${page.name} (${entries.length} entries) ===`);
    for (const e of entries) {
      console.log(`  "${e.name}" -> netId=${e.id} (0x${e.id.toString(16)}) wires=${e.wireCount}`);
    }
  }
}

function cmdSymbols(pages: PageInfo[], pageFilter?: string) {
  for (const page of pages) {
    if (pageFilter && !page.name.includes(pageFilter)) continue;

    const hasContent =
      page.ports.length > 0 || page.globals.length > 0 || page.offPageConnectors.length > 0;
    if (!hasContent) continue;

    console.log(`\n=== ${page.name} ===`);

    if (page.ports.length > 0) {
      console.log(`  Ports (${page.ports.length}):`);
      for (const p of page.ports) {
        console.log(
          `    "${p.name}" at (${p.locX},${p.locY}) dbId=${p.dbId} pairingId=${p.pairingId} bbox=(${p.x1},${p.y1})-(${p.x2},${p.y2})`
        );
      }
    }

    if (page.globals.length > 0) {
      console.log(`  Globals (${page.globals.length}):`);
      for (const g of page.globals) {
        console.log(
          `    "${g.name}" at (${g.locX},${g.locY}) dbId=${g.dbId} pairingId=${g.pairingId} bbox=(${g.x1},${g.y1})-(${g.x2},${g.y2})`
        );
      }
    }

    if (page.offPageConnectors.length > 0) {
      console.log(`  OffPageConnectors (${page.offPageConnectors.length}):`);
      for (const o of page.offPageConnectors) {
        console.log(
          `    "${o.name}" at (${o.locX},${o.locY}) dbId=${o.dbId} pairingId=${o.pairingId} bbox=(${o.x1},${o.y1})-(${o.x2},${o.y2})`
        );
      }
    }
  }
}

function cmdWire(pages: PageInfo[], pageFilter: string, pattern: string) {
  const namePattern = new RegExp(pattern, "i");

  for (const page of pages) {
    if (pageFilter && !page.name.includes(pageFilter)) continue;

    const matches: string[] = [];
    for (const w of page.wires) {
      const aliasNames = w.aliases.map((a) => a.name.toUpperCase());
      const tableName = page.netTable.get(w.id);
      const allNames = [...aliasNames, ...(tableName ? [tableName] : [])];
      if (allNames.some((n) => namePattern.test(n))) {
        matches.push(
          `  segId=${w.segmentId} wireId=${w.id} (${w.startX},${w.startY})-(${w.endX},${w.endY}) aliases=[${aliasNames.join(",")}] table=${tableName || "-"}`
        );
      }
    }

    if (matches.length > 0) {
      console.log(`\n=== ${page.name} === (${matches.length} matches)`);
      for (const m of matches) console.log(m);
    }
  }
}

function cmdWiretrace(pages: PageInfo[], pageFilter: string, targetX: number, targetY: number) {
  for (const page of pages) {
    if (!page.name.includes(pageFilter)) continue;

    // Union-find
    const parent = new Map<string, string>();
    function find(x: string): string {
      if (!parent.has(x)) parent.set(x, x);
      let root = x;
      while (parent.get(root) !== root) root = parent.get(root)!;
      let curr = x;
      while (curr !== root) {
        const next = parent.get(curr)!;
        parent.set(curr, root);
        curr = next;
      }
      return root;
    }
    function union(a: string, b: string) {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    }

    for (const w of page.wires) {
      const s = `${w.startX},${w.startY}`;
      const e = `${w.endX},${w.endY}`;
      find(s);
      find(e);
      union(s, e);
    }

    const targetKey = `${targetX},${targetY}`;
    if (!parent.has(targetKey)) {
      console.log(`\n=== ${page.name} ===`);
      console.log(`  No wire at (${targetX},${targetY})`);
      continue;
    }

    const targetRoot = find(targetKey);
    const groupWires = page.wires.filter((w) => {
      const s = `${w.startX},${w.startY}`;
      const e = `${w.endX},${w.endY}`;
      return find(s) === targetRoot || find(e) === targetRoot;
    });

    console.log(`\n=== ${page.name} === (${page.wires.length} wires)`);
    console.log(`  Target: (${targetX},${targetY}) -> root: ${targetRoot}`);
    console.log(`  Group contains ${groupWires.length} wire segments:`);

    for (const w of groupWires) {
      const aliasNames = w.aliases.map((a) => a.name.toUpperCase());
      const tableName = page.netTable.get(w.id);
      const nameInfo: string[] = [];
      if (aliasNames.length > 0) nameInfo.push(`aliases=[${aliasNames.join(",")}]`);
      if (tableName) nameInfo.push(`table="${tableName}"`);
      console.log(
        `    id=${w.id} (${w.startX},${w.startY})-(${w.endX},${w.endY}) ${nameInfo.join(" ")}`
      );
    }

    const groupCoords = new Set<string>();
    for (const key of parent.keys()) {
      if (find(key) === targetRoot) groupCoords.add(key);
    }
    console.log(`  Group coordinates: ${groupCoords.size}`);

    const names = new Set<string>();
    for (const w of groupWires) {
      for (const a of w.aliases) names.add(a.name.toUpperCase());
      const tn = page.netTable.get(w.id);
      if (tn) names.add(tn);
    }
    console.log(`  Names: ${[...names].join(", ")}`);
  }
}

function cmdConflicts(pages: PageInfo[]) {
  let totalConflicts = 0;
  let totalAliasOnly = 0;
  let totalTableOnly = 0;

  for (const page of pages) {
    const wireIds = new Set<number>();
    const conflicts: string[] = [];
    const aliasOnly: string[] = [];
    const tableOnly: string[] = [];

    for (const w of page.wires) {
      wireIds.add(w.id);
      const aliasName = w.aliases.length > 0 ? w.aliases[0].name.toUpperCase() : undefined;
      const tableName = page.netTable.get(w.id);

      if (aliasName && tableName && aliasName !== tableName) {
        conflicts.push(`  wireId=${w.id}: alias="${aliasName}" table="${tableName}"`);
      } else if (aliasName && !tableName) {
        aliasOnly.push(`  wireId=${w.id}: alias="${aliasName}" (no table entry)`);
      }
    }

    for (const [id, name] of page.netTable) {
      if (!wireIds.has(id)) {
        tableOnly.push(`  wireId=${id}: table="${name}" (no wire found)`);
      }
    }

    totalConflicts += conflicts.length;
    totalAliasOnly += aliasOnly.length;
    totalTableOnly += tableOnly.length;

    if (conflicts.length === 0 && aliasOnly.length === 0 && tableOnly.length === 0) continue;

    console.log(`\n=== ${page.name} ===`);
    console.log(`Net table: ${page.netTable.size} entries, Wires: ${wireIds.size}`);
    if (conflicts.length > 0) {
      console.log(`\nConflicts (alias != table):`);
      for (const c of conflicts) console.log(c);
    }
    if (aliasOnly.length > 0 && aliasOnly.length <= 20) {
      console.log(`\nAlias-only (no table entry):`);
      for (const a of aliasOnly) console.log(a);
    } else if (aliasOnly.length > 20) {
      console.log(`\nAlias-only: ${aliasOnly.length} wires (too many to show)`);
    }
    if (tableOnly.length > 0) {
      console.log(`\nTable-only (no wire found):`);
      for (const t of tableOnly) console.log(t);
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Conflicts: ${totalConflicts}`);
  console.log(`Alias-only: ${totalAliasOnly}`);
  console.log(`Table-only: ${totalTableOnly}`);
}

// ---------------------------------------------------------------------------
// OLE-level commands (no page parsing needed)
// ---------------------------------------------------------------------------

function cmdStreams(dsnPath: string) {
  const ole = new OleReader(dsnPath);
  for (const e of ole.listAllEntries()) {
    const type = e.entry.type === 2 ? "STREAM" : "DIR   ";
    const size = e.entry.type === 2 ? ` (${e.entry.size} bytes)` : "";
    console.log(`${type} ${e.path}${size}`);
  }
}

function cmdStream(dsnPath: string, streamPath: string, offset: number, length: number) {
  const ole = new OleReader(dsnPath);
  const buf = ole.readStreamByPath(streamPath);
  console.log(`Stream: ${streamPath} (${buf.length} bytes)\n`);

  const end = Math.min(offset + length, buf.length);
  const slice = buf.subarray(offset, end);

  for (let i = 0; i < slice.length; i += 16) {
    const hex: string[] = [];
    const ascii: string[] = [];
    for (let j = 0; j < 16 && i + j < slice.length; j++) {
      const b = slice[i + j];
      hex.push(b.toString(16).padStart(2, "0"));
      ascii.push(b >= 32 && b < 127 ? String.fromCharCode(b) : ".");
    }
    console.log(
      `${(offset + i).toString(16).padStart(6, "0")}  ${hex.join(" ").padEnd(48)}  ${ascii.join("")}`
    );
  }

  console.log("\n--- Strings ---");
  let str = "";
  let strStart = offset;
  for (let i = offset; i < end; i++) {
    const b = buf[i];
    if (b >= 32 && b < 127) {
      if (str === "") strStart = i;
      str += String.fromCharCode(b);
    } else {
      if (str.length >= 3) console.log(`  @${strStart.toString(16)}: "${str}"`);
      str = "";
    }
  }
  if (str.length >= 3) console.log(`  @${strStart.toString(16)}: "${str}"`);
}

function cmdHierarchy(dsnPath: string) {
  const ole = new OleReader(dsnPath);
  const entries = ole.listAllEntries();
  const hierEntry = entries.find(
    (e) => /^Views\/.*\/Hierarchy\/Hierarchy$/.test(e.path) && e.entry.type === 2
  );
  if (!hierEntry) {
    console.error("No Hierarchy stream found");
    return;
  }

  const buf = ole.readStreamByPath(hierEntry.path);
  const r = new BinaryReader(buf);

  // Header
  r.skip(1); // type byte (0x42)
  r.skip(4); // struct length
  r.skip(4); // zeros

  // View name
  const viewNameLen = r.readUint16();
  const viewNameBytes = Buffer.alloc(viewNameLen);
  for (let i = 0; i < viewNameLen; i++) viewNameBytes[i] = r.readUint8();
  r.skip(1); // null terminator
  const viewName = viewNameBytes.toString("ascii");
  console.log(`View: "${viewName}"`);

  // Scan forward to find the 0x43 marker, then back up for the count
  while (r.tell() < buf.length - 2 && r.readUint8() !== 0x43) {
    // scan forward
  }
  r.seek(r.tell() - 3);
  const netCount = r.readUint16();
  console.log(`Net count: ${netCount}\n`);

  console.log("Idx  HierID      HierID(hex)  Name");
  console.log("---  ----------  -----------  ----");
  for (let i = 0; i < netCount; i++) {
    r.skip(9); // 0x43 marker + 8 bytes
    r.skip(4); // second 0x43 marker + 3 bytes
    r.skip(4); // some ID
    r.skip(3); // zeros
    const hierNodeId = r.readUint32();
    const nameLen = r.readUint16();
    const nameBytes = Buffer.alloc(nameLen);
    for (let j = 0; j < nameLen; j++) nameBytes[j] = r.readUint8();
    r.skip(1); // null
    const name = nameBytes.toString("ascii");
    console.log(
      `${String(i).padStart(3)}  ${String(hierNodeId).padStart(10)}  0x${hierNodeId.toString(16).padStart(8, "0")}  ${name}`
    );
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

if (args.length < 2) {
  console.log("Usage: node --import tsx scripts/dsn-inspect.ts <dsn-file> <command> [args...]\n");
  console.log("Page-level commands:");
  console.log("  summary                        Wire/pin statistics");
  console.log("  component <REFDES>             Pin details for a component");
  console.log("  net <NET_NAME>                 All pins on a net");
  console.log("  netid <ID>                     Trace a T0x10 netId");
  console.log("  unnamed                        List unnamed wire groups");
  console.log("  nettable [filter]              Per-page net table entries");
  console.log("  symbols [page]                 Ports, globals, OPCs with full detail");
  console.log("  wire <page> <name-regex>       Search wires by name pattern");
  console.log("  wiretrace <page> <x> <y>       Trace wire connectivity via union-find");
  console.log("  conflicts                      Wire alias vs net table discrepancies");
  console.log("\nOLE-level commands:");
  console.log("  hierarchy                      Hierarchy stream net names and IDs");
  console.log("  streams                        List all OLE container streams");
  console.log("  stream <path> [offset] [len]   Hex dump of a specific OLE stream");
  process.exit(1);
}

const [dsnPath, command, ...rest] = args;

// OLE-level commands (skip page parsing)
if (command === "streams") {
  cmdStreams(dsnPath);
  process.exit(0);
} else if (command === "stream") {
  if (!rest[0]) {
    console.error("Missing stream path. Use 'streams' to list available streams.");
    process.exit(1);
  }
  cmdStream(dsnPath, rest[0], parseInt(rest[1] || "0"), parseInt(rest[2] || "500"));
  process.exit(0);
} else if (command === "hierarchy") {
  cmdHierarchy(dsnPath);
  process.exit(0);
}

// Page-level commands
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
  case "nettable":
    cmdNettable(pages, rest[0]);
    break;
  case "symbols":
    cmdSymbols(pages, rest[0]);
    break;
  case "wire":
    if (!rest[1]) {
      console.error("Usage: wire <page-substring> <name-regex>");
      process.exit(1);
    }
    cmdWire(pages, rest[0], rest[1]);
    break;
  case "wiretrace":
    if (!rest[0] || isNaN(parseInt(rest[1])) || isNaN(parseInt(rest[2]))) {
      console.error("Usage: wiretrace <page-substring> <x> <y>");
      process.exit(1);
    }
    cmdWiretrace(pages, rest[0], parseInt(rest[1]), parseInt(rest[2]));
    break;
  case "conflicts":
    cmdConflicts(pages);
    break;
  default:
    console.error(`Unknown command: ${command}`);
    process.exit(1);
}
