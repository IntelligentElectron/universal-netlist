/**
 * Debug strLst parsing by reading raw bytes at the failure point.
 */
import { OleReader } from "../src/parsers/ole-reader/ole-reader.js";
import { BinaryReader } from "../src/parsers/cadence/dsn/binary-reader.js";

const PAGE_SETTINGS_SIZE = 156;
const dsnPath = process.argv[2]!;

const ole = new OleReader(dsnPath);
const buf = ole.readStreamByPath("Library");
const r = new BinaryReader(buf);
r.skip(32);
r.skip(2);
r.skip(2);
r.skip(4);
r.skip(4);
r.skip(4);
const tf = r.readUint16();
if (tf > 0) r.skip((tf - 1) * 60);
const sl = r.readUint16();
r.skip(sl * 2);
r.skip(8);
for (let i = 0; i < 8; i++) r.readStringLenZeroTerm();
r.skip(PAGE_SETTINGS_SIZE);
const len = r.readUint16();
console.log(`strLst length: ${len} at offset ${r.tell()}`);

// Read first string (empty)
const pos0 = r.tell();
const firstLen = r.readUint16();
console.log(`[0] at ${pos0}: len=${firstLen}`);
if (firstLen === 0) {
  const nullByte = r.readUint8();
  console.log(`  null terminator: 0x${nullByte.toString(16)}`);
}

// Dump raw bytes for next few entries
const pos1 = r.tell();
console.log(`\nRaw bytes at offset ${pos1}:`);
const rawBytes = [];
for (let i = 0; i < 60; i++) {
  rawBytes.push(r.readUint8());
}
r.seek(pos1);

// Show as hex
console.log(rawBytes.map((b) => b.toString(16).padStart(2, "0")).join(" "));

// Try reading as strings
const strings: string[] = [];
let str = "";
let strStart = 0;
for (let i = 0; i < rawBytes.length; i++) {
  const b = rawBytes[i];
  if (b >= 32 && b < 127) {
    if (str === "") strStart = i;
    str += String.fromCharCode(b);
  } else {
    if (str.length >= 1) strings.push(`@${pos1 + strStart}: "${str}"`);
    str = "";
  }
}
if (str.length >= 1) strings.push(`@${pos1 + strStart}: "${str}"`);
console.log("Strings found:", strings.join(", "));

// Try reading as uint16 len + string + null
r.seek(pos1);
for (let i = 0; i < 5; i++) {
  const p = r.tell();
  const slen = r.readUint16();
  if (slen > 200) {
    console.log(`[${i + 1}] at ${p}: len=${slen} (too large, probably wrong format)`);
    break;
  }
  const chars = [];
  for (let j = 0; j < slen; j++) chars.push(String.fromCharCode(r.readUint8()));
  const term = r.readUint8();
  console.log(
    `[${i + 1}] at ${p}: len=${slen} str="${chars.join("")}" term=0x${term.toString(16)}`
  );
}
