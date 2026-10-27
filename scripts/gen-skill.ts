/**
 * Write the agent skill for the query command line from the tool registry:
 * one SKILL.md with the usage and every tool's description and flags.
 *
 *   npm run gen:skill
 *
 * src/cli/skill.test.ts fails while the committed file differs from this
 * output, so run this after changing a tool's description or arguments.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SKILL_PATH, renderSkill } from "../src/cli/skill.js";

const root = path.resolve(import.meta.dirname, "..");
const target = path.join(root, SKILL_PATH);
mkdirSync(path.dirname(target), { recursive: true });
writeFileSync(target, renderSkill());
console.log(`Wrote ${SKILL_PATH}`);
