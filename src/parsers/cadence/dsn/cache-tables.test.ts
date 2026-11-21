import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { walkCacheTables } from "./cache-parser.js";
import { DsnReader } from "./dsn-reader.js";
import { readLibraryVersion } from "./library-parser.js";

const FIXTURES = join(import.meta.dirname, "../../../../test/fixtures/cadence");
const designs = execSync(`find "${FIXTURES}" -iname '*.dsn'`).toString().trim().split("\n");

/** Types the five tables hold (docs/cadence-dsn-format.md §5.1). */
const TABLE_TYPES = new Set([75, 33, 64, 34, 35, 24, 6, 31]);

describe("walkCacheTables", () => {
  it("reads every version-3 fixture Cache to its exact end, visiting only table types", () => {
    let caches = 0;
    for (const design of designs) {
      const ole = new DsnReader(readFileSync(design));
      if (readLibraryVersion(ole.readStreamByPath("Library"))?.major !== 3) continue;
      const cache = ole.readStreamByPath("Cache");
      const end = walkCacheTables(cache, (type) => {
        expect(TABLE_TYPES.has(type), `${design}: type ${type}`).toBe(true);
      });
      expect(end, design).toBe(cache.length);
      caches++;
    }
    expect(caches).toBeGreaterThan(10);
  });
});
