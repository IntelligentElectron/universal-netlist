/**
 * Check strLst parsing for a DSN file and dump first entries.
 */
import { OleReader } from "../src/parsers/ole-reader/ole-reader.js";
import { BinaryReader } from "../src/parsers/cadence/dsn/binary-reader.js";

const PAGE_SETTINGS_SIZE = 156;
const dsnPath = process.argv[2]!;

const ole = new OleReader(dsnPath);
const buf = ole.readStreamByPath("Library");
const r = new BinaryReader(buf);
r.skip(32); // intro
r.skip(2);
r.skip(2); // version
r.skip(4);
r.skip(4); // dates
r.skip(4); // zeros
const tf = r.readUint16();
console.log("textFonts:", tf);
if (tf > 0) r.skip((tf - 1) * 60);
const sl = r.readUint16();
console.log("someLen:", sl);
r.skip(sl * 2);
r.skip(8);
for (let i = 0; i < 8; i++) {
  const s = r.readStringLenZeroTerm();
  console.log(`partField[${i}]: "${s}"`);
}
r.skip(PAGE_SETTINGS_SIZE);
const len = r.readUint16();
console.log(`\nstrLst length: ${len} at offset ${r.tell()}`);
for (let i = 0; i < Math.min(40, len); i++) {
  console.log(`  [${i}] "${r.readStringLenZeroTerm()}"`);
}
