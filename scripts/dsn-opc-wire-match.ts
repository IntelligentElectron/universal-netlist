/**
 * Check which OPC connection strategy works best by comparing OPC coordinates
 * to wire endpoints.
 * Usage: npx tsx scripts/dsn-opc-wire-match.ts <dsn-file>
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
import { parseWire, parseOffPageConnector } from "../src/parsers/cadence/dsn/structures.js";

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

const dsnPath = process.argv[2]!;
const ole = new OleReader(dsnPath);
const entries = ole.listAllEntries();
const pageEntries = entries.filter((e) => /^Views\/.*\/Pages\//.test(e.path) && e.entry.type === 2);

for (const pe of pageEntries) {
  const buf = ole.readStreamByPath(pe.path);
  const r = new BinaryReader(buf);
  const fd = new FutureDataList(r);
  autoReadPrefixes(r, fd, StructureType.Page);
  readPreamble(r);
  fd.checkpoint();

  const pageName = r.readStringLenZeroTerm();
  r.readStringLenZeroTerm();
  r.skip(PAGE_SETTINGS_SIZE);

  const lt = r.readUint16();
  for (let i = 0; i < lt; i++) skipStructure(r);
  const l34 = r.readUint16();
  for (let i = 0; i < l34; i++) skipT0x34(r);
  const l35 = r.readUint16();
  for (let i = 0; i < l35; i++) skipT0x35(r);

  const netTable = new Map<number, string>();
  const lnt = r.readUint16();
  for (let i = 0; i < lnt; i++) {
    const name = r.readStringLenZeroTerm();
    const id = r.readUint32();
    netTable.set(id, name);
  }

  const lw = r.readUint16();
  const wires = [];
  for (let i = 0; i < lw; i++) wires.push(parseWire(r));

  // Build set of wire endpoints
  const wireCoords = new Set<string>();
  for (const w of wires) {
    wireCoords.add(`${w.startX},${w.startY}`);
    wireCoords.add(`${w.endX},${w.endY}`);
  }

  const lpi = r.readUint16();
  for (let i = 0; i < lpi; i++) skipStructure(r);
  const lp = r.readUint16();
  for (let i = 0; i < lp; i++) {
    skipStructure(r);
    r.skip(5);
  }
  const lg = r.readUint16();
  for (let i = 0; i < lg; i++) {
    skipStructure(r);
    r.skip(5);
  }

  const lo = r.readUint16();
  if (lo === 0) continue;

  let matchLoc = 0,
    matchRight = 0,
    matchLeft = 0,
    matchNone = 0;
  console.log(`\n=== Page: ${pageName} (${lo} OPCs, ${wires.length} wires) ===`);

  for (let i = 0; i < lo; i++) {
    const opc = parseOffPageConnector(r);
    r.skip(5);

    const minX = Math.min(opc.x1, opc.x2);
    const maxX = Math.max(opc.x1, opc.x2);
    const midY = Math.round((Math.min(opc.y1, opc.y2) + Math.max(opc.y1, opc.y2)) / 2);

    const atLoc = wireCoords.has(`${opc.locX},${opc.locY}`);
    // Try connection at right edge midpoint
    const atRightMid = wireCoords.has(`${maxX},${midY}`);
    // Try connection at left edge midpoint
    const atLeftMid = wireCoords.has(`${minX},${midY}`);

    const match = atLoc ? "LOC" : atRightMid ? "RIGHT" : atLeftMid ? "LEFT" : "NONE";
    if (atLoc) matchLoc++;
    else if (atRightMid) matchRight++;
    else if (atLeftMid) matchLeft++;
    else matchNone++;

    // Find which wire endpoint is closest to the OPC
    let closestDist = Infinity;
    let closestCoord = "";
    let closestWireNet = "";
    for (const w of wires) {
      for (const [wx, wy] of [
        [w.startX, w.startY],
        [w.endX, w.endY],
      ]) {
        const d = Math.abs(wx - opc.locX) + Math.abs(wy - opc.locY);
        if (d < closestDist) {
          closestDist = d;
          closestCoord = `${wx},${wy}`;
          closestWireNet = netTable.get(w.id) || `wireId:${w.id}`;
        }
      }
    }

    if (match === "NONE" || true) {
      console.log(
        `  OPC[${i}] "${opc.name}" pId=${opc.pairingId} loc=(${opc.locX},${opc.locY}) bbox=(${opc.x1},${opc.y1})-(${opc.x2},${opc.y2}) match=${match} closest=${closestCoord}(d=${closestDist},net=${closestWireNet})`
      );
    }
  }

  console.log(`  Summary: LOC=${matchLoc} RIGHT=${matchRight} LEFT=${matchLeft} NONE=${matchNone}`);
}
