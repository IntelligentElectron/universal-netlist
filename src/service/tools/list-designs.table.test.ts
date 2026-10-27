/**
 * Replays the golden decision table docs/decision-tables/dsn-library-version/listing
 * against list_designs on real Cadence fixtures, one test per cell, so the table and
 * the code cannot drift. Each cell rewrites the fixture's Library version and, for an
 * encrypted Library, protects every stream the way OrCAD stores a password-protected design.
 */
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cellName, readTable } from "../../../test/helpers/decision-table.js";
import { protectStream } from "../../../test/helpers/orcad-protect.js";
import { fixturePath, hasFixtures } from "../../../test/utils.js";
import type { DesignInfo, ListDesignsResult } from "../../types.js";

const { rewrite } = vi.hoisted(() => ({
  rewrite: {} as { transform?: (path: string, data: Buffer) => Buffer },
}));

vi.mock("../../parsers/ole-reader/ole-reader.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../parsers/ole-reader/ole-reader.js")>();
  class OleReader extends actual.OleReader {
    override readStreamByPath(path: string): Buffer {
      const data = super.readStreamByPath(path);
      return rewrite.transform ? rewrite.transform(path, data) : data;
    }
  }
  return { ...actual, OleReader };
});

import { listDesigns } from "./list-designs.js";
import { loadNetlist } from "../load-netlist.js";

const TABLES = path.resolve(__dirname, "../../../docs/decision-tables/dsn-library-version");

/** A fixture for each value of `variants`: one records no CIS BOM variant, one records `Standard`. */
const FIXTURES: Record<string, { dir: string; file: string }> = {
  none: { dir: fixturePath("cadence", "multio"), file: "MULTIO.DSN" },
  named: {
    dir: fixturePath(
      "cadence",
      "LAUNCHXL-CC1310",
      "doc",
      "hardware",
      "cc1310",
      "launchpad",
      "design_files",
      "Cadence"
    ),
    file: "LAUNCHXL-CC1310.DSN",
  },
};

/** The Library rewrite for each value of `version`: a cut before the version, or the version itself. */
const VERSIONS: Record<string, (library: Buffer) => Buffer> = {
  unknown: (library) => library.subarray(0, 20),
  older: (library) => withVersion(library, 2, 0),
  tested: (library) => withVersion(library, 3, 3),
  untested: (library) => withVersion(library, 3, 4),
};

const withVersion = (library: Buffer, major: number, minor: number): Buffer => {
  const copy = Buffer.from(library);
  copy.writeUInt16LE(major, 32);
  copy.writeUInt16LE(minor, 34);
  return copy;
};

/** What list_designs reports for the design, as the table's outcome phrase. */
const outcome = (design: DesignInfo): string => {
  if (design.unsupported) {
    expect(design.design_variants).toEqual([{ name: "<Default>", is_default: true }]);
    expect(design.error).toContain("older Capture format (Library stream version 2.0)");
    return "unsupported, <Default> alone, error is the refusal";
  }
  expect(design.error).toBeUndefined();
  if (design.design_variants.some((variant) => variant.is_default)) {
    expect(design.design_variants).toEqual([{ name: "<Default>", is_default: true }]);
    return "<Default> alone";
  }
  expect(design.design_variants).toEqual([{ name: "Standard", fabrication: true }]);
  return "its named variants";
};

describe.skipIf(!hasFixtures)("golden table: listing", () => {
  afterEach(() => {
    rewrite.transform = undefined;
  });

  const dims = ["version", "library", "variants"];
  for (const row of readTable(TABLES, "listing").filter((r) => r.outcome !== "n/a")) {
    it(cellName(row, dims), async () => {
      const { dir, file } = FIXTURES[row.variants];
      rewrite.transform = (streamPath, data) => {
        const plain = streamPath === "Library" ? VERSIONS[row.version](data) : data;
        return row.library === "encrypted"
          ? protectStream(streamPath, plain, "synthetic password")
          : plain;
      };
      const result = (await listDesigns({ searchPath: dir, maxDepth: 0 })) as ListDesignsResult;
      const design = result.designs.find((entry) => entry.path.endsWith(file));
      expect(design).toBeDefined();
      expect(outcome(design!)).toBe(row.outcome);
    });
  }
});

describe.skipIf(!hasFixtures)("a query on a design listed unsupported", () => {
  afterEach(() => {
    rewrite.transform = undefined;
  });

  it("returns the error the listing gave it", async () => {
    const { dir, file } = FIXTURES.named;
    rewrite.transform = (streamPath, data) =>
      streamPath === "Library" ? VERSIONS.older(data) : data;
    const result = (await listDesigns({ searchPath: dir, maxDepth: 0 })) as ListDesignsResult;
    const design = result.designs.find((entry) => entry.path.endsWith(file))!;
    expect(design.unsupported).toBe(true);
    for (const variant of [undefined, "Standard"]) {
      expect(await loadNetlist(design.path, variant)).toEqual({ error: design.error });
    }
  });
});
