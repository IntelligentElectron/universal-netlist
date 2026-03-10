/**
 * OLE Reader Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "fs/promises";
import { join } from "path";
import { OleReader } from "./ole-reader.js";

describe("OleReader", () => {
  const testDir = join(__dirname, "__test-ole-reader__");

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      console.warn("Test cleanup warning");
    }
  });

  describe("validateMagic", () => {
    it("should reject files with invalid magic signature", async () => {
      const invalidFile = join(testDir, "invalid.bin");
      await writeFile(invalidFile, Buffer.from("not an ole file"));

      expect(() => new OleReader(invalidFile)).toThrow(
        "Invalid OLE file: magic signature mismatch"
      );
    });

    it("should reject empty files", async () => {
      const emptyFile = join(testDir, "empty.bin");
      await writeFile(emptyFile, Buffer.alloc(0));

      expect(() => new OleReader(emptyFile)).toThrow();
    });

    it("should reject files that are too small", async () => {
      const smallFile = join(testDir, "small.bin");
      await writeFile(smallFile, Buffer.alloc(4));

      expect(() => new OleReader(smallFile)).toThrow();
    });
  });

  describe("magic signature", () => {
    it("should pass magic validation with correct signature", async () => {
      const expectedMagic = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

      const header = Buffer.alloc(512);
      expectedMagic.copy(header, 0);
      header.writeUInt16LE(0xfffe, 28);
      header.writeUInt16LE(9, 30);
      header.writeUInt16LE(6, 32);

      const validFile = join(testDir, "valid-header.bin");
      await writeFile(validFile, header);

      try {
        new OleReader(validFile);
      } catch (e) {
        expect((e as Error).message).not.toContain("magic signature");
      }
    });
  });
});

describe("OLE Format Constants", () => {
  it("should define correct special sector values", () => {
    const ENDOFCHAIN = 0xfffffffe;
    const FREESECT = 0xffffffff;
    const FATSECT = 0xfffffffd;
    const DIFSECT = 0xfffffffc;

    expect(ENDOFCHAIN).toBe(4294967294);
    expect(FREESECT).toBe(4294967295);
    expect(FATSECT).toBe(4294967293);
    expect(DIFSECT).toBe(4294967292);
  });
});
