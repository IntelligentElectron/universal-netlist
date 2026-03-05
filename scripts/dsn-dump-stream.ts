/**
 * Dump raw bytes and strings from a CFBF stream.
 * Usage: npx tsx scripts/dsn-dump-stream.ts <dsn-file> <stream-path> [offset] [length]
 */
import { OleReader } from "../src/parsers/ole-reader/ole-reader.js";

const dsnPath = process.argv[2]!;
const streamPath = process.argv[3]!;
const offset = parseInt(process.argv[4] || "0");
const length = parseInt(process.argv[5] || "500");

if (!dsnPath || !streamPath) {
  console.error(
    "Usage: npx tsx scripts/dsn-dump-stream.ts <dsn-file> <stream-path> [offset] [length]"
  );
  process.exit(1);
}

const ole = new OleReader(dsnPath);
const buf = ole.readStreamByPath(streamPath);
console.log(`Stream: ${streamPath} (${buf.length} bytes)`);

const end = Math.min(offset + length, buf.length);
const slice = buf.subarray(offset, end);

// Hex dump with ASCII
for (let i = 0; i < slice.length; i += 16) {
  const hex = [];
  const ascii = [];
  for (let j = 0; j < 16 && i + j < slice.length; j++) {
    const b = slice[i + j];
    hex.push(b.toString(16).padStart(2, "0"));
    ascii.push(b >= 32 && b < 127 ? String.fromCharCode(b) : ".");
  }
  console.log(
    `${(offset + i).toString(16).padStart(6, "0")}  ${hex.join(" ").padEnd(48)}  ${ascii.join("")}`
  );
}

// Also extract all printable strings >= 3 chars
console.log("\n--- Strings ---");
let str = "";
let strStart = offset;
for (let i = offset; i < end; i++) {
  const b = buf[i];
  if (b >= 32 && b < 127) {
    if (str === "") strStart = i;
    str += String.fromCharCode(b);
  } else {
    if (str.length >= 3) {
      console.log(`  @${strStart.toString(16)}: "${str}"`);
    }
    str = "";
  }
}
if (str.length >= 3) console.log(`  @${strStart.toString(16)}: "${str}"`);
