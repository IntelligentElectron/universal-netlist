/**
 * Check if OPC labels can be extracted via strLst + propPairs.
 */
import { parseDsnFile } from "../src/parsers/cadence/dsn/dsn-parser.js";
import { OleReader } from "../src/parsers/ole-reader/ole-reader.js";
import { BinaryReader } from "../src/parsers/cadence/dsn/binary-reader.js";
import { StructureType } from "../src/parsers/cadence/dsn/structure-types.js";
import {
  FutureDataList,
  autoReadPrefixes,
  readPreamble,
  skipStructure,
} from "../src/parsers/cadence/dsn/generic-parser.js";
import { parseOffPageConnector } from "../src/parsers/cadence/dsn/structures.js";

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

// Parse strLst manually using uint32 count
const buf = ole.readStreamByPath("Library");
const r2 = new BinaryReader(buf);
r2.skip(32);
r2.skip(4);
r2.skip(8);
r2.skip(4);
const tf = r2.readUint16();
if (tf > 0) r2.skip((tf - 1) * 60);
const sl = r2.readUint16();
r2.skip(sl * 2);
r2.skip(8);
for (let i = 0; i < 8; i++) r2.readStringLenZeroTerm();
r2.skip(PAGE_SETTINGS_SIZE);

// Try uint32 count
const strLst: string[] = [];
const countOff = r2.tell();
let strLen: number;
try {
  strLen = r2.readUint16();
  for (let i = 0; i < strLen; i++) strLst.push(r2.readStringLenZeroTerm());
} catch {
  strLst.length = 0;
  r2.seek(countOff);
  strLen = r2.readUint32();
  for (let i = 0; i < strLen; i++) strLst.push(r2.readStringLenZeroTerm());
}
console.log(`strLst: ${strLst.length} entries`);
console.log(`strLst[31]: "${strLst[31]}"`);

// Check first 50 entries
for (let i = 0; i < Math.min(50, strLst.length); i++) {
  if (strLst[i].toUpperCase().includes("VOL") || strLst[i].toUpperCase().includes("GPIO")) {
    console.log(`  strLst[${i}]: "${strLst[i]}"`);
  }
}

// Parse page 2 and check OPC propPairs
const pageEntries = entries.filter((e) => /^Views\/.*\/Pages\//.test(e.path) && e.entry.type === 2);
for (const pe of pageEntries) {
  const pbuf = ole.readStreamByPath(pe.path);
  const r = new BinaryReader(pbuf);
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
  const lnt = r.readUint16();
  for (let i = 0; i < lnt; i++) {
    r.readStringLenZeroTerm();
    r.readUint32();
  }
  const lw = r.readUint16();
  for (let i = 0; i < lw; i++) skipStructure(r);
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

  for (let i = 0; i < lo; i++) {
    const opc = parseOffPageConnector(r);
    r.skip(5);
    if (opc.pairingId !== 2842) continue;

    console.log(`\nPage: ${pageName}, OPC[${i}] pId=${opc.pairingId}`);
    console.log(`  propPairs size: ${opc.propPairs.size}`);
    for (const [k, v] of opc.propPairs) {
      console.log(
        `  propPair: nameIdx=${k} -> valueIdx=${v} (name="${strLst[k]}", value="${strLst[v]}")`
      );
    }
    console.log(`  symbolDisplayProps:`);
    for (const sdp of opc.symbolDisplayProps) {
      const valueIdx = opc.propPairs.get(sdp.nameIdx);
      console.log(
        `    nameIdx=${sdp.nameIdx} "${strLst[sdp.nameIdx]}" -> valueIdx=${valueIdx} "${valueIdx !== undefined ? strLst[valueIdx] : "N/A"}"`
      );
    }
  }
}
