/**
 * Dump ports, globals, and off-page connectors for all pages in a DSN file.
 * Usage: npx tsx scripts/dsn-dump-symbols.ts <dsn-file> [page-filter]
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
  parsePort,
  parseOffPageConnector,
  parseGlobal,
} from "../src/parsers/cadence/dsn/structures.js";

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

if (!dsnPath) {
  console.error("Usage: npx tsx scripts/dsn-dump-symbols.ts <dsn-file> [page-filter]");
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

  console.log(`\n=== ${pageName} ===`);

  const lp = r.readUint16();
  if (lp > 0) console.log(`  Ports (${lp}):`);
  for (let i = 0; i < lp; i++) {
    const p = parsePort(r);
    r.skip(5);
    console.log(`    "${p.name}" at (${p.locX},${p.locY}) dbId=${p.dbId}`);
  }

  const lg = r.readUint16();
  if (lg > 0) console.log(`  Globals (${lg}):`);
  for (let i = 0; i < lg; i++) {
    const g = parseGlobal(r);
    r.skip(5);
    console.log(`    "${g.name}" at (${g.locX},${g.locY}) dbId=${g.dbId}`);
  }

  const lo = r.readUint16();
  if (lo > 0) console.log(`  OffPageConnectors (${lo}):`);
  for (let i = 0; i < lo; i++) {
    const o = parseOffPageConnector(r);
    r.skip(5);
    console.log(`    "${o.name}" at (${o.locX},${o.locY}) dbId=${o.dbId}`);
  }
}
