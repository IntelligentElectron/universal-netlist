/**
 * DSN Parser Tests - Phase 1b: CFBF container exploration
 */

import { describe, it, expect } from "vitest";
import { existsSync } from "fs";
import { join } from "path";
import { OleReader } from "../../ole-reader/ole-reader.js";

const DSN_FIXTURE = join(
  __dirname,
  "../../../../test/fixtures/cadence/BeagleBone-Black/ALLEGRO/BEAGLEBONEBLK_C3.DSN"
);

const hasDsnFixture = existsSync(DSN_FIXTURE);

describe.skipIf(!hasDsnFixture)("DSN CFBF Container", () => {
  it("should open DSN file as OLE container", () => {
    const ole = new OleReader(DSN_FIXTURE);
    const streams = ole.listStreams();
    expect(streams.length).toBeGreaterThan(0);
  });

  it("should list hierarchical directory entries", () => {
    const ole = new OleReader(DSN_FIXTURE);
    const entries = ole.listAllEntries();
    expect(entries.length).toBeGreaterThan(0);

    // Should have Views directory
    const viewEntries = entries.filter((e) => e.path.startsWith("Views"));
    expect(viewEntries.length).toBeGreaterThan(0);

    // Should have Packages directory
    const packageEntries = entries.filter((e) => e.path.startsWith("Packages"));
    expect(packageEntries.length).toBeGreaterThan(0);
  });

  it("should find Page streams under Views/*/Pages/*", () => {
    const ole = new OleReader(DSN_FIXTURE);
    const entries = ole.listAllEntries();
    const pageEntries = entries.filter(
      (e) => /Views\/.*\/Pages\//.test(e.path) && e.entry.type === 2
    );
    expect(pageEntries.length).toBeGreaterThan(0);

    for (const page of pageEntries) {
      expect(page.entry.size).toBeGreaterThan(0);
    }
  });

  it("should find Packages Directory stream", () => {
    const ole = new OleReader(DSN_FIXTURE);
    const entries = ole.listAllEntries();
    const pkgDir = entries.find((e) => e.path === "Packages Directory");
    expect(pkgDir).toBeDefined();
    expect(pkgDir!.entry.type).toBe(2);
    expect(pkgDir!.entry.size).toBeGreaterThan(0);
  });

  it("should read Page stream data", () => {
    const ole = new OleReader(DSN_FIXTURE);
    const entries = ole.listAllEntries();
    const firstPage = entries.find((e) => /Views\/.*\/Pages\//.test(e.path) && e.entry.type === 2);
    expect(firstPage).toBeDefined();

    const data = ole.readStreamByPath(firstPage!.path);
    expect(data.length).toBe(firstPage!.entry.size);
    expect(data.length).toBeGreaterThan(0);
  });

  it("should find Library stream", () => {
    const ole = new OleReader(DSN_FIXTURE);
    const entries = ole.listAllEntries();
    const library = entries.find((e) => e.path === "Library");
    expect(library).toBeDefined();
    expect(library!.entry.type).toBe(2);
  });

  it("should log container structure for inspection", () => {
    const ole = new OleReader(DSN_FIXTURE);
    const tree = ole.getDirectoryTree();
    // Just verify it produces output; useful for manual inspection
    expect(tree.length).toBeGreaterThan(0);
    console.log("\n--- DSN Container Structure ---\n" + tree + "\n");
  });
});
