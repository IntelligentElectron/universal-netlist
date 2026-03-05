/**
 * Trace wire connectivity for a specific coordinate on a page.
 * Shows all wires in the same Union-Find group, their aliases and net table
 * entries, and all coordinates in the group.
 *
 * Usage:
 *   npx tsx scripts/dsn-wire-trace.ts <dsn-file> <page-substring> <x> <y>
 *
 * Example:
 *   npx tsx scripts/dsn-wire-trace.ts test/fixtures/cadence/BeagleBone-Black/ALLEGRO/BEAGLEBONEBLK_C3.DSN P03 400 410
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
const targetPage = process.argv[3];
const targetX = parseInt(process.argv[4]);
const targetY = parseInt(process.argv[5]);

if (!dsnPath || !targetPage || isNaN(targetX) || isNaN(targetY)) {
  console.error("Usage: npx tsx scripts/dsn-wire-trace.ts <dsn-file> <page-substring> <x> <y>");
  console.error(
    "\nExample: npx tsx scripts/dsn-wire-trace.ts test/fixtures/cadence/BeagleBone-Black/ALLEGRO/BEAGLEBONEBLK_C3.DSN P03 400 410"
  );
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
  if (!pageName.includes(targetPage)) continue;

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
  console.log(`\n=== ${pageName} === (${lw} wires)`);

  // Build union-find from ALL wires, then trace the target coordinate's group
  const parent = new Map<string, string>();
  function find(x: string): string {
    if (!parent.has(x)) parent.set(x, x);
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let curr = x;
    while (curr !== root) {
      const next = parent.get(curr)!;
      parent.set(curr, root);
      curr = next;
    }
    return root;
  }
  function union(a: string, b: string) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  interface WireInfo {
    id: number;
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    aliases: string[];
    tableName?: string;
  }
  const wires: WireInfo[] = [];

  for (let i = 0; i < lw; i++) {
    const w = parseWire(r);
    const aliases = w.aliases.map((a) => a.name.toUpperCase());
    const tableName = netTable.get(w.id);
    wires.push({
      id: w.id,
      startX: w.startX,
      startY: w.startY,
      endX: w.endX,
      endY: w.endY,
      aliases,
      tableName,
    });
    const s = `${w.startX},${w.startY}`;
    const e = `${w.endX},${w.endY}`;
    find(s);
    find(e);
    union(s, e);
  }

  // Find the group for our target coordinate
  const targetKey = `${targetX},${targetY}`;
  if (!parent.has(targetKey)) {
    console.log(`  No wire at (${targetX},${targetY})`);
    continue;
  }

  const targetRoot = find(targetKey);
  console.log(`  Target: (${targetX},${targetY}) -> root: ${targetRoot}`);

  // Find all wires in the same group
  const groupWires = wires.filter((w) => {
    const s = `${w.startX},${w.startY}`;
    const e = `${w.endX},${w.endY}`;
    return find(s) === targetRoot || find(e) === targetRoot;
  });

  console.log(`  Group contains ${groupWires.length} wire segments:`);
  for (const w of groupWires) {
    const nameInfo: string[] = [];
    if (w.aliases.length > 0) nameInfo.push(`aliases=[${w.aliases.join(",")}]`);
    if (w.tableName) nameInfo.push(`table="${w.tableName}"`);
    console.log(
      `    id=${w.id} (${w.startX},${w.startY})-(${w.endX},${w.endY}) ${nameInfo.join(" ") || ""}`
    );
  }

  // Collect all coordinates in the group
  const groupCoords = new Set<string>();
  for (const key of parent.keys()) {
    if (find(key) === targetRoot) groupCoords.add(key);
  }
  console.log(`  Group coordinates: ${groupCoords.size}`);

  // Names in this group
  const names = new Set<string>();
  for (const w of groupWires) {
    for (const a of w.aliases) names.add(a);
    if (w.tableName) names.add(w.tableName);
  }
  console.log(`  Names: ${[...names].join(", ")}`);
}
