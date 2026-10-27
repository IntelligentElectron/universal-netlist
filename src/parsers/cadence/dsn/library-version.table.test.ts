/**
 * Replays the golden decision table in docs/decision-tables/dsn-library-version
 * against the Library version gate, one test per cell, so the table and the code
 * cannot drift.
 */
import path from "path";
import { describe, expect, it } from "vitest";
import { cellName, readTable } from "../../../../test/helpers/decision-table.js";
import {
  assertReadableLibraryVersion,
  describeParseFailure,
  type LibraryVersion,
  UnsupportedDsnVersionError,
} from "./library-parser.js";

const TABLES = path.resolve(__dirname, "../../../../docs/decision-tables/dsn-library-version");

/** Every version each value of the table's `version` dimension covers. */
const VERSIONS: Record<string, (LibraryVersion | undefined)[]> = {
  unknown: [undefined],
  older: [
    { major: 0, minor: 0 },
    { major: 1, minor: 1 },
    { major: 2, minor: 0 },
    { major: 2, minor: 99 },
  ],
  tested: [
    { major: 3, minor: 2 },
    { major: 3, minor: 3 },
  ],
  untested: [
    { major: 3, minor: 0 },
    { major: 3, minor: 1 },
    { major: 3, minor: 4 },
    { major: 4, minor: 0 },
  ],
};

const PAGE_ERROR = "Expected null terminator for empty string at offset 358";

/** What parseDsnFile reports for a design at this version, as the table's outcome phrase. */
const outcome = (version: LibraryVersion | undefined, restThrows: boolean): string => {
  try {
    assertReadableLibraryVersion(version);
  } catch (error) {
    expect(error).toBeInstanceOf(UnsupportedDsnVersionError);
    const message = (error as Error).message;
    expect(message).toContain(`Library stream version ${version!.major}.${version!.minor}`);
    expect(message).toContain("newer OrCAD Capture");
    return "refused naming the version and asking to re-save";
  }
  if (!restThrows) return "netlist";
  const thrown = new Error(PAGE_ERROR);
  const reported = describeParseFailure(version, thrown);
  if (reported === thrown) return "the parse error unchanged";
  const message = (reported as Error).message;
  expect(message.startsWith(PAGE_ERROR)).toBe(true);
  expect(message).toContain(`Library stream version ${version!.major}.${version!.minor};`);
  expect((reported as Error).cause).toBe(thrown);
  return "the parse error naming the untested version";
};

describe("golden table: gate", () => {
  const dims = ["version", "rest_of_parse"];
  for (const row of readTable(TABLES, "gate").filter((r) => r.outcome !== "n/a")) {
    it(cellName(row, dims), () => {
      for (const version of VERSIONS[row.version]) {
        expect(outcome(version, row.rest_of_parse === "throws")).toBe(row.outcome);
      }
    });
  }
});
