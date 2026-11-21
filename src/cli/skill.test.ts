import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TOOLS } from "../tools/index.js";
import { SHARED_FLAGS, SKILL_DIR, SKILL_PATH, renderSkill } from "./skill.js";
import { flagsOf } from "./query.js";

const committed = (relative: string) =>
  readFileSync(path.resolve(__dirname, "../..", relative), "utf-8");

/**
 * The YAML frontmatter's fields, one `key: value` per line. Each value must be
 * a JSON string, a YAML double-quoted scalar, so a strict YAML reader takes it
 * whatever punctuation it holds; JSON.parse throws on any other.
 */
const frontmatter = (skill: string): Record<string, string> => {
  const block = /^---\n([\s\S]*?)\n---\n/.exec(skill)?.[1] ?? "";
  return Object.fromEntries(
    block.split("\n").map((line) => {
      const colon = line.indexOf(": ");
      return [line.slice(0, colon), JSON.parse(line.slice(colon + 2)) as string];
    })
  );
};

describe("agent skill", () => {
  it("is the registry's current rendering; run `npm run gen:skill` after changing a tool", () => {
    expect(committed(SKILL_PATH)).toBe(renderSkill());
  });

  it("is a single file, with no separate reference for an agent to miss", () => {
    expect(existsSync(path.resolve(__dirname, "../..", SKILL_DIR, "references"))).toBe(false);
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

  it("stays within the specification's length, and documents every tool with its flags", () => {
    const skill = renderSkill();
    // https://agentskills.io/specification recommends under 500 lines.
    expect(skill.split("\n").length).toBeLessThan(500);
    for (const tool of TOOLS) {
      expect(skill).toContain(`### ${tool.name}\n\n`);
      // Each description's first sentence, which names no MCP argument syntax.
      expect(skill).toContain(tool.description.split(/[.:]/)[0]);
    }
    expect(skill).toContain("`--net_name`");
    // The shared flags are described once: every tool but list_designs takes a required
    // design, and a tool without design_variant is named where the flags are described.
    const sharedIntro = skill.split("\n").find((line) => line.includes("also takes `--design`"));
    for (const tool of TOOLS.filter((t) => t.name !== "list_designs")) {
      const names = flagsOf(tool).map((flag) => flag.name);
      expect(flagsOf(tool).find((flag) => flag.name === "design")?.required, tool.name).toBe(true);
      for (const shared of SHARED_FLAGS) {
        if (!names.includes(shared)) expect(sharedIntro, tool.name).toContain(`\`${tool.name}\``);
      }
    }
    expect(skill).not.toMatch(/export_cadence_netlist|\bDAT\b|pstxnet/);
    // Arguments are spelled as flags, never as MCP's name=value.
    expect(skill).not.toMatch(/(?<!--)\binclude_dns=(true|false)/);
  });
});
