/**
 * The Library stream's version, read from a real design and from the same design
 * with its version rewritten to the older ones of issue #246 (1.1 and 2.0).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { fixturePath, hasFixtures } from "../../../../test/utils.js";

const { rewrite } = vi.hoisted(() => ({
  rewrite: {} as { transform?: (path: string, data: Buffer) => Buffer },
}));

vi.mock("../../ole-reader/ole-reader.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../ole-reader/ole-reader.js")>();
  class OleReader extends actual.OleReader {
    override readStreamByPath(path: string): Buffer {
      const data = super.readStreamByPath(path);
      return rewrite.transform ? rewrite.transform(path, data) : data;
    }
  }
  return { ...actual, OleReader };
});

import { parseDsnFile } from "./dsn-parser.js";
import { DsnReader } from "./dsn-reader.js";
import { readLibraryVersion, UnsupportedDsnVersionError } from "./library-parser.js";

const DSN = fixturePath("cadence", "multio", "MULTIO.DSN");

/** Rewrite the Library version and, with `breakPages`, cut the pages short so reading them throws. */
const atVersion = (major: number, minor: number, breakPages = false): void => {
  rewrite.transform = (path, data) => {
    if (path === "Library") {
      const copy = Buffer.from(data);
      copy.writeUInt16LE(major, 32);
      copy.writeUInt16LE(minor, 34);
      return copy;
    }
    return breakPages && path.includes("/Pages/") ? data.subarray(0, 200) : data;
  };
};

describe("readLibraryVersion", () => {
  it("reads the major and minor after the 32-byte introduction", () => {
    const library = Buffer.alloc(36);
    library.writeUInt16LE(2, 32);
    library.writeUInt16LE(0, 34);
    expect(readLibraryVersion(library)).toEqual({ major: 2, minor: 0 });
  });

  it("has no version for a stream that ends before it", () => {
    expect(readLibraryVersion(Buffer.alloc(35))).toBeUndefined();
  });
});

describe.skipIf(!hasFixtures)("Library stream versions in parseDsnFile", () => {
  let plain: ReturnType<typeof parseDsnFile>;
  let pageError: string;

  beforeAll(() => {
    plain = parseDsnFile(DSN);
    atVersion(3, 2, true);
    pageError = (() => {
      try {
        parseDsnFile(DSN);
      } catch (error) {
        return (error as Error).message;
      }
      throw new Error("pages cut short should not parse");
    })();
    rewrite.transform = undefined;
  });
  afterEach(() => {
    rewrite.transform = undefined;
  });

  it("reads the fixture at version 3.2", () => {
    const reader = new DsnReader(DSN);
    expect(readLibraryVersion(reader.readStreamByPath("Library"))).toEqual({ major: 3, minor: 2 });
    expect(Object.keys(plain.nets).length).toBeGreaterThan(0);
  });

  for (const [major, minor] of [
    [1, 1],
    [2, 0],
  ]) {
    it(`refuses a design at version ${major}.${minor}, naming it`, () => {
      atVersion(major, minor);
      expect(() => parseDsnFile(DSN)).toThrow(UnsupportedDsnVersionError);
      expect(() => parseDsnFile(DSN)).toThrow(
        `older Capture format (Library stream version ${major}.${minor})`
      );
    });

    it(`refuses a design at version ${major}.${minor} before reading pages that fail`, () => {
      atVersion(major, minor, true);
      expect(() => parseDsnFile(DSN)).toThrow(`Library stream version ${major}.${minor}`);
    });
  }

  it("reads a design whose Library stream ends before its version", () => {
    rewrite.transform = (path, data) => (path === "Library" ? data.subarray(0, 20) : data);
    const parsed = parseDsnFile(DSN);
    expect(Object.keys(parsed.nets).sort()).toEqual(Object.keys(plain.nets).sort());
  });

  it("reads a design at an untested version as a tested one", () => {
    atVersion(3, 4);
    expect(parseDsnFile(DSN)).toEqual(plain);
  });

  it("names an untested version when its design fails to parse", () => {
    atVersion(3, 4, true);
    expect(() => parseDsnFile(DSN)).toThrow(
      `${pageError} (Library stream version 3.4; designs read whole so far are at 3.2 and 3.3)`
    );
  });

  it("reports a failure at a tested version unchanged", () => {
    atVersion(3, 3, true);
    expect(() => parseDsnFile(DSN)).toThrow(new Error(pageError));
  });
});
