/**
 * Compare wire aliases against net table entries for all pages in a DSN file.
 * Reports conflicts (alias != table), alias-only wires (no table entry), and
 * table-only entries (no wire found). Useful for debugging net name resolution.
 *
 * Usage:
 *   npx tsx scripts/dsn-check-ports.ts <dsn-file>
 *
 * Example:
 *   npx tsx scripts/dsn-check-ports.ts test/fixtures/cadence/BeagleBone-Black/ALLEGRO/BEAGLEBONEBLK_C3.DSN
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
if (!dsnPath) {
  console.error("Usage: npx tsx scripts/dsn-check-ports.ts <dsn-file>");
  process.exit(1);
}

const ole = new OleReader(dsnPath);
const entries = ole.listAllEntries();
const pageEntries = entries.filter((e) => /^Views\/.*\/Pages\//.test(e.path) && e.entry.type === 2);

let totalConflicts = 0;
let totalAliasOnly = 0;
let totalTableOnly = 0;

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
  const netTable = new Map<number, string>();
  for (let i = 0; i < lnt; i++) {
    const n = r.readStringLenZeroTerm().toUpperCase();
    const id = r.readUint32();
    netTable.set(id, n);
  }

  const lw = r.readUint16();
  const wireIds = new Set<number>();
  const aliasOnly: string[] = [];
  const tableOnly: string[] = [];
  const conflicts: string[] = [];

  for (let i = 0; i < lw; i++) {
    const w = parseWire(r);
    wireIds.add(w.id);
    const aliasName = w.aliases.length > 0 ? w.aliases[0].name.toUpperCase() : undefined;
    const tableName = netTable.get(w.id);

    if (aliasName && tableName && aliasName !== tableName) {
      conflicts.push(`  wireId=${w.id}: alias="${aliasName}" table="${tableName}"`);
    } else if (aliasName && !tableName) {
      aliasOnly.push(`  wireId=${w.id}: alias="${aliasName}" (no table entry)`);
    }
  }

  for (const [id, name] of netTable) {
    if (!wireIds.has(id)) {
      tableOnly.push(`  wireId=${id}: table="${name}" (no wire found)`);
    }
  }

  totalConflicts += conflicts.length;
  totalAliasOnly += aliasOnly.length;
  totalTableOnly += tableOnly.length;

  if (conflicts.length === 0 && aliasOnly.length === 0 && tableOnly.length === 0) continue;

  console.log(`\n=== ${pageName} ===`);
  console.log(`Net table: ${netTable.size} entries, Wires: ${wireIds.size}`);
  if (conflicts.length > 0) {
    console.log(`\nConflicts (alias != table):`);
    for (const c of conflicts) console.log(c);
  }
  if (aliasOnly.length > 0 && aliasOnly.length <= 20) {
    console.log(`\nAlias-only (no table entry):`);
    for (const a of aliasOnly) console.log(a);
  } else if (aliasOnly.length > 20) {
    console.log(`\nAlias-only: ${aliasOnly.length} wires (too many to show)`);
  }
  if (tableOnly.length > 0) {
    console.log(`\nTable-only (no wire found):`);
    for (const t of tableOnly) console.log(t);
  }
}

console.log(`\n=== Summary ===`);
console.log(`Conflicts: ${totalConflicts}`);
console.log(`Alias-only: ${totalAliasOnly}`);
console.log(`Table-only: ${totalTableOnly}`);
