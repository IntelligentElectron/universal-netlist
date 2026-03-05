/**
 * Dump hierarchy stream net records with their metadata bytes.
 * Usage: npx tsx scripts/dsn-dump-hierarchy-ids.ts <dsn-file> [filter]
 */
import { OleReader } from "../src/parsers/ole-reader/ole-reader.js";
import { BinaryReader } from "../src/parsers/cadence/dsn/binary-reader.js";

const dsnPath = process.argv[2]!;
const filter = (process.argv[3] || "").toUpperCase();

const ole = new OleReader(dsnPath);
const entries = ole.listAllEntries();
const hierEntry = entries.find(
  (e) => /^Views\/.*\/Hierarchy\/Hierarchy$/.test(e.path) && e.entry.type === 2
);
if (!hierEntry) {
  console.log("No hierarchy stream");
  process.exit(0);
}

const buf = ole.readStreamByPath(hierEntry.path);
const r = new BinaryReader(buf);

// Header
r.skip(9); // type + structLength + zeros
const viewNameLen = r.readUint16();
r.skip(viewNameLen + 1);

// Scan for 0x43 marker
while (r.tell() < buf.length - 2) {
  if (r.readUint8() === 0x43) {
    r.seek(r.tell() - 3);
    break;
  }
}
const netCount = r.readUint16();
console.log(`Hierarchy nets: ${netCount}\n`);

for (let i = 0; i < netCount; i++) {
  const metaStart = r.tell();
  // Read 24 bytes of metadata as various uint32s
  const u32s = [];
  for (let j = 0; j < 6; j++) u32s.push(r.readUint32());

  const nameLen = r.readUint16();
  r.skip(nameLen + 1);
  const name = buf
    .subarray(r.tell() - nameLen - 1, r.tell() - 1)
    .toString("ascii")
    .toUpperCase();

  if (filter && !name.includes(filter)) continue;

  const hex = [...buf.subarray(metaStart, metaStart + 24)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");
  console.log(`[${i}] "${name}" u32s=[${u32s.join(", ")}] hex=[${hex}]`);
}
