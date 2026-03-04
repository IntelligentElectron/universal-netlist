import { describe, it, expect } from "vitest";
import { BinaryReader } from "./binary-reader.js";

describe("BinaryReader", () => {
  describe("integer reads", () => {
    it("should read uint8", () => {
      const r = new BinaryReader(Buffer.from([0xff, 0x00, 0x7f]));
      expect(r.readUint8()).toBe(255);
      expect(r.readUint8()).toBe(0);
      expect(r.readUint8()).toBe(127);
    });

    it("should read int8", () => {
      const r = new BinaryReader(Buffer.from([0xff, 0x80, 0x7f]));
      expect(r.readInt8()).toBe(-1);
      expect(r.readInt8()).toBe(-128);
      expect(r.readInt8()).toBe(127);
    });

    it("should read uint16 little-endian", () => {
      const r = new BinaryReader(Buffer.from([0x01, 0x00, 0xff, 0xff]));
      expect(r.readUint16()).toBe(1);
      expect(r.readUint16()).toBe(65535);
    });

    it("should read int16 little-endian", () => {
      const r = new BinaryReader(Buffer.from([0xff, 0xff, 0x00, 0x80]));
      expect(r.readInt16()).toBe(-1);
      expect(r.readInt16()).toBe(-32768);
    });

    it("should read uint32 little-endian", () => {
      const r = new BinaryReader(Buffer.from([0x01, 0x00, 0x00, 0x00]));
      expect(r.readUint32()).toBe(1);
    });

    it("should read int32 little-endian", () => {
      const r = new BinaryReader(Buffer.from([0xff, 0xff, 0xff, 0xff]));
      expect(r.readInt32()).toBe(-1);
    });
  });

  describe("positioning", () => {
    it("should track position with tell()", () => {
      const r = new BinaryReader(Buffer.from([1, 2, 3, 4]));
      expect(r.tell()).toBe(0);
      r.readUint8();
      expect(r.tell()).toBe(1);
      r.readUint16();
      expect(r.tell()).toBe(3);
    });

    it("should seek to absolute position", () => {
      const r = new BinaryReader(Buffer.from([10, 20, 30, 40]));
      r.seek(2);
      expect(r.readUint8()).toBe(30);
    });

    it("should skip bytes", () => {
      const r = new BinaryReader(Buffer.from([10, 20, 30, 40]));
      r.skip(3);
      expect(r.readUint8()).toBe(40);
    });

    it("should report remaining bytes", () => {
      const r = new BinaryReader(Buffer.from([1, 2, 3]));
      expect(r.remaining()).toBe(3);
      r.readUint8();
      expect(r.remaining()).toBe(2);
    });

    it("should support initial offset", () => {
      const r = new BinaryReader(Buffer.from([10, 20, 30]), 1);
      expect(r.tell()).toBe(1);
      expect(r.readUint8()).toBe(20);
    });

    it("should peek without advancing", () => {
      const r = new BinaryReader(Buffer.from([0xaa, 0xbb]));
      const peeked = r.peek(2);
      expect(peeked[0]).toBe(0xaa);
      expect(r.tell()).toBe(0);
    });
  });

  describe("strings", () => {
    it("should read zero-terminated string", () => {
      const r = new BinaryReader(Buffer.from("hello\0world\0"));
      expect(r.readStringZeroTerm()).toBe("hello");
      expect(r.readStringZeroTerm()).toBe("world");
    });

    it("should read length-prefixed string (no null)", () => {
      const buf = Buffer.alloc(7);
      buf.writeUInt16LE(5, 0); // length = 5
      buf.write("ABCDE", 2, "ascii");
      const r = new BinaryReader(buf);
      expect(r.readStringLenTerm()).toBe("ABCDE");
    });

    it("should read length-prefixed null-terminated string", () => {
      const buf = Buffer.alloc(8);
      buf.writeUInt16LE(5, 0); // length = 5
      buf.write("ABCDE", 2, "ascii");
      buf[7] = 0; // null terminator
      const r = new BinaryReader(buf);
      expect(r.readStringLenZeroTerm()).toBe("ABCDE");
    });

    it("should read empty length-prefixed null-terminated string", () => {
      const buf = Buffer.from([0x00, 0x00, 0x00]); // len=0, null
      const r = new BinaryReader(buf);
      expect(r.readStringLenZeroTerm()).toBe("");
    });
  });

  describe("assumeData", () => {
    it("should pass when data matches", () => {
      const r = new BinaryReader(Buffer.from([0xff, 0xe4, 0x5c, 0x39]));
      expect(() => r.assumeData([0xff, 0xe4, 0x5c, 0x39])).not.toThrow();
      expect(r.tell()).toBe(4);
    });

    it("should throw on mismatch", () => {
      const r = new BinaryReader(Buffer.from([0xff, 0x00]));
      expect(() => r.assumeData([0xff, 0xe4])).toThrow("Data mismatch");
    });
  });

  describe("bounds checking", () => {
    it("should throw when reading past end", () => {
      const r = new BinaryReader(Buffer.from([1]));
      r.readUint8();
      expect(() => r.readUint8()).toThrow("Read past end");
    });

    it("should throw on seek out of bounds", () => {
      const r = new BinaryReader(Buffer.from([1, 2]));
      expect(() => r.seek(-1)).toThrow("Seek out of bounds");
      expect(() => r.seek(3)).toThrow("Seek out of bounds");
    });

    it("should detect EOF", () => {
      const r = new BinaryReader(Buffer.from([1]));
      expect(r.isEof()).toBe(false);
      r.readUint8();
      expect(r.isEof()).toBe(true);
    });
  });
});
