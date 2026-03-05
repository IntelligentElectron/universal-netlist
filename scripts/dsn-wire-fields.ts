/**
 * Dump raw wire fields including the unknown 4 bytes before the wire ID.
 * Used to reverse-engineer the Cadence auto-generated net naming algorithm.
 *
 * Usage:
 *   npx tsx scripts/dsn-wire-fields.ts <dsn-file> <page-substring> <wire-id-or-name-regex>
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
import { parseAlias, parseSymbolDisplayProp } from "../src/parsers/cadence/dsn/structures.js";

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
const filter = process.argv[4] || "";

if (!dsnPath) {
  console.error("Usage: npx tsx scripts/dsn-wire-fields.ts <dsn-file> [page] [wire-id-or-regex]");
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
  const netTable = new Map<number, string>();
  for (let i = 0; i < lnt; i++) {
    const n = r.readStringLenZeroTerm().toUpperCase();
    const id = r.readUint32();
    netTable.set(id, n);
  }

  const lw = r.readUint16();
  console.log(`\n=== ${pageName} === (${lw} wires, ${netTable.size} net table entries)`);

  for (let i = 0; i < lw; i++) {
    // Parse wire manually to capture the unknown field
    const wfd = new FutureDataList(r);
    autoReadPrefixes(r, wfd);
    readPreamble(r);
    wfd.checkpoint();

    const unknown4 = r.readUint32(); // THE MYSTERY FIELD
    const wireId = r.readUint32();
    const color = r.readUint32();
    const startX = r.readInt32();
    const startY = r.readInt32();
    const endX = r.readInt32();
    const endY = r.readInt32();
    r.skip(1);

    const lenAliases = r.readUint16();
    const aliasNames: string[] = [];
    for (let a = 0; a < lenAliases; a++) {
      const alias = parseAlias(r);
      aliasNames.push(alias.name.toUpperCase());
    }

    const lenSDP = r.readUint16();
    for (let s = 0; s < lenSDP; s++) parseSymbolDisplayProp(r);

    r.skip(4); // lineWidth
    r.skip(4); // lineStyle

    wfd.checkpoint();
    wfd.sanitizeCheckpoints();

    const tableName = netTable.get(wireId);
    const allNames = [...aliasNames, ...(tableName ? [tableName] : [])];
    const nameStr = allNames.join(",") || "(unnamed)";

    // Filter
    const matchesId = filter && String(wireId) === filter;
    const matchesName = filter && allNames.some((n) => new RegExp(filter, "i").test(n));
    const matchesUnknown = filter && String(unknown4) === filter;
    if (filter && !matchesId && !matchesName && !matchesUnknown) continue;

    console.log(
      `  unknown4=${unknown4} wireId=${wireId} (${startX},${startY})-(${endX},${endY}) names=[${nameStr}] color=${color}`
    );
  }
}
