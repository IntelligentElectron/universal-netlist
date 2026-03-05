/**
 * Dump the net table entries for a specific page or search for a net name.
 * Usage: npx tsx scripts/dsn-nettable-dump.ts <dsn-file> [search]
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
  r.skip(4 + 4 + 4 + 4);
}
function skipT0x35(r: BinaryReader) {
  r.skip(9);
  r.skip(4);
  r.readStringLenZeroTerm();
  r.skip(4 + 4 + 4 + 4);
  const l = r.readUint16();
  r.skip(l * 4);
}

const dsnPath = process.argv[2]!;
const search = (process.argv[3] || "").toUpperCase();

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

  const lnt = r.readUint16();
  const netTable: { name: string; netId: number }[] = [];
  for (let i = 0; i < lnt; i++) {
    const name = r.readStringLenZeroTerm().toUpperCase();
    const netId = r.readUint32();
    netTable.push({ name, netId });
  }

  // Find entries matching search or print all
  const matches = search ? netTable.filter((e) => e.name.includes(search)) : netTable;

  if (matches.length > 0) {
    console.log(`\nPage: "${pageName}" (${lnt} entries)`);
    for (const m of matches) {
      console.log(`  "${m.name}" -> netId=${m.netId} (0x${m.netId.toString(16)})`);
    }
  }
}
