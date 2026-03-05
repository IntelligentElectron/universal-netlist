import { describe, it, expect } from "vitest";
import { BinaryReader } from "./binary-reader.js";
import { FutureDataList, autoReadPrefixes, readPreamble } from "./generic-parser.js";
import { StructureType } from "./structure-types.js";

describe("GenericParser", () => {
  describe("readPreamble", () => {
    it("should consume preamble magic + trailing data", () => {
      // Magic (4) + dataLen (4) + 3 bytes trailing
      const buf = Buffer.alloc(11);
      buf[0] = 0xff;
      buf[1] = 0xe4;
      buf[2] = 0x5c;
      buf[3] = 0x39;
      buf.writeUInt32LE(3, 4); // dataLen = 3
      buf[8] = 0xaa;
      buf[9] = 0xbb;
      buf[10] = 0xcc;

      const reader = new BinaryReader(buf);
      readPreamble(reader);
      expect(reader.tell()).toBe(11);
    });

    it("should skip silently when no preamble magic", () => {
      const buf = Buffer.from([0x00, 0x01, 0x02, 0x03]);
      const reader = new BinaryReader(buf);
      readPreamble(reader);
      expect(reader.tell()).toBe(0); // Position unchanged
    });
  });

  describe("autoReadPrefixes", () => {
    it("should read a single short prefix (count=1)", () => {
      // Short prefix: type=49 (Alias), size=-1 (int16)
      const buf = Buffer.alloc(3);
      buf[0] = StructureType.Alias; // type ID
      buf.writeInt16LE(-1, 1); // size = -1

      const reader = new BinaryReader(buf);
      const futureData = new FutureDataList(reader);
      const type = autoReadPrefixes(reader, futureData);

      expect(type).toBe(StructureType.Alias);
      expect(reader.tell()).toBe(3);
    });

    it("should read long prefix + short prefix (count=2)", () => {
      // Long prefix: type=13, offset=100, 4 unknown bytes
      // Short prefix: type=13, size=0
      const buf = Buffer.alloc(12);
      buf[0] = StructureType.PlacedInstance; // type ID
      buf.writeUInt32LE(100, 1); // byte offset
      buf.writeUInt32LE(0, 5); // unknown
      buf[9] = StructureType.PlacedInstance; // same type
      buf.writeInt16LE(0, 10); // size = 0

      const reader = new BinaryReader(buf);
      const futureData = new FutureDataList(reader);
      const type = autoReadPrefixes(reader, futureData);

      expect(type).toBe(StructureType.PlacedInstance);
      expect(reader.tell()).toBe(12);
    });

    it("should reject mismatched type IDs between prefixes", () => {
      // Long prefix with type=13, short prefix with type=49
      const buf = Buffer.alloc(12);
      buf[0] = StructureType.PlacedInstance;
      buf.writeUInt32LE(100, 1);
      buf.writeUInt32LE(0, 5);
      buf[9] = StructureType.Alias; // different type!
      buf.writeInt16LE(-1, 10);

      const reader = new BinaryReader(buf);
      const futureData = new FutureDataList(reader);

      // No valid count works for mismatched types, so it throws
      expect(() => autoReadPrefixes(reader, futureData)).toThrow(
        "Could not find valid number of prefixes"
      );
    });

    it("should enforce expected type when provided", () => {
      // Valid prefix for Alias, but we expect PlacedInstance
      const buf = Buffer.alloc(3);
      buf[0] = StructureType.Alias;
      buf.writeInt16LE(-1, 1);

      const reader = new BinaryReader(buf);
      const futureData = new FutureDataList(reader);

      // The type check happens after successful prefix read, but since
      // count=1 parses Alias successfully, the expected-type mismatch
      // causes the retry loop to fail for all counts
      expect(() => autoReadPrefixes(reader, futureData, StructureType.PlacedInstance)).toThrow(
        "Could not find valid number of prefixes"
      );
    });
  });

  describe("FutureDataList", () => {
    it("should track checkpoint boundaries", () => {
      const buf = Buffer.alloc(100);
      const reader = new BinaryReader(buf);
      const fdl = new FutureDataList(reader);

      // Simulate a long prefix at offset 0 with size 50
      // absStart = 0 + 9 = 9, absStop = 9 + 50 = 59
      fdl.push(0, 50);

      reader.seek(59);
      fdl.checkpoint(); // Should match
    });

    it("should skip to end of structure", () => {
      const buf = Buffer.alloc(200);
      const reader = new BinaryReader(buf);
      const fdl = new FutureDataList(reader);

      fdl.push(0, 100); // absStop = 109
      fdl.push(9, 80); // absStop = 9 + 9 + 80 = 98

      reader.seek(20);
      fdl.readRestOfStructure();
      expect(reader.tell()).toBe(109); // max of 109 and 98
    });
  });
});
