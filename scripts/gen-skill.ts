/**
 * Write the agent skill for the query command line from the tool registry:
 * SKILL.md and the tool reference beside it.
 *
 *   npm run gen:skill
 *
 * src/cli/skill.test.ts fails while the committed files differ from this
 * output, so run this after changing a tool's description or arguments.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  SKILL_PATH,
  TOOLS_REFERENCE_PATH,
  renderSkill,
  renderToolsReference,
} from "../src/cli/skill.js";

const root = path.resolve(import.meta.dirname, "..");
for (const [relative, content] of [
  [SKILL_PATH, renderSkill()],
  [TOOLS_REFERENCE_PATH, renderToolsReference()],
] as const) {
  const target = path.join(root, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
  console.log(`Wrote ${relative}`);
}
