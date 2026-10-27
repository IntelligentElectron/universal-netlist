import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TOOLS } from "../tools/index.js";
import { SKILL_PATH, renderSkill } from "./skill.js";

const committed = () => readFileSync(path.resolve(__dirname, "../..", SKILL_PATH), "utf-8");

describe("agent skill", () => {
  it("is the registry's current rendering; run `npm run gen:skill` after changing a tool", () => {
    expect(committed()).toBe(renderSkill());
  });

  it("documents every tool this build offers, with its description and flags", () => {
    const skill = renderSkill();
    for (const tool of TOOLS) {
      expect(skill).toContain(`### ${tool.name}\n\n`);
      // Each description's first sentence, which names no MCP argument syntax.
      expect(skill).toContain(tool.description.split(/[.:]/)[0]);
    }
    expect(skill).toContain("`--net_name`");
    expect(skill).not.toMatch(/export_cadence_netlist|\bDAT\b|pstxnet/);
    // Arguments are spelled as flags, never as MCP's name=value.
    expect(skill).not.toMatch(/(?<!--)\binclude_dns=(true|false)/);
  });

  it("starts with the frontmatter an agent reads to decide when to load it", () => {
    expect(renderSkill()).toMatch(/^---\nname: universal-netlist\ndescription: .+\n---\n/);
  });
});
