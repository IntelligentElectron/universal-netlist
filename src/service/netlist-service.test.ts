import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fixturePath, hasFixtures } from "../../test/utils.js";
import type { DirEntry, FileReader } from "../parsers/context.js";
import { DSN_PASSWORD, KICAD_CLI_PATH } from "../parsers/context.js";
import { createNetlistService, serviceContextFromEnvironment } from "./index.js";

/** A directory where nothing exists on disk, so every read has to come through the reader. */
const MEMORY_ROOT = path.resolve("/in-memory-designs");

/** Load a directory from disk into memory under MEMORY_ROOT/<name>. */
const snapshot = (directory: string, name: string, files = new Map<string, Uint8Array>()) => {
  const walk = (from: string, to: string): void => {
    for (const entry of readdirSync(from)) {
      const source = path.join(from, entry);
      const target = path.join(to, entry);
      if (statSync(source).isDirectory()) walk(source, target);
      else files.set(target, readFileSync(source));
    }
  };
  walk(directory, path.join(MEMORY_ROOT, name));
  return files;
};

const missing = (p: string) => Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" });

/** A reader over a map of files; `listDir` is derived from the paths. */
const memoryReader = (files: Map<string, Uint8Array>, withListDir = true): FileReader => {
  const reads: string[] = [];
  const reader: FileReader = {
    readFile: async (p) => {
      reads.push(p);
      const data = files.get(p);
      if (!data) throw missing(p);
      return data;
    },
    exists: async (p) => files.has(p),
  };
  if (withListDir) {
    reader.listDir = async (dir) => {
      const prefix = dir.endsWith(path.sep) ? dir : dir + path.sep;
      const children = new Map<string, boolean>();
      for (const file of files.keys()) {
        if (!file.startsWith(prefix)) continue;
        const [head, ...rest] = file.slice(prefix.length).split(path.sep);
        children.set(head, rest.length > 0 || children.get(head) === true);
      }
      if (children.size === 0) throw missing(dir);
      return [...children].map(
        ([name, isDir]): DirEntry => ({
          name,
          isFile: () => !isDir,
          isDirectory: () => isDir,
        })
      );
    };
  }
  return Object.assign(reader, { reads });
};

const DESIGNS = [
  { name: "kicad", dir: ["kicad", "openmd-motordriver"], file: "OpenMD.kicad_pro" },
  { name: "altium", dir: ["altium", "misko3"], file: "MISKO3.PrjPcb" },
  { name: "cadence", dir: ["cadence", "multio"], file: "MULTIO.DSN" },
];

describe.skipIf(!hasFixtures)("createNetlistService with a file reader", () => {
  const files = new Map<string, Uint8Array>();
  for (const design of DESIGNS) snapshot(fixturePath(...design.dir), design.name, files);
  snapshot(path.resolve(__dirname, "../../test/universal"), "universal", files);

  it.each(DESIGNS)("reads a $name design from memory exactly as from disk", async (design) => {
    const memory = createNetlistService({ files: memoryReader(files) });
    const disk = createNetlistService();
    const inMemory = path.join(MEMORY_ROOT, design.name, design.file);
    const onDisk = fixturePath(...design.dir, design.file);

    const variants = await memory.listDesigns({ path: path.join(MEMORY_ROOT, design.name) });
    expect(variants).toMatchObject({ designs: [{ path: inMemory }] });
    const variant = (variants as { designs: { design_variants: { name: string }[] }[] }).designs[0]
      .design_variants[0].name;

    const fromMemory = await memory.listNets({ design: inMemory, design_variant: variant });
    expect(fromMemory).not.toHaveProperty("error");
    expect(fromMemory).toEqual(await disk.listNets({ design: onDisk, design_variant: variant }));
    expect(
      await memory.listComponents({ design: inMemory, type: "U", design_variant: variant })
    ).toEqual(await disk.listComponents({ design: onDisk, type: "U", design_variant: variant }));
  });

  it("reads a Universal Netlist from memory", async () => {
    const memory = createNetlistService({ files: memoryReader(files) });
    const result = await memory.listNets({
      design: path.join(MEMORY_ROOT, "universal", "demo-board.netlist.json"),
    });
    expect(result).toMatchObject({ design_variant: "<Default>" });
  });

  it("resolves a relative design path against root", async () => {
    const memory = createNetlistService({ files: memoryReader(files), root: MEMORY_ROOT });
    const result = await memory.searchNets({
      design: path.join("cadence", "MULTIO.DSN"),
      pattern: "^GND",
    });
    expect(result).not.toHaveProperty("error");
    expect(await memory.listDesigns({ path: "kicad" })).toMatchObject({
      root: path.join(MEMORY_ROOT, "kicad"),
    });
  });

  it("answers every tool but list_designs with a reader that cannot list directories", async () => {
    const memory = createNetlistService({ files: memoryReader(files, false) });
    expect(
      await memory.listNets({ design: path.join(MEMORY_ROOT, "cadence", "MULTIO.DSN") })
    ).not.toHaveProperty("error");
    expect(await memory.listDesigns({ path: MEMORY_ROOT })).toEqual({
      error: expect.stringContaining("cannot list directories"),
    });
  });

  it("does not run kicad-cli on files only the reader can see", async () => {
    const only = new Map([...files].filter(([p]) => !p.endsWith(".net")));
    const memory = createNetlistService({ files: memoryReader(only) });
    expect(
      await memory.listNets({ design: path.join(MEMORY_ROOT, "kicad", "OpenMD.kicad_pro") })
    ).toEqual({ error: expect.stringContaining("kicad-cli is turned off for this file reader") });
  });
});

describe("createNetlistService options", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reads nothing from the environment", () => {
    vi.stubEnv(DSN_PASSWORD, "from the environment");
    vi.stubEnv(KICAD_CLI_PATH, "/opt/kicad-cli");
    const service = createNetlistService();
    expect(service.context.parser.dsnPasswords.list()).toEqual([]);
    expect(service.context.parser.kicadCli).toEqual({});

    const environment = serviceContextFromEnvironment();
    expect(environment.parser.dsnPasswords.list()).toEqual([
      { source: DSN_PASSWORD, password: "from the environment" },
    ]);
    expect(environment.parser.kicadCli).toEqual({ path: "/opt/kicad-cli" });
  });

  it("passes the passwords and kicad-cli settings it is given", () => {
    const service = createNetlistService({
      secrets: { dsnPasswords: ["one", "two"] },
      kicadCli: { path: "/usr/bin/kicad-cli", timeoutMs: 5000 },
    });
    expect(service.context.parser.dsnPasswords.list().map((p) => p.password)).toEqual([
      "one",
      "two",
    ]);
    expect(service.context.parser.kicadCli).toEqual({
      path: "/usr/bin/kicad-cli",
      timeoutMs: 5000,
    });
  });

  it("turns kicad-cli off for a custom reader unless asked", () => {
    const files: FileReader = { readFile: async () => new Uint8Array(), exists: async () => false };
    expect(createNetlistService({ files }).context.parser.kicadCli).toBe(false);
    expect(createNetlistService({ files, kicadCli: {} }).context.parser.kicadCli).toEqual({});
  });

  it("applies a tool's defaults and refuses its unknown arguments", async () => {
    const service = createNetlistService();
    expect(await service.call("list_nets", { desgin: "x.DSN" })).toEqual({
      error: expect.stringContaining('Unrecognized key: "desgin"'),
    });
    expect(service.tools.map((tool) => tool.name)).toContain("run_erc");
  });
});
