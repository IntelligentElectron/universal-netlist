/**
 * Search for wires matching a name pattern on a specific page (or all pages).
 * Shows all aliases (not just the first), net table entries, and coordinates.
 * Useful for finding wires with multiple aliases or verifying name resolution.
 *
 * Usage:
 *   npx tsx scripts/dsn-find-wire.ts <dsn-file> <page-substring> <name-regex>
 *
 * The page-substring filters pages (empty string matches all). The name-regex
 * is matched against all aliases and the net table entry.
 *
 * Examples:
 *   npx tsx scripts/dsn-find-wire.ts test/fixtures/cadence/BeagleBoard-xM/SCH/BeagleBoard-xM_ORCAD.DSN P10 USBDM
 *   npx tsx scripts/dsn-find-wire.ts test/fixtures/cadence/BeagleBone-Black/ALLEGRO/BEAGLEBONEBLK_C3.DSN "" OSC
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

const dsnPath = process.argv[2];
const pageFilter = process.argv[3] ?? "";
const pattern = process.argv[4];

if (!dsnPath || !pattern) {
  console.error("Usage: npx tsx scripts/dsn-find-wire.ts <dsn-file> <page-substring> <name-regex>");
  console.error(
    "\nExample: npx tsx scripts/dsn-find-wire.ts test/fixtures/cadence/BeagleBoard-xM/SCH/BeagleBoard-xM_ORCAD.DSN P10 USBDM"
  );
  process.exit(1);
}

const namePattern = new RegExp(pattern, "i");

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
  const matches: string[] = [];
  for (let i = 0; i < lw; i++) {
    const w = parseWire(r);
    const aliasNames = w.aliases.map((a) => a.name.toUpperCase());
    const tableName = netTable.get(w.id);
    const allNames = [...aliasNames, ...(tableName ? [tableName] : [])];
    if (allNames.some((n) => namePattern.test(n))) {
      matches.push(
        `  id=${w.id} (${w.startX},${w.startY})-(${w.endX},${w.endY}) aliases=[${aliasNames.join(",")}] table=${tableName || "-"}`
      );
    }
  }

  if (matches.length > 0) {
    console.log(`\n=== ${pageName} === (${matches.length} matches)`);
    for (const m of matches) console.log(m);
  }
}
