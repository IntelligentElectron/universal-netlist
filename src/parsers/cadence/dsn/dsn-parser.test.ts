/**
 * DSN Parser Tests
 */

import { describe, it, expect } from "vitest";
import { existsSync } from "fs";
import { join } from "path";
import { OleReader } from "../../ole-reader/ole-reader.js";
import { parseDsnFile } from "./dsn-parser.js";
import { parseCadence, buildCadencePinMap } from "../index.js";

const FIXTURE_DIR = join(__dirname, "../../../../test/fixtures/cadence/BeagleBone-Black/ALLEGRO");
const DSN_FIXTURE = join(FIXTURE_DIR, "BEAGLEBONEBLK_C3.DSN");
const PSTXNET_FIXTURE = join(FIXTURE_DIR, "pstxnet.dat");
const PSTXPRT_FIXTURE = join(FIXTURE_DIR, "pstxprt.dat");
const PSTCHIP_FIXTURE = join(FIXTURE_DIR, "pstchip.dat");

const hasDsnFixture = existsSync(DSN_FIXTURE);
const hasDatFixtures = existsSync(PSTXNET_FIXTURE) && existsSync(PSTXPRT_FIXTURE);

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
    expect(tree.length).toBeGreaterThan(0);
    console.log("\n--- DSN Container Structure ---\n" + tree + "\n");
  });
});

describe.skipIf(!hasDsnFixture)("DSN Parser", () => {
  it("should parse DSN file into ParsedNetlist", () => {
    const result = parseDsnFile(DSN_FIXTURE);

    expect(result).toBeDefined();
    expect(result.nets).toBeDefined();
    expect(result.components).toBeDefined();

    const netNames = Object.keys(result.nets);
    const componentNames = Object.keys(result.components);

    console.log(`\nParsed ${netNames.length} nets, ${componentNames.length} components`);
    console.log("Sample nets:", netNames.slice(0, 10));
    console.log("Sample components:", componentNames.slice(0, 10));

    expect(netNames.length).toBeGreaterThan(0);
    expect(componentNames.length).toBeGreaterThan(0);
  });
});

describe.skipIf(!hasDsnFixture || !hasDatFixtures)("DSN vs DAT comparison", () => {
  it("should find the same net names as the DAT parser", async () => {
    const dsnResult = parseDsnFile(DSN_FIXTURE);

    const datRaw = await parseCadence({
      pstxnetPath: PSTXNET_FIXTURE,
      pstxprtPath: PSTXPRT_FIXTURE,
      pstchipPath: PSTCHIP_FIXTURE,
    });
    buildCadencePinMap(datRaw.nets, datRaw.components, datRaw.chips, datRaw.partNames);

    const dsnNets = new Set(Object.keys(dsnResult.nets));
    const datNets = new Set(Object.keys(datRaw.nets));

    const commonNets = [...dsnNets].filter((n) => datNets.has(n));
    const coverage = commonNets.length / datNets.size;

    console.log(`\nDAT nets: ${datNets.size}, DSN nets: ${dsnNets.size}`);
    console.log(`Common nets: ${commonNets.length} (${(coverage * 100).toFixed(1)}% coverage)`);

    // Expect at least 50% net coverage (coordinate matching is imperfect)
    expect(coverage).toBeGreaterThan(0.5);
  });

  it("should find the same component refdes as the DAT parser", async () => {
    const dsnResult = parseDsnFile(DSN_FIXTURE);

    const datRaw = await parseCadence({
      pstxnetPath: PSTXNET_FIXTURE,
      pstxprtPath: PSTXPRT_FIXTURE,
      pstchipPath: PSTCHIP_FIXTURE,
    });
    buildCadencePinMap(datRaw.nets, datRaw.components, datRaw.chips, datRaw.partNames);

    const dsnComponents = new Set(Object.keys(dsnResult.components));
    const datComponents = new Set(Object.keys(datRaw.components));

    const commonComponents = [...dsnComponents].filter((c) => datComponents.has(c));
    const coverage = commonComponents.length / datComponents.size;

    console.log(`\nDAT components: ${datComponents.size}, DSN components: ${dsnComponents.size}`);
    console.log(
      `Common components: ${commonComponents.length} (${(coverage * 100).toFixed(1)}% coverage)`
    );

    // Expect at least 50% component coverage
    expect(coverage).toBeGreaterThan(0.5);
  });
});
