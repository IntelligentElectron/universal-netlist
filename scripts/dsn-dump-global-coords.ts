/**
 * Dump ALL coordinate fields from globals on a DSN page.
 * Used to debug the +10 X offset between globals and wire endpoints.
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
import { parseSymbolDisplayProp } from "../src/parsers/cadence/dsn/structures.js";

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
const pageFilter = process.argv[3] || "";

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
  if (pageFilter && !pageName.includes(pageFilter)) continue;

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

  // Ports
  const lp = r.readUint16();
  for (let i = 0; i < lp; i++) skipStructure(r); // skip ports for now

  console.log(`\n=== ${pageName} - Globals ===`);
  const lg = r.readUint16();
  for (let i = 0; i < lg; i++) {
    // Parse manually to read all coordinate fields
    const gfd = new FutureDataList(r);
    autoReadPrefixes(r, gfd, StructureType.Global);
    readPreamble(r);
    gfd.checkpoint();

    r.skip(8); // unknown
    const name = r.readStringLenZeroTerm();
    const dbId = r.readUint32();

    const f1 = r.readInt16(); // "locY"
    const f2 = r.readInt16(); // "locX"
    const f3 = r.readInt16(); // "y2"
    const f4 = r.readInt16(); // "x2"
    const f5 = r.readInt16(); // "x1"
    const f6 = r.readInt16(); // "y1"
    r.skip(1); // color
    r.skip(1);
    r.skip(1);
    r.skip(1);

    const lsdp = r.readUint16();
    for (let j = 0; j < lsdp; j++) parseSymbolDisplayProp(r);

    const unknownFlag = r.readUint8();
    if (unknownFlag === 0x02) skipStructure(r);

    gfd.checkpoint();

    r.skip(5); // post-global skip

    console.log(
      `  "${name}" f1=${f1} f2=${f2} f3=${f3} f4=${f4} f5=${f5} f6=${f6}  current=(${f2},${f1}) alt=(${f5},${f6})`
    );
  }
}
