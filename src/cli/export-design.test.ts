/**
 * export_design through the command line's own parser and runner, as
 * `universal-netlist export_design ...` runs it.
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { exportDesignTool } from "./export-design.js";
import { CLI_ONLY_TOOLS, runQuery, toolHelp, toolNamed } from "./query.js";
import { callTool, findTool, TOOLS, type AnyToolDefinition } from "../tools/index.js";
import { serviceContextFromEnvironment } from "../service/context.js";
import { parseUniversalNetlist, serializeUniversalNetlist } from "../parsers/universal/reader.js";
import { MemoryCacheStore } from "../service/cache.js";
import { UNIVERSAL_NETLIST_SCHEMA_VERSION } from "../universal-format.js";
import { fixturePath, hasFixtures } from "../../test/utils.js";

const TEST_DIR = path.dirname(new URL(import.meta.url).pathname);
const DEMO = path.resolve(TEST_DIR, "../../test/universal/demo-board.netlist.json");
const tool = exportDesignTool as unknown as AnyToolDefinition;

const exportDesign = (...tokens: string[]) =>
  runQuery(tool, tokens, {
    isTTY: false,
    context: async () => serviceContextFromEnvironment(),
  });

const readDocument = async (file: string) => JSON.parse(await readFile(file, "utf-8"));

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "export-design-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("export_design", () => {
  it("is a command-line tool, never offered over MCP", () => {
    expect(toolNamed("export_design")).toBe(tool);
    expect(CLI_ONLY_TOOLS).toContain(tool);
    expect(findTool("export_design")).toBeUndefined();
    expect(TOOLS.map((t) => t.name)).not.toContain("export_design");
  });

  it("prints its own help, steering questions to the query tools", async () => {
    const outcome = await exportDesign("--help");
    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toBe(toolHelp(tool));
    expect(outcome.stdout).toContain(
      "Usage: universal-netlist export_design <design> [--output <text>] [--design_variant <text>]"
    );
    expect(outcome.stdout).toContain("use the query tools instead");
    expect(outcome.stdout).toContain("--output <text>");
    expect(outcome.stdout).toContain("--design_variant <text>");
  });

  it("writes the base build to --output and reports it", async () => {
    const out = path.join(dir, "board.netlist.json");

    const outcome = await exportDesign(DEMO, "--output", out);

    expect(outcome.exitCode).toBe(0);
    expect(JSON.parse(outcome.stdout!)).toEqual({
      design: DEMO,
      design_variant: "<Default>",
      output: out,
    });
    const document = await readDocument(out);
    expect(document.universalNetlistSchemaVersion).toBe(UNIVERSAL_NETLIST_SCHEMA_VERSION);
    expect(document.metadata.netlistHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(document.metadata.origin).toEqual({ type: "native" });
    expect(document.metadata).not.toHaveProperty("designVariant");
    const netlist = parseUniversalNetlist(await readFile(out, "utf-8"), "board.netlist.json");
    expect(netlist.components.U1.mpn).toBe("REG-3V3-SOT23");
    expect(netlist.components.D1.dns).toBe(true);
  });

  it("defaults the output to <design>.netlist.json in the working directory", async () => {
    const previous = process.cwd();
    process.chdir(dir);
    let outcome: Awaited<ReturnType<typeof exportDesign>>;
    try {
      outcome = await exportDesign(DEMO);
    } finally {
      process.chdir(previous);
    }

    const expected = path.join(await realpath(dir), "demo-board.netlist.json");
    expect(JSON.parse(outcome.stdout!).output).toBe(expected);
    expect((await readDocument(expected)).components.U1.mpn).toBe("REG-3V3-SOT23");
  });

  it("preserves provenance when re-exporting a Universal Netlist", async () => {
    const source = path.join(dir, "source.netlist.json");
    const out = path.join(dir, "copy.netlist.json");
    const document = await readDocument(DEMO);
    document.metadata.origin = {
      type: "vendor",
      source: { vendor: "Altium", fileType: ".prjpcb", formatVersion: "5.0" },
    };
    await writeFile(source, JSON.stringify(document));

    expect((await exportDesign(source, "--output", out)).exitCode).toBe(0);
    expect((await readDocument(out)).metadata.origin).toEqual(document.metadata.origin);
  });

  it("refuses, as usage errors writing nothing, a missing design, a bad output path, a second path and an unknown flag", async () => {
    const out = path.join(dir, "x.netlist.json");
    const cases: Array<[string[], string]> = [
      [[], "--design: required"],
      [[DEMO, "--output", path.join(dir, "x.json")], "must end in .netlist.json"],
      [[DEMO, out], `Unexpected argument '${out}'`],
      [[DEMO, "--output", out, "--bogus-flag"], "Unknown flag '--bogus-flag'"],
      [[DEMO, "--output", out, "--design-variant", "A"], "Did you mean --design_variant?"],
    ];
    for (const [tokens, message] of cases) {
      const outcome = await exportDesign(...tokens);
      expect(outcome.exitCode, tokens.join(" ")).toBe(2);
      expect(outcome.stderr).toContain(message);
      expect(outcome.stderr).toContain("usage: universal-netlist export_design");
    }
    expect(existsSync(out)).toBe(false);
  });

  it("writes an unconnected pin as connected to nothing, beside a real net called NC", async () => {
    const source = path.join(dir, "nc.netlist.json");
    const out = path.join(dir, "out.netlist.json");
    await writeFile(
      source,
      serializeUniversalNetlist({
        nets: { NC: { J1: ["1"] } },
        components: { J1: { pins: { "1": "NC", "2": "", "3": { name: "SHLD", net: "" } } } },
      })
    );

    expect((await exportDesign(source, "--output", out)).exitCode).toBe(0);

    const written = await readDocument(out);
    expect(written.components.J1.pins).toEqual({
      "1": "NC",
      "2": "",
      "3": { name: "SHLD", net: "" },
    });
    expect(written.nets).toEqual({ NC: { J1: ["1"] } });
  });

  it("loads through the context's parse cache, as a query does", async () => {
    const cache = new MemoryCacheStore(10);
    const context = async () => ({ ...serviceContextFromEnvironment(), cache });
    const out = path.join(dir, "cached.netlist.json");

    await runQuery(tool, [DEMO, "--output", out], { isTTY: false, context });
    expect(cache.size).toBeGreaterThan(0);
    const second = await runQuery(tool, [DEMO, "--output", out], { isTTY: false, context });

    expect(second.exitCode).toBe(0);
    expect((await readDocument(out)).components.U1.mpn).toBe("REG-3V3-SOT23");
  });

  it("reports a design that does not load as an error result", async () => {
    const broken = path.resolve(
      TEST_DIR,
      "../../test/universal/broken/pin-on-other-net.netlist.json"
    );
    const out = path.join(dir, "x.netlist.json");

    const outcome = await exportDesign(broken, "--output", out);

    expect(outcome.exitCode).toBe(1);
    expect(JSON.parse(outcome.stdout!)).toEqual({
      error: "pin-on-other-net.netlist.json: net 'VCC' lists C1.1, but C1.1 is on 'GND'",
    });
    expect(existsSync(out)).toBe(false);
  });

  it.skipIf(!hasFixtures)("records vendor provenance for an EDA source", async () => {
    const source = fixturePath("kicad", "openmd-motordriver", "OpenMD.kicad_pro");
    const out = path.join(dir, "OpenMD.netlist.json");

    expect((await exportDesign(source, "--output", out)).exitCode).toBe(0);

    expect((await readDocument(out)).metadata.origin).toEqual({
      type: "vendor",
      source: { vendor: "KiCad", fileType: ".kicad_pro" },
    });
  });
});

describe.skipIf(!hasFixtures)("export_design on a design with named variants", () => {
  const source = fixturePath("kicad", "kicad-qa-variants", "variants.kicad_pro");

  it("requires one of the variants, as every query does", async () => {
    const out = path.join(dir, "x.netlist.json");
    const cases: Array<[string[], string]> = [
      [[], "defines design variants ['Variant 1', 'Variant2']"],
      [["--design_variant", "NoSuch"], "Design variant 'NoSuch' not found"],
      [["--design_variant", "<Default>"], "'<Default>' is not a build of design"],
    ];
    for (const [flags, message] of cases) {
      const outcome = await exportDesign(source, "--output", out, ...flags);
      expect(outcome.exitCode, flags.join(" ")).toBe(1);
      expect(JSON.parse(outcome.stdout!).error).toContain(message);
    }
    expect(existsSync(out)).toBe(false);
  });

  it("writes each variant's own build and records which it is", async () => {
    const one = path.join(dir, "one.netlist.json");
    const two = path.join(dir, "two.netlist.json");

    // Flags come in any order with --design; the name matches without regard to case.
    const first = await exportDesign(
      "--design_variant",
      "variant 1",
      "--design",
      source,
      "--output",
      one
    );
    const second = await exportDesign(source, "--output=" + two, "--design_variant=Variant2");

    expect(JSON.parse(first.stdout!).design_variant).toBe("Variant 1");
    expect(JSON.parse(second.stdout!).design_variant).toBe("Variant2");
    const [a, b] = [await readDocument(one), await readDocument(two)];
    expect(a.metadata.designVariant).toBe("Variant 1");
    expect(b.metadata.designVariant).toBe("Variant2");
    expect(a.metadata.netlistHash).not.toBe(b.metadata.netlistHash);
  });

  it("reloads as that one build, which queries and re-exports name", async () => {
    const one = path.join(dir, "one.netlist.json");
    await exportDesign(source, "--output", one, "--design_variant", "Variant 1");

    const listed = (await callTool("list_designs", { path: dir })) as {
      designs: Array<{ design_variants: unknown }>;
    };
    expect(listed.designs[0].design_variants).toEqual([{ name: "Variant 1" }]);
    expect(await callTool("list_nets", { design: one })).toHaveProperty("error");
    expect(await callTool("list_nets", { design: one, design_variant: "Variant 1" })).toMatchObject(
      { design_variant: "Variant 1" }
    );

    const copy = path.join(dir, "copy.netlist.json");
    expect((await exportDesign(one, "--output", copy)).exitCode).toBe(1);
    await exportDesign(one, "--output", copy, "--design_variant", "Variant 1");
    expect((await readDocument(copy)).metadata.designVariant).toBe("Variant 1");
  });
});
