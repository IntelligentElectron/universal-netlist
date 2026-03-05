/**
 * Dump page stream contents AFTER the OPC section to find where OPC labels live.
 * Usage: npx tsx scripts/dsn-page-after-opc.ts <dsn-file> [page-filter]
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
import {
  parseWire,
  parsePlacedInstance,
  parseGlobal,
  parsePort,
  parseOffPageConnector,
} from "../src/parsers/cadence/dsn/structures.js";

const PAGE_SETTINGS_SIZE = 156;
function skipT0x34(r: BinaryReader) {
  r.skip(9);
  r.skip(4);
  r.readStringLenZeroTerm();
  r.skip(4 + 4 + 4 + 4);
}
function skipT0x35(r: BinaryReader) {
  r.skip(9);
  r.skip(4);
  r.readStringLenZeroTerm();
  r.skip(4 + 4 + 4 + 4);
  const l = r.readUint16();
  r.skip(l * 4);
}

const dsnPath = process.argv[2]!;
const pageFilter = process.argv[3] || "";

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
  if (pageFilter && !pageName.toUpperCase().includes(pageFilter.toUpperCase())) continue;

  r.readStringLenZeroTerm();
  r.skip(PAGE_SETTINGS_SIZE);

  const lt = r.readUint16();
  for (let i = 0; i < lt; i++) skipStructure(r);
  console.log(`After TitleBlocks (${lt}): offset ${r.tell()}`);

  const l34 = r.readUint16();
  for (let i = 0; i < l34; i++) skipT0x34(r);
  console.log(`After T0x34s (${l34}): offset ${r.tell()}`);

  const l35 = r.readUint16();
  for (let i = 0; i < l35; i++) skipT0x35(r);
  console.log(`After T0x35s (${l35}): offset ${r.tell()}`);

  const lnt = r.readUint16();
  for (let i = 0; i < lnt; i++) {
    r.readStringLenZeroTerm();
    r.readUint32();
  }
  console.log(`After NetTable (${lnt}): offset ${r.tell()}`);

  const lw = r.readUint16();
  for (let i = 0; i < lw; i++) parseWire(r);
  console.log(`After Wires (${lw}): offset ${r.tell()}`);

  const lpi = r.readUint16();
  for (let i = 0; i < lpi; i++) parsePlacedInstance(r);
  console.log(`After PlacedInstances (${lpi}): offset ${r.tell()}`);

  const lp = r.readUint16();
  for (let i = 0; i < lp; i++) {
    parsePort(r);
    r.skip(5);
  }
  console.log(`After Ports (${lp}): offset ${r.tell()}`);

  const lg = r.readUint16();
  for (let i = 0; i < lg; i++) {
    parseGlobal(r);
    r.skip(5);
  }
  console.log(`After Globals (${lg}): offset ${r.tell()}`);

  const lo = r.readUint16();
  for (let i = 0; i < lo; i++) {
    parseOffPageConnector(r);
    r.skip(5);
  }
  console.log(`After OPCs (${lo}): offset ${r.tell()}`);

  // Now dump what comes next
  const remaining = buf.length - r.tell();
  console.log(`\nPage: "${pageName}" | Buffer size: ${buf.length} | Remaining: ${remaining} bytes`);
  console.log(`---`);

  // Read next ~500 bytes, showing structure
  const dumpLen = Math.min(500, remaining);
  const startOff = r.tell();

  // Try to identify list structures (uint16 count + entries)
  for (let attempt = 0; attempt < 15; attempt++) {
    if (r.tell() >= buf.length - 2) break;
    const off = r.tell();
    const count = r.readUint16();
    console.log(`\n@${off}: uint16 count = ${count}`);

    if (count > 5000 || count < 0) {
      console.log(`  (too large, probably not a count)`);
      r.seek(off + 1);
      continue;
    }

    if (count === 0) continue;

    // Try reading as structures or strings
    for (let i = 0; i < Math.min(count, 5); i++) {
      const entryOff = r.tell();
      // Peek at first few bytes
      const peekBytes = [];
      for (let j = 0; j < Math.min(30, buf.length - r.tell()); j++) {
        peekBytes.push(r.readUint8());
      }
      r.seek(entryOff);

      const hex = peekBytes.map((b) => b.toString(16).padStart(2, "0")).join(" ");
      const ascii = peekBytes
        .map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : "."))
        .join("");
      console.log(`  [${i}] @${entryOff}: ${hex}`);
      console.log(`       ASCII: ${ascii}`);

      // Try to skip as a structure
      try {
        skipStructure(r);
        r.skip(5);
        console.log(`       -> skipped as structure+5, now at ${r.tell()}`);
      } catch {
        r.seek(entryOff + 10);
        console.log(`       -> not a structure, moved +10`);
      }
    }

    if (count > 5) {
      console.log(`  ... (${count - 5} more entries)`);
      break; // Don't try to parse more
    }
  }

  console.log(`\n========================================\n`);
}
