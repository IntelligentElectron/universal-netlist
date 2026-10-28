/**
 * The agent plugin's manifests, one per harness, must agree on the plugin and
 * where it lives: a marketplace entry named apart from the plugin's own
 * manifest fails to install in Claude Code, and a source path that moved fails
 * in every harness. See plugins/universal-netlist and the README's Install
 * section.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SKILL_PATH } from "./skill.js";

const ROOT = path.resolve(__dirname, "../..");
const read = (relative: string) =>
  JSON.parse(readFileSync(path.join(ROOT, relative), "utf-8")) as Record<string, unknown>;

const NAME = "universal-netlist";
const PLUGIN_DIR = "plugins/universal-netlist";

describe("agent plugin manifests", () => {
  it("name the plugin the same everywhere", () => {
    const claudeMarketplace = read(".claude-plugin/marketplace.json") as {
      name: string;
      plugins: { name: string }[];
    };
    const codexMarketplace = read(".agents/plugins/marketplace.json") as {
      name: string;
      plugins: { name: string }[];
    };
    const cursorMarketplace = read(".cursor-plugin/marketplace.json") as {
      name: string;
      plugins: { name: string }[];
    };
    for (const marketplace of [claudeMarketplace, codexMarketplace, cursorMarketplace]) {
      expect(marketplace.name).toBe(NAME);
      expect(marketplace.plugins.map((plugin) => plugin.name)).toEqual([NAME]);
    }
    expect(read(`${PLUGIN_DIR}/.claude-plugin/plugin.json`).name).toBe(NAME);
    expect(read(`${PLUGIN_DIR}/plugin.json`).name).toBe(NAME);
  });

  it("point every marketplace at the plugin's directory, which holds the skill", () => {
    const sources = [
      (read(".claude-plugin/marketplace.json") as { plugins: { source: string }[] }).plugins[0]
        .source,
      (read(".agents/plugins/marketplace.json") as { plugins: { source: { path: string } }[] })
        .plugins[0].source.path,
      (read(".cursor-plugin/marketplace.json") as { plugins: { source: string }[] }).plugins[0]
        .source,
    ];
    for (const source of sources) expect(path.normalize(source)).toBe(path.normalize(PLUGIN_DIR));
    expect(SKILL_PATH.startsWith(`${PLUGIN_DIR}/skills/${NAME}/`)).toBe(true);
    expect(existsSync(path.join(ROOT, SKILL_PATH))).toBe(true);
  });

  it("pin no version, so installs follow the skill as the tools change", () => {
    expect(read(`${PLUGIN_DIR}/.claude-plugin/plugin.json`)).not.toHaveProperty("version");
    expect(read(`${PLUGIN_DIR}/plugin.json`)).not.toHaveProperty("version");
  });

  it("connect the MCP server by running the installed binary, the same way in every format", () => {
    // .mcp.json is Claude Code's (also read by Devin and Factory), mcp.json the
    // Agent Plugins one (Codex, Copilot, Cursor, Kiro), and mcp_config.json
    // Antigravity's. Each starts the binary from PATH under one name, so a
    // harness that reads more than one still sees one server.
    const claude = read(`${PLUGIN_DIR}/.mcp.json`) as {
      mcpServers: Record<string, { command: string; args?: string[] }>;
    };
    expect(read(`${PLUGIN_DIR}/mcp_config.json`)).toEqual(claude);
    const portable = read(`${PLUGIN_DIR}/mcp.json`) as {
      $schema: string;
      mcpServers: Record<string, { type: string; command: string; args?: string[] }>;
    };
    expect(portable.$schema).toBe("https://agent-plugins.org/schemas/1.0.0/mcp.schema.json");
    expect(claude.mcpServers).toEqual({ [NAME]: { command: NAME } });
    expect(portable.mcpServers).toEqual({ [NAME]: { type: "stdio", command: NAME } });
  });

  it("declare the Agent Plugins schema on the portable manifest", () => {
    expect(read(`${PLUGIN_DIR}/plugin.json`).$schema).toBe(
      "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json"
    );
  });
});
