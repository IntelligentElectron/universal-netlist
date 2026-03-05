/**
 * Search for a string in raw bytes around OPC structures.
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
const searchStr = process.argv[3] || "VOLUP";
const searchBuf = Buffer.from(searchStr);

const ole = new OleReader(dsnPath);
const entries = ole.listAllEntries();
const pageEntries = entries.filter((e) => /^Views\/.*\/Pages\//.test(e.path) && e.entry.type === 2);

for (const pe of pageEntries) {
  const buf = ole.readStreamByPath(pe.path);

  // Search entire page buffer for the string
  let idx = 0;
  while (idx < buf.length) {
    const found = buf.indexOf(searchBuf, idx);
    if (found === -1) break;
    // Show context
    const start = Math.max(0, found - 20);
    const end = Math.min(buf.length, found + searchBuf.length + 20);
    const context = [...buf.subarray(start, end)]
      .map((b) =>
        b >= 32 && b < 127 ? String.fromCharCode(b) : `\\x${b.toString(16).padStart(2, "0")}`
      )
      .join("");
    console.log(`${pe.path} @${found}: ...${context}...`);
    idx = found + 1;
  }
}
