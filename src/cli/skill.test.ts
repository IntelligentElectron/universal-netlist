import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TOOLS } from "../tools/index.js";
import { SKILL_PATH, TOOLS_REFERENCE_PATH, renderSkill, renderToolsReference } from "./skill.js";

const committed = (relative: string) =>
  readFileSync(path.resolve(__dirname, "../..", relative), "utf-8");

/** The YAML frontmatter's fields, one `key: value` per line. */
const frontmatter = (skill: string): Record<string, string> => {
  const block = /^---\n([\s\S]*?)\n---\n/.exec(skill)?.[1] ?? "";
  return Object.fromEntries(
    block
      .split("\n")
      .map((line) => [line.slice(0, line.indexOf(":")), line.slice(line.indexOf(":") + 2)])
  );
};

describe("agent skill", () => {
  it("is the registry's current rendering; run `npm run gen:skill` after changing a tool", () => {
    expect(committed(SKILL_PATH)).toBe(renderSkill());
    expect(committed(TOOLS_REFERENCE_PATH)).toBe(renderToolsReference());
  });

  it("meets the Agent Skills specification's frontmatter rules", () => {
    const fields = frontmatter(renderSkill());
    // https://agentskills.io/specification
    expect(fields.name).toBe(path.basename(path.dirname(SKILL_PATH)));
    expect(fields.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(fields.description.length).toBeGreaterThan(0);
    expect(fields.description.length).toBeLessThanOrEqual(1024);
    expect(fields.compatibility.length).toBeLessThanOrEqual(500);
    expect(Object.keys(fields).sort()).toEqual(["compatibility", "description", "license", "name"]);
  });

  it("stays short, and leaves each tool's detail to the reference", () => {
    const skill = renderSkill();
    expect(skill.split("\n").length).toBeLessThan(500);
    for (const tool of TOOLS) expect(skill).toContain(`| \`${tool.name}\` | `);
    expect(skill).toContain("](references/tools.md)");
  });

  it("documents every tool this build offers in the reference, with its flags", () => {
    const reference = renderToolsReference();
    for (const tool of TOOLS) {
      expect(reference).toContain(`## ${tool.name}\n\n`);
      // Each description's first sentence, which names no MCP argument syntax.
      expect(reference).toContain(tool.description.split(/[.:]/)[0]);
    }
    expect(reference).toContain("`--net_name`");
    expect(reference + renderSkill()).not.toMatch(/export_cadence_netlist|\bDAT\b|pstxnet/);
    // Arguments are spelled as flags, never as MCP's name=value.
    expect(reference + renderSkill()).not.toMatch(/(?<!--)\binclude_dns=(true|false)/);
  });
});
