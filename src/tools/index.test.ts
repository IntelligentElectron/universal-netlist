import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CADENCE_EXPORT_ENABLED } from "../features.js";
import { READ_ONLY, TOOLS, callTool, findTool } from "./index.js";

/**
 * Every module a source file reaches through its relative imports, and every
 * package name it imports along the way.
 */
const importGraph = (entry: string): { files: Set<string>; packages: Set<string> } => {
  const files = new Set<string>();
  const packages = new Set<string>();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    const source = readFileSync(file, "utf8");
    // Static `import ... from "x"`, `export ... from "x"`, and `import("x")`.
    // Type-only imports are erased at compile time, so they load nothing.
    const specifiers = [
      ...source.matchAll(/^\s*(?:import|export)(?!\s+type\b)[^"'`;]*?from\s+["']([^"']+)["']/gm),
      ...source.matchAll(/^\s*import\s+["']([^"']+)["']/gm),
      ...source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g),
    ].map((match) => match[1]);
    for (const specifier of specifiers) {
      if (specifier.startsWith(".")) {
        pending.push(path.resolve(path.dirname(file), specifier.replace(/\.js$/, ".ts")));
      } else {
        packages.add(
          specifier.startsWith("@")
            ? specifier.split("/").slice(0, 2).join("/")
            : specifier.split("/")[0]
        );
      }
    }
  }
  return { files, packages };
};

describe("tool registry", () => {
  it("gives every tool a unique snake_case name", () => {
    const names = TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/);
  });

  it("finds a tool by its exact name only", () => {
    expect(findTool("list_designs")?.name).toBe("list_designs");
    expect(findTool("List_Designs")).toBeUndefined();
    expect(findTool("list-designs")).toBeUndefined();
  });

  it("offers the dormant Cadence exporter only when its feature flag is on", () => {
    expect(findTool("export_cadence_netlist") !== undefined).toBe(CADENCE_EXPORT_ENABLED);
  });

  it("applies each argument's default in the schema, before the tool runs", () => {
    const parsed = findTool("list_components")!.inputSchema.parse({ design: "a.DSN", type: "U" });
    expect(parsed).toEqual({ design: "a.DSN", type: "U", include_dns: true });
    const traced = findTool("query_xnet_by_net_name")!.inputSchema.parse({
      design: "a.DSN",
      net_name: "GND",
    });
    expect(traced).toEqual({ design: "a.DSN", net_name: "GND", include_dns: false });
  });

  it("refuses to let a host change the shared annotations", () => {
    expect(() => {
      (READ_ONLY as { readOnlyHint: boolean }).readOnlyHint = false;
    }).toThrow(TypeError);
    expect(() => {
      (findTool("list_nets") as { annotations: unknown }).annotations = {};
    }).toThrow(TypeError);
    expect(findTool("list_nets")!.annotations.readOnlyHint).toBe(true);
  });

  it("parses raw arguments before running, and reports a refusal as an error result", async () => {
    expect(await callTool("list_designs", { search_path: "/tmp" })).toEqual({
      error: expect.stringContaining('Unrecognized key: "search_path"'),
    });
    expect(await callTool("query_component", { refdes: "U1" })).toEqual({
      error: expect.stringMatching(/Invalid arguments for query_component:[\s\S]*design/),
    });
    expect(await callTool("list_designs", { max_results: 0 })).toEqual({
      error: expect.stringContaining("max_results"),
    });
    expect(await callTool("no_such_tool")).toEqual({
      error: expect.stringContaining("Unknown tool 'no_such_tool'"),
    });
  });

  it("runs a tool whose arguments parse", async () => {
    const result = (await callTool("list_designs", { path: "/nonexistent-on-purpose" })) as {
      error?: string;
    };
    expect(result.error).toContain("Failed to search");
  });

  it("loads neither the MCP SDK nor OpenTelemetry, and neither does ./service", () => {
    // The walk sees both packages from the server, so an empty list below means
    // the registry really reaches neither.
    const server = importGraph(path.resolve(__dirname, "../server.ts")).packages;
    expect(server).toContain("@modelcontextprotocol/sdk");
    expect([...server].some((name) => name.startsWith("@opentelemetry/"))).toBe(true);

    for (const entry of ["index.ts", "../service/index.ts"]) {
      const { files, packages } = importGraph(path.resolve(__dirname, entry));
      expect(files, entry).toContain(path.resolve(__dirname, "../service/load-netlist.ts"));
      const heavy = [...packages].filter(
        (name) => name === "@modelcontextprotocol/sdk" || name.startsWith("@opentelemetry/")
      );
      expect(heavy, entry).toEqual([]);
    }
  });
});
