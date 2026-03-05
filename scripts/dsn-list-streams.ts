/**
 * List all CFBF streams in a DSN file.
 * Usage: npx tsx scripts/dsn-list-streams.ts <dsn-file>
 */
import { OleReader } from "../src/parsers/ole-reader/ole-reader.js";

const dsnPath = process.argv[2]!;
if (!dsnPath) {
  console.error("Usage: npx tsx scripts/dsn-list-streams.ts <dsn-file>");
  process.exit(1);
}

const ole = new OleReader(dsnPath);
for (const e of ole.listAllEntries()) {
  const type = e.entry.type === 2 ? "STREAM" : "DIR   ";
  const size = e.entry.type === 2 ? ` (${e.entry.size} bytes)` : "";
  console.log(`${type} ${e.path}${size}`);
}
