/**
 * Dump the net table for each page and show which wires use each net ID.
 * Usage: npx tsx scripts/dsn-dump-nettable.ts <dsn-file> [filter]
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

const dsnPath = process.argv[2]!;
const filter = (process.argv[3] || "").toUpperCase();

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

  // Net table
  const netTable = new Map<number, string>();
  const lnt = r.readUint16();
  for (let i = 0; i < lnt; i++) {
    const name = r.readStringLenZeroTerm().toUpperCase();
    const id = r.readUint32();
    netTable.set(id, name);
  }

  // Wires
  const lw = r.readUint16();
  const wires = [];
  for (let i = 0; i < lw; i++) {
    wires.push(parseWire(r));
  }

  // Filter
  const filteredIds = new Set<number>();
  for (const [id, name] of netTable) {
    if (!filter || name.includes(filter)) filteredIds.add(id);
  }

  if (filteredIds.size === 0) continue;

  console.log(`\n=== Page: ${pageName} ===`);
  for (const id of filteredIds) {
    const name = netTable.get(id)!;
    const matchingWires = wires.filter((w) => w.id === id);
    const aliases = matchingWires.flatMap((w) => w.aliases.map((a) => a.name));
    console.log(
      `  ${name} (wireId=${id}): ${matchingWires.length} wires, aliases=[${[...new Set(aliases)].join(",")}]`
    );
    for (const w of matchingWires) {
      console.log(`    (${w.startX},${w.startY})-(${w.endX},${w.endY})`);
    }
  }
}
