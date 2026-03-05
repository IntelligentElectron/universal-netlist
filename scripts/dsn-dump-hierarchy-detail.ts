/**
 * Dump detailed hierarchy record metadata to find ID mappings.
 * Usage: npx tsx scripts/dsn-dump-hierarchy-detail.ts <dsn-file> [filter]
 */
import { OleReader } from "../src/parsers/ole-reader/ole-reader.js";
import { BinaryReader } from "../src/parsers/cadence/dsn/binary-reader.js";

const dsnPath = process.argv[2]!;
const filter = process.argv[3]?.toUpperCase() || "";

if (!dsnPath) {
  console.error("Usage: npx tsx scripts/dsn-dump-hierarchy-detail.ts <dsn-file> [filter]");
  process.exit(1);
}

const ole = new OleReader(dsnPath);
const entries = ole.listAllEntries();
const hierEntry = entries.find(
  (e) => /^Views\/.*\/Hierarchy\/Hierarchy$/.test(e.path) && e.entry.type === 2
);
if (!hierEntry) {
  console.error("No Hierarchy stream found");
  process.exit(1);
}

const buf = ole.readStreamByPath(hierEntry.path);
const r = new BinaryReader(buf);

// Header
r.skip(9);
const viewNameLen = r.readUint16();
r.skip(viewNameLen + 1);

// Scan to first 0x43
while (r.tell() < buf.length - 2 && r.readUint8() !== 0x43) {}
r.seek(r.tell() - 3);
const netCount = r.readUint16();
console.log(`Net count: ${netCount}\n`);

console.log("Idx  Name                           Bytes (24 bytes metadata hex dump)");
console.log("---  ---                            ---");

for (let i = 0; i < netCount; i++) {
  const metaStart = r.tell();
  const metaBytes: number[] = [];
  for (let j = 0; j < 24; j++) metaBytes.push(r.readUint8());

  const nameLen = r.readUint16();
  const nameBytes = Buffer.alloc(nameLen);
  for (let j = 0; j < nameLen; j++) nameBytes[j] = r.readUint8();
  r.skip(1);
  const name = nameBytes.toString("ascii");

  if (filter && !name.toUpperCase().includes(filter)) continue;

  const hex = metaBytes.map((b) => b.toString(16).padStart(2, "0")).join(" ");

  // Try reading as uint32 LE at various offsets
  const mb = Buffer.from(metaBytes);
  const ids: string[] = [];
  for (let off = 0; off < 20; off += 4) {
    ids.push(`@${off}=${mb.readUInt32LE(off)}`);
  }

  console.log(`${String(i).padStart(3)}  ${name.padEnd(30)} ${hex}`);
  console.log(`     uint32s: ${ids.join("  ")}`);
}
