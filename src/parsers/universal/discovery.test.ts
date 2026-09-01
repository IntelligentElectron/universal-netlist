import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { discoverUniversalDesigns, isUniversalFile, universalDesignName } from "./discovery.js";

const TEST_DIR = path.dirname(new URL(import.meta.url).pathname);
const UNIVERSAL = path.resolve(TEST_DIR, "../../../test/universal");

describe("isUniversalFile", () => {
  it("accepts .netlist.json in any case and nothing else", () => {
    expect(isUniversalFile("a/b.netlist.json")).toBe(true);
    expect(isUniversalFile("a/B.NETLIST.JSON")).toBe(true);
    expect(isUniversalFile("a/b.json")).toBe(false);
    expect(isUniversalFile("a/b.kicad_pro")).toBe(false);
    expect(isUniversalFile("a/b.netlist.json.bak")).toBe(false);
  });
});

describe("universalDesignName", () => {
  it("is the basename without .netlist.json", () => {
    expect(universalDesignName("/x/board.netlist.json")).toBe("board");
    expect(universalDesignName("/x/my.design.NETLIST.JSON")).toBe("my.design");
  });
});

describe("discoverUniversalDesigns", () => {
  it("lists valid netlists, lists shaped-but-broken ones with an error, skips the rest", async () => {
    const designs = await discoverUniversalDesigns(UNIVERSAL);
    expect(designs.map((d) => d.name)).toEqual([
      "demo-board",
      "malformed",
      "pin-on-other-net",
      "unsigned",
    ]);

    const demo = designs.find((d) => d.name === "demo-board")!;
    expect(demo.format).toBe("universal");
    expect(demo.sourcePath).toBe(path.join(UNIVERSAL, "demo-board.netlist.json"));
    expect(demo.error).toBeUndefined();

    const broken = designs.find((d) => d.name === "pin-on-other-net")!;
    expect(broken.sourcePath).toBe(path.join(UNIVERSAL, "broken", "pin-on-other-net.netlist.json"));
    expect(broken.error).toBe(
      "pin-on-other-net.netlist.json: net 'VCC' lists C1.1, but C1.1 is on 'GND'"
    );

    expect(designs.find((d) => d.name === "unsigned")?.error).toContain(
      "missing `universalNetlistSchemaVersion`"
    );
    expect(designs.find((d) => d.name === "malformed")?.error).toContain("not valid JSON");
  });

  it("honours maxDepth", async () => {
    const designs = await discoverUniversalDesigns(UNIVERSAL, { maxDepth: 0 });
    expect(designs.map((d) => d.name)).toEqual(["demo-board", "malformed", "unsigned"]);
  });

  it("does not walk node_modules or dot-directories", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "universal-discovery-"));
    try {
      const netlist = JSON.stringify({
        universalNetlistSchemaVersion: 1,
        nets: { N: { U1: ["1"] } },
        components: { U1: { pins: { "1": "N" } } },
      });
      await mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
      await mkdir(path.join(root, ".cache"), { recursive: true });
      await mkdir(path.join(root, "designs"), { recursive: true });
      await writeFile(path.join(root, "node_modules", "pkg", "a.netlist.json"), netlist);
      await writeFile(path.join(root, ".cache", "b.netlist.json"), netlist);
      await writeFile(path.join(root, "designs", "c.netlist.json"), netlist);
      await writeFile(path.join(root, "package.json"), '{"name":"x","nets":1,"components":2}');

      const designs = await discoverUniversalDesigns(root);
      expect(designs.map((d) => d.name)).toEqual(["c"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns nothing for a missing directory", async () => {
    expect(await discoverUniversalDesigns("/nonexistent-on-purpose")).toEqual([]);
  });
});
