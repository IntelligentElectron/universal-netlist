/**
 * Write the agent skill for the query command line from the tool registry.
 *
 *   npm run gen:skill
 *
 * src/cli/skill.test.ts fails while the committed skill differs from this
 * output, so run this after changing a tool's description or arguments.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { SKILL_PATH, renderSkill } from "../src/cli/skill.js";

const target = path.resolve(import.meta.dirname, "..", SKILL_PATH);
writeFileSync(target, renderSkill());
console.log(`Wrote ${path.relative(process.cwd(), target)}`);
