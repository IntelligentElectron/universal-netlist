/**
 * Dump OPC raw bytes around the GraphicInst fields to find where net name is stored.
 * Usage: npx tsx scripts/dsn-dump-opc-props.ts <dsn-file>
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
if (!dsnPath) {
  console.error("Usage: npx tsx scripts/dsn-dump-opc-props.ts <dsn-file>");
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

  // Net table - dump with names for reference
  const netTable = new Map<number, string>();
  const lnt = r.readUint16();
  for (let i = 0; i < lnt; i++) {
    const name = r.readStringLenZeroTerm();
    const id = r.readUint32();
    netTable.set(id, name);
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
  console.log(`Net table entries: ${netTable.size}`);

  for (let i = 0; i < lo; i++) {
    const startPos = r.tell();

    // Dump raw bytes from start of OPC to help find net name location
    const rawPreview = buf.subarray(startPos, Math.min(startPos + 200, buf.length));

    // Find all printable strings in the raw bytes
    const strings: Array<{ offset: number; str: string }> = [];
    let str = "";
    let strStart = 0;
    for (let j = 0; j < rawPreview.length; j++) {
      const b = rawPreview[j];
      if (b >= 32 && b < 127) {
        if (str === "") strStart = j;
        str += String.fromCharCode(b);
      } else {
        if (str.length >= 3) strings.push({ offset: strStart, str });
        str = "";
      }
    }
    if (str.length >= 3) strings.push({ offset: strStart, str });

    // Skip the structure properly
    skipStructure(r);
    r.skip(5);
    const endPos = r.tell();

    console.log(`  OPC[${i}] @${startPos}-${endPos} (${endPos - startPos} bytes)`);
    console.log(`    strings: ${strings.map((s) => `@${s.offset}:"${s.str}"`).join(", ")}`);
  }
}
