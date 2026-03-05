/**
 * Dump OPC preamble data bytes and the 8 unknown bytes.
 * Usage: npx tsx scripts/dsn-dump-opc-preamble.ts <dsn-file>
 */
import { OleReader } from "../src/parsers/ole-reader/ole-reader.js";
import { BinaryReader } from "../src/parsers/cadence/dsn/binary-reader.js";
import { StructureType } from "../src/parsers/cadence/dsn/structure-types.js";
import {
  FutureDataList,
  autoReadPrefixes,
  skipStructure,
} from "../src/parsers/cadence/dsn/generic-parser.js";

const PAGE_SETTINGS_SIZE = 156;
const PREAMBLE_MAGIC = [0xff, 0xe4, 0x5c, 0x39];

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
if (!dsnPath) {
  console.error("Usage: npx tsx scripts/dsn-dump-opc-preamble.ts <dsn-file>");
  process.exit(1);
}

const ole = new OleReader(dsnPath);
const entries = ole.listAllEntries();
const pageEntries = entries.filter((e) => /^Views\/.*\/Pages\//.test(e.path) && e.entry.type === 2);

for (const pe of pageEntries) {
  const buf = ole.readStreamByPath(pe.path);
  const r = new BinaryReader(buf);
  const fd = new FutureDataList(r);
  autoReadPrefixes(r, fd, StructureType.Page);

  // Read preamble manually
  const pagePrePos = r.tell();
  let hasPreamble = true;
  for (const m of PREAMBLE_MAGIC) {
    if (r.readUint8() !== m) {
      hasPreamble = false;
      break;
    }
  }
  if (hasPreamble) {
    const dataLen = r.readUint32();
    r.skip(dataLen);
  } else {
    r.seek(pagePrePos);
  }
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

  console.log(`\n=== Page: ${pageName} (${lo} OPCs) ===`);

  for (let i = 0; i < lo; i++) {
    const startPos = r.tell();

    // Read prefixes
    const opcFd = new FutureDataList(r);
    autoReadPrefixes(r, opcFd, StructureType.OffPageConnector);

    // Read preamble manually to capture data
    const prePos = r.tell();
    let preambleData: Buffer | null = null;
    let preMatch = true;
    for (const m of PREAMBLE_MAGIC) {
      if (r.readUint8() !== m) {
        preMatch = false;
        break;
      }
    }
    if (preMatch) {
      const dataLen = r.readUint32();
      if (dataLen > 0 && dataLen < 1000) {
        preambleData = Buffer.alloc(dataLen);
        for (let j = 0; j < dataLen; j++) preambleData[j] = r.readUint8();
      } else if (dataLen > 0) {
        r.skip(dataLen);
      }
    } else {
      r.seek(prePos);
    }
    opcFd.checkpoint();

    // Read 8 unknown bytes
    const unknown8 = Buffer.alloc(8);
    for (let j = 0; j < 8; j++) unknown8[j] = r.readUint8();

    const name = r.readStringLenZeroTerm();
    const dbId = r.readUint32();
    const locY = r.readInt16();
    const locX = r.readInt16();
    const y2 = r.readInt16();
    const x2 = r.readInt16();
    const x1 = r.readInt16();
    const y1 = r.readInt16();

    // Go back and skip the whole thing properly
    r.seek(startPos);
    skipStructure(r);
    r.skip(5);

    const u8hex = [...unknown8].map((b) => b.toString(16).padStart(2, "0")).join(" ");
    const u8_u32_0 = unknown8.readUInt32LE(0);
    const u8_u32_1 = unknown8.readUInt32LE(4);

    console.log(
      `  OPC[${i}] "${name}" dbId=${dbId} loc=(${locX},${locY}) bbox=(${x1},${y1})-(${x2},${y2}) connPt=((${locX}+${x2})/2=${Math.round((locX + x2) / 2)}, ${locY})`
    );
    console.log(`    unknown8: [${u8hex}] as u32: [${u8_u32_0}, ${u8_u32_1}]`);
    if (preambleData) {
      // Extract strings from preamble data
      const strings: string[] = [];
      let str = "";
      for (let j = 0; j < preambleData.length; j++) {
        const b = preambleData[j];
        if (b >= 32 && b < 127) str += String.fromCharCode(b);
        else {
          if (str.length >= 2) strings.push(str);
          str = "";
        }
      }
      if (str.length >= 2) strings.push(str);
      const hex = [...preambleData].map((b) => b.toString(16).padStart(2, "0")).join(" ");
      console.log(`    preamble (${preambleData.length}b): ${hex}`);
      if (strings.length > 0) console.log(`    preamble strings: ${strings.join(", ")}`);
    }
  }
}
