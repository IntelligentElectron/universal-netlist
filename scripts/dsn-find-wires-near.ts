/**
 * Find wires near a coordinate range on a specific page.
 * Usage: npx tsx scripts/dsn-find-wires-near.ts <dsn-file> <pageIdx> <x1> <y1> <x2> <y2>
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
import { parseWire } from "../src/parsers/cadence/dsn/structures.js";

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
const pageIdx = parseInt(process.argv[3] || "1");
const rx1 = parseInt(process.argv[4] || "1800");
const ry1 = parseInt(process.argv[5] || "940");
const rx2 = parseInt(process.argv[6] || "1900");
const ry2 = parseInt(process.argv[7] || "1020");

const ole = new OleReader(dsnPath);
const entries = ole.listAllEntries();
const pageEntries = entries.filter((e) => /^Views\/.*\/Pages\//.test(e.path) && e.entry.type === 2);

const buf = ole.readStreamByPath(pageEntries[pageIdx].path);
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
console.log(`Page[${pageIdx}]: ${pageName} (${lw} wires)`);
console.log(`Search area: (${rx1},${ry1})-(${rx2},${ry2})\n`);

for (let i = 0; i < lw; i++) {
  const w = parseWire(r);
  const nearS = w.startX >= rx1 && w.startX <= rx2 && w.startY >= ry1 && w.startY <= ry2;
  const nearE = w.endX >= rx1 && w.endX <= rx2 && w.endY >= ry1 && w.endY <= ry2;
  if (nearS || nearE) {
    const net = netTable.get(w.id) || `wireId:${w.id}`;
    console.log(
      `  Wire[${i}] segId=${w.segmentId} wireId=${w.id} (${w.startX},${w.startY})-(${w.endX},${w.endY}) net=${net} aliases=[${w.aliases.map((a) => a.name).join(",")}]`
    );
  }
}
