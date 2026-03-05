/**
 * Dump OPC SymbolDisplayProp entries with strLst resolution.
 * Usage: npx tsx scripts/dsn-dump-opc-sdp.ts <dsn-file> [pairingId]
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
import { parseOffPageConnector } from "../src/parsers/cadence/dsn/structures.js";
import { parseLibraryStrLst } from "../src/parsers/cadence/dsn/dsn-parser.js";

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
const filterPairingId = process.argv[3] ? parseInt(process.argv[3]) : undefined;

const ole = new OleReader(dsnPath);
const entries = ole.listAllEntries();

// Parse Library for strLst
let strLst: string[] = [];
try {
  const libBuf = ole.readStreamByPath("Library");
  // Use internal parser
  const libReader = new BinaryReader(libBuf);
  libReader.skip(32); // intro
  libReader.skip(2);
  libReader.skip(2); // version
  libReader.skip(4);
  libReader.skip(4); // dates
  libReader.skip(4); // zeros
  const textFontLen = libReader.readUint16();
  if (textFontLen > 0) libReader.skip((textFontLen - 1) * 60);
  const someLen = libReader.readUint16();
  libReader.skip(someLen * 2);
  libReader.skip(8);
  for (let i = 0; i < 8; i++) libReader.readStringLenZeroTerm();
  libReader.skip(PAGE_SETTINGS_SIZE);
  const strLstLen = libReader.readUint16();
  for (let i = 0; i < strLstLen; i++) strLst.push(libReader.readStringLenZeroTerm());
  console.log(`strLst: ${strLst.length} entries`);
} catch (e) {
  console.log("Failed to parse Library strLst:", e);
}

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

  let found = false;
  for (let i = 0; i < lo; i++) {
    const opc = parseOffPageConnector(r);
    r.skip(5);

    if (filterPairingId !== undefined && opc.pairingId !== filterPairingId) continue;
    if (!found) {
      console.log(`\n=== Page: ${pageName} ===`);
      found = true;
    }

    console.log(`  OPC[${i}] "${opc.name}" pId=${opc.pairingId} dbId=${opc.dbId}`);
    console.log(`    symbolDisplayProps (${opc.symbolDisplayProps.length}):`);
    for (const sdp of opc.symbolDisplayProps) {
      const propName = strLst[sdp.nameIdx] || `idx:${sdp.nameIdx}`;
      console.log(
        `      nameIdx=${sdp.nameIdx} -> "${propName}" at (${sdp.x},${sdp.y}) font=${sdp.textFontIdx} rot=${sdp.rotation}`
      );
    }
  }
}
