/**
 * The root schematic a design's Library stream names.
 */

import { describe, expect, it } from "vitest";
import { existsSync } from "fs";
import { DsnReader } from "./dsn-reader.js";
import { parseLibraryStream, parseLibraryStrLst } from "./library-parser.js";
import { fixturePath, hasFixtures } from "../../../../test/utils.js";

/** A uint16 length, the bytes, and the null terminator, as the stream writes strings. */
const str = (s: string): Buffer => {
  const len = Buffer.alloc(2);
  len.writeUInt16LE(s.length);
  return Buffer.concat([len, Buffer.from(s, "latin1"), Buffer.from([0])]);
};

const u16 = (n: number): Buffer => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};

const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};

/** A Library stream with no fonts and one string, ending in the design footer. */
const library = (opts: { introduction?: string; root?: string; tail?: Buffer } = {}): Buffer => {
  const intro = Buffer.alloc(32);
  intro.write(opts.introduction ?? "OrCAD Windows Design", "latin1");
  return Buffer.concat([
    intro,
    u16(3),
    u16(2), // version 3.2
    Buffer.alloc(12), // create and modify dates, zeros
    u16(1), // text_font_len: one less font follows, none
    u16(0), // some_len
    Buffer.alloc(8),
    ...Array.from({ length: 8 }, () => str("")), // part field names
    Buffer.alloc(156), // PageSettings
    u32(1),
    str("VCC"), // strLst
    u16(1),
    str("74LS00"),
    str("DIP14"), // one part alias
    Buffer.alloc(8),
    ...(opts.root === undefined ? [] : [str(opts.root)]),
    opts.tail ?? Buffer.alloc(0),
  ]);
};

const rootOf = (buffer: Buffer): string | undefined => parseLibraryStream(buffer).rootSchematic;

describe("parseLibraryStream root schematic", () => {
  it("reads the root schematic from the end of a design's Library stream", () => {
    const buffer = library({ root: "PSUPPLY-REV2" });

    expect(parseLibraryStream(buffer)).toEqual({ strLst: ["VCC"], rootSchematic: "PSUPPLY-REV2" });
    expect(parseLibraryStrLst(buffer)).toEqual(["VCC"]);
  });

  it("names nothing for a library, which has no design footer", () => {
    expect(rootOf(library({ introduction: "OrCAD Windows Library" }))).toBeUndefined();
  });

  it("names nothing when the name does not end the stream", () => {
    // Bytes after the name mean something before it was misread.
    expect(rootOf(library({ root: "TOP", tail: Buffer.from([1]) }))).toBeUndefined();
  });

  it("names nothing when the stream ends before the name", () => {
    expect(rootOf(library())).toBeUndefined();
  });

  it("names nothing for an empty name", () => {
    expect(rootOf(library({ root: "" }))).toBeUndefined();
  });
});

// Multi-view fixtures: the root each names is its one unplaced root, the
// schematic its hierarchy starts from.
const MULTI_VIEW_FIXTURES: [string, string, string][] = [
  ["pintowin-sensor-board", "SENSOR_BOARD.DSN", "SCHEMATIC1"],
  ["parallella-aafm", "HB1A-AAFM.DSN", "TOP-LEVEL"],
  ["parallella-meta-carrier", "meta_carrier_sch_rev1.dsn", "TOP"],
];

describe.skipIf(!hasFixtures)("root schematic of multi-view fixtures", () => {
  for (const [dir, file, root] of MULTI_VIEW_FIXTURES) {
    const dsn = fixturePath("cadence", dir, file);
    it.skipIf(!existsSync(dsn))(`${file} names ${root}`, () => {
      const ole = new DsnReader(dsn);
      const entry = ole
        .listAllEntries()
        .find((e) => (e.path === "Library" || e.path.endsWith("/Library")) && e.entry.type === 2)!;

      expect(rootOf(ole.readStreamByPath(entry.path))).toBe(root);
    });
  }
});
