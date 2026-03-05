/**
 * Parse the Hierarchy stream to extract the flat net list with IDs.
 * Usage: npx tsx scripts/dsn-parse-hierarchy.ts <dsn-file>
 */
import { OleReader } from "../src/parsers/ole-reader/ole-reader.js";
import { BinaryReader } from "../src/parsers/cadence/dsn/binary-reader.js";

const dsnPath = process.argv[2]!;
if (!dsnPath) {
  console.error("Usage: npx tsx scripts/dsn-parse-hierarchy.ts <dsn-file>");
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
r.skip(1); // type byte (0x42)
r.skip(4); // struct length
r.skip(4); // zeros

// View name (length-prefixed)
const viewNameLen = r.readUint16();
const viewNameBytes = Buffer.alloc(viewNameLen);
for (let i = 0; i < viewNameLen; i++) viewNameBytes[i] = r.readUint8();
r.skip(1); // null terminator
const viewName = viewNameBytes.toString("ascii");
console.log(`View: "${viewName}"`);

// Skip to net count (variable padding after view name)
// Scan forward to find the first 0x43 marker, then back up 2 for the count
const scanStart = r.tell();
while (r.tell() < buf.length - 2 && r.readUint8() !== 0x43) {}
r.seek(r.tell() - 3); // back to the uint16 before the 0x43
const netCount = r.readUint16();
console.log(`Net count: ${netCount}\n`);

// Parse each net record
console.log("Idx  HierID      HierID(hex)  Name");
console.log("---  ----------  -----------  ----");
for (let i = 0; i < netCount; i++) {
  r.skip(9); // 0x43 marker + 8 bytes
  r.skip(4); // second 0x43 marker + 3 bytes
  r.skip(4); // some ID
  r.skip(3); // zeros
  const hierNodeId = r.readUint32();
  const nameLen = r.readUint16();
  const nameBytes = Buffer.alloc(nameLen);
  for (let j = 0; j < nameLen; j++) nameBytes[j] = r.readUint8();
  r.skip(1); // null
  const name = nameBytes.toString("ascii");
  console.log(
    `${String(i).padStart(3)}  ${String(hierNodeId).padStart(10)}  0x${hierNodeId.toString(16).padStart(8, "0")}  ${name}`
  );
}
