/**
 * DSN Parser Tests
 */

import { describe, it, expect } from "vitest";
import { existsSync } from "fs";
import { join } from "path";
import { OleReader } from "../../ole-reader/ole-reader.js";
import { parseDsnFile } from "./dsn-parser.js";
import { parseCadence, buildCadencePinMap } from "../index.js";
import { traverseCircuitFromNet, computeCircuitHash } from "../../../circuit-traversal.js";

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
    const datEnriched = buildCadencePinMap(
      datRaw.nets,
      datRaw.components,
      datRaw.chips,
      datRaw.partNames
    );

    const dsnComponents = new Set(Object.keys(dsnResult.components));
    const datComponents = new Set(Object.keys(datEnriched));

    const commonComponents = [...dsnComponents].filter((c) => datComponents.has(c));
    const coverage = commonComponents.length / datComponents.size;

    console.log(`\nDAT components: ${datComponents.size}, DSN components: ${dsnComponents.size}`);
    console.log(
      `Common components: ${commonComponents.length} (${(coverage * 100).toFixed(1)}% coverage)`
    );

    // Expect at least 50% component coverage
    expect(coverage).toBeGreaterThan(0.5);
  });

  // circuit_hash used to fold in the backend-dependent `mpn`, so an XNET that is
  // pin-for-pin identical on both paths still produced two different hashes.
  // Any net whose traversal agrees across the two backends must agree on the
  // hash too.
  it("should produce backend-invariant circuit hashes for identical XNETs", async () => {
    const dsnResult = parseDsnFile(DSN_FIXTURE);

    const datRaw = await parseCadence({
      pstxnetPath: PSTXNET_FIXTURE,
      pstxprtPath: PSTXPRT_FIXTURE,
      pstchipPath: PSTCHIP_FIXTURE,
    });
    const datComponents = buildCadencePinMap(
      datRaw.nets,
      datRaw.components,
      datRaw.chips,
      datRaw.partNames
    );

    const commonNets = Object.keys(datRaw.nets).filter((n) => dsnResult.nets[n]);
    expect(commonNets.length).toBeGreaterThan(0);

    const describeCircuit = (r: ReturnType<typeof traverseCircuitFromNet>): string =>
      JSON.stringify(
        [...r.components]
          .map((c) => ({
            refdes: c.refdes,
            connections: [...c.connections]
              .map((conn) => ({ net: conn.net, pins: [...conn.pins].sort() }))
              .sort((a, b) => a.net.localeCompare(b.net)),
          }))
          .sort((a, b) => a.refdes.localeCompare(b.refdes))
      );

    let compared = 0;
    for (const net of commonNets) {
      const datCircuit = traverseCircuitFromNet(net, datRaw.nets, datComponents);
      const dsnCircuit = traverseCircuitFromNet(net, dsnResult.nets, dsnResult.components);

      // Only nets the two backends genuinely agree on are in scope here; net
      // membership differences are what the coverage tests above measure.
      if (describeCircuit(datCircuit) !== describeCircuit(dsnCircuit)) continue;

      compared++;
      expect(
        computeCircuitHash(dsnCircuit.components),
        `circuit_hash differs across backends for net ${net}`
      ).toBe(computeCircuitHash(datCircuit.components));
    }

    console.log(`\nBackend-invariant hash check: ${compared} identical XNETs compared`);
    expect(compared).toBeGreaterThan(0);
  });
});
