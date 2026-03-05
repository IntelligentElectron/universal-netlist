/**
 * Check if specific net names exist in the hierarchy stream.
 * Usage: npx tsx scripts/dsn-check-hierarchy-names.ts <dsn-file> <name1> [name2] ...
 */
import { OleReader } from "../src/parsers/ole-reader/ole-reader.js";
import { BinaryReader } from "../src/parsers/cadence/dsn/binary-reader.js";

const dsnPath = process.argv[2]!;
const searchNames = process.argv.slice(3).map((n) => n.toUpperCase());

const ole = new OleReader(dsnPath);
const entries = ole.listAllEntries();
const hierEntry = entries.find((e) => /Hierarchy\/Hierarchy$/.test(e.path) && e.entry.type === 2);
if (!hierEntry) {
  console.log("No hierarchy stream");
  process.exit(0);
}

const buf = ole.readStreamByPath(hierEntry.path);
const r = new BinaryReader(buf);
r.skip(9);
const vnl = r.readUint16();
r.skip(vnl + 1);
while (r.tell() < buf.length - 2) {
  if (r.readUint8() === 0x43) {
    r.seek(r.tell() - 3);
    break;
  }
}
const nc = r.readUint16();
const names: string[] = [];
for (let i = 0; i < nc; i++) {
  r.skip(24);
  const nl = r.readUint16();
  r.skip(nl + 1);
  const name = buf
    .subarray(r.tell() - nl - 1, r.tell() - 1)
    .toString("ascii")
    .toUpperCase();
  names.push(name);
}

for (const sn of searchNames) {
  console.log(`${sn}: ${names.includes(sn) ? "YES" : "NO"}`);
}
