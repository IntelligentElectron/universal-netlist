/**
 * End to end: a Universal Netlist JSON file is a design every tool serves.
 *
 * Runs the MCP server in memory and drives it through the client, so the path
 * under test is the one an agent uses: list_designs finds the file, and the
 * query tools and run_erc read it. The golden files are Universal Netlists
 * written by the EDA parsers, so every one of them must load through the
 * handler unchanged, and a KiCad design exported to JSON must answer every
 * query exactly as its source does.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdir, readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../server.js";
import { parseDesign } from "../index.js";
import { parseUniversalDesign } from "./index.js";
import { fixturePath, hasFixtures } from "../../../test/utils.js";

const TEST_DIR = path.dirname(new URL(import.meta.url).pathname);
const UNIVERSAL = path.resolve(TEST_DIR, "../../../test/universal");
const GOLDEN = path.resolve(TEST_DIR, "../../../test/golden");
const DEMO = path.join(UNIVERSAL, "demo-board.netlist.json");

type ToolResult = { isError?: boolean; content?: Array<{ text?: string }> };

let client: Client;

const call = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
  const result = (await client.callTool({ name, arguments: args })) as ToolResult;
  const text = result.content?.[0]?.text ?? "";
  return JSON.parse(text);
};

beforeAll(async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), createServer().connect(serverTransport)]);
});

describe("a Universal Netlist file as a design", () => {
  it("list_designs finds it, reports the broken one with its error, and skips non-netlists", async () => {
    const result = (await call("list_designs", { path: UNIVERSAL })) as {
      designs: Array<{ name: string; path: string; error?: string }>;
    };
    expect(result.designs).toEqual([
      { name: "demo-board.netlist", path: DEMO },
      {
        name: "pin-on-other-net",
        path: path.join(UNIVERSAL, "broken", "pin-on-other-net.json"),
        error: "pin-on-other-net.json: net 'VCC' lists C1.1, but C1.1 is on 'GND'",
      },
    ]);
  });

  it("run_erc runs every rule on it", async () => {
    const result = await call("run_erc", { design: DEMO });
    expect(result).toEqual({
      design: DEMO,
      checked: ["net.single_pin", "net.testpoint_orphan", "net.testpoint_stub", "net.unnamed"],
      skipped: { dns: 1 },
      errors: {
        "net.single_pin": { LED: ["R1.2"], SENSE: ["R2.1"] },
      },
      warnings: {
        "net.testpoint_stub": { "Net-(U2-Pad5)": ["TP1.1", "U2.5"] },
        "net.unnamed": ["Net-(R3-Pad1)"],
      },
    });
  });

  it("run_erc with include_dns counts the do-not-stuff part as present", async () => {
    const result = (await call("run_erc", { design: DEMO, include_dns: true })) as {
      errors?: Record<string, unknown>;
      skipped?: unknown;
    };
    expect(result.skipped).toBeUndefined();
    expect(result.errors?.["net.single_pin"]).toEqual({ SENSE: ["R2.1"] });
  });

  it("query_component reads named pins, dns, and the normalized unconnected pin", async () => {
    const u2 = (await call("query_component", { design: DEMO, refdes: "U2" })) as {
      refdes: string;
      mpn?: string;
      pins: Record<string, unknown>;
    };
    expect(u2.refdes).toBe("U2");
    expect(u2.mpn).toBe("MCU-8BIT-10");
    expect(u2.pins["1"]).toEqual({ name: "VDD", net: "PP3V3" });
    expect(u2.pins["8"]).toEqual({ name: "PA2", net: "NC" });

    const d1 = (await call("query_component", { design: DEMO, refdes: "D1" })) as { dns?: boolean };
    expect(d1.dns).toBe(true);
  });

  it("list_components, search_nets, and query_xnet_by_pin_name read it", async () => {
    const caps = (await call("list_components", { design: DEMO, type: "C" })) as {
      components?: unknown;
      error?: string;
    };
    expect(caps.error).toBeUndefined();
    expect(JSON.stringify(caps)).toContain("C1");
    expect(JSON.stringify(caps)).toContain("C2");

    const rails = (await call("search_nets", { design: DEMO, pattern: "^PP" })) as {
      results: Record<string, string[]>;
    };
    expect([...rails.results["demo-board.netlist"]].sort()).toEqual(["PP3V3", "PP5V"]);

    const xnet = (await call("query_xnet_by_pin_name", { design: DEMO, pin_name: "U2.5" })) as {
      error?: string;
      starting_point?: string;
      net?: string;
    };
    expect(xnet.error).toBeUndefined();
    expect(xnet.starting_point).toBe("U2.5");
    expect(xnet.net).toBe("Net-(U2-Pad5)");
  });

  it("a tool on a broken file reports the defect", async () => {
    const result = (await call("run_erc", {
      design: path.join(UNIVERSAL, "broken", "pin-on-other-net.json"),
    })) as { error?: string };
    expect(result.error).toBe("pin-on-other-net.json: net 'VCC' lists C1.1, but C1.1 is on 'GND'");
  });

  it("a tool on a .json that is not a netlist says so", async () => {
    const result = (await call("run_erc", {
      design: path.join(UNIVERSAL, "not-a-netlist.json"),
    })) as {
      error?: string;
    };
    expect(result.error).toContain("not-a-netlist.json: not a Universal Netlist");

    const malformed = (await call("run_erc", {
      design: path.join(UNIVERSAL, "malformed.json"),
    })) as {
      error?: string;
    };
    expect(malformed.error).toContain("malformed.json: not valid JSON");
  });
});

describe("every golden file is a Universal Netlist", () => {
  const goldens = async (): Promise<Array<{ filePath: string }>> => {
    const out: Array<{ filePath: string }> = [];
    const formats = await readdir(GOLDEN, { withFileTypes: true });
    for (const format of formats.filter((f) => f.isDirectory())) {
      const dir = path.join(GOLDEN, format.name);
      for (const file of (await readdir(dir)).filter((f) => f.endsWith(".json"))) {
        out.push({ filePath: path.join(dir, file) });
      }
    }
    return out;
  };

  it("loads unchanged through the handler", async () => {
    let count = 0;
    for (const { filePath } of await goldens()) {
      const loaded = await parseUniversalDesign(filePath);
      const raw = JSON.parse(await readFile(filePath, "utf-8"));
      expect(loaded, filePath).toEqual(raw);
      count += 1;
    }
    expect(count).toBeGreaterThan(0);
  });
});

describe.skipIf(!hasFixtures)("a KiCad design exported to JSON answers like its source", () => {
  const source = fixturePath("kicad", "openmd-motordriver", "OpenMD.kicad_pro");
  let dir: string;
  let exported: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "universal-roundtrip-"));
    exported = path.join(dir, "OpenMD.json");
    // What `--export-json` writes: the parsed design, serialized.
    await writeFile(exported, JSON.stringify(await parseDesign(source), null, 2) + "\n");
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const strip = (value: unknown): unknown => {
    const { design: _design, ...rest } = value as Record<string, unknown>;
    return rest;
  };

  it("run_erc", async () => {
    expect(strip(await call("run_erc", { design: exported }))).toEqual(
      strip(await call("run_erc", { design: source }))
    );
  });

  it("query_component and list_components", async () => {
    expect(await call("query_component", { design: exported, refdes: "U1" })).toEqual(
      await call("query_component", { design: source, refdes: "U1" })
    );
    expect(strip(await call("list_components", { design: exported, type: "C" }))).toEqual(
      strip(await call("list_components", { design: source, type: "C" }))
    );
  });

  it("query_xnet_by_net_name", async () => {
    const nets = (await call("list_nets", { design: source })) as { nets: string[] };
    const net = nets.nets.find((n) => !/^(GND|\+|VCC|VDD)/.test(n)) ?? nets.nets[0];
    expect(
      strip(await call("query_xnet_by_net_name", { design: exported, net_name: net }))
    ).toEqual(strip(await call("query_xnet_by_net_name", { design: source, net_name: net })));
  });
});
