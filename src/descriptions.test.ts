/**
 * Claude Code cuts an MCP server's instructions and each tool description at a
 * length limit, without saying so, and Claude sees only the text before the cut.
 * Since v2.1.296 the limit is 4096 characters for the instructions and for a tool
 * loaded upfront; tool search matches only the first 4096 characters of a tool it
 * loads (https://code.claude.com/docs/en/mcp). From v2.1.295 the limit was 2048
 * for the instructions and for a tool loaded upfront, and before v2.1.295 it was
 * 2048 for every tool description, including one loaded through tool search.
 *
 * Every description is held to 2048 here, so an older Claude Code still shows it
 * in full and tool search matches all of it. A sentence past the cut is written
 * for nobody. The registry is checked as well as this module's exports, so a tool
 * whose description is written or extended in the registry is held to the limit.
 */

import { describe, expect, it } from "vitest";
import * as descriptions from "./descriptions.js";
import { TOOLS } from "./tools/index.js";

const LIMIT = 2048;

describe("description lengths", () => {
  for (const [name, text] of Object.entries(descriptions)) {
    if (typeof text !== "string") continue;
    it(`${name} fits in ${LIMIT} characters`, () => {
      expect(text.length).toBeLessThanOrEqual(LIMIT);
    });
  }

  for (const tool of TOOLS) {
    it(`registered tool ${tool.name} fits in ${LIMIT} characters`, () => {
      expect(tool.description.length).toBeLessThanOrEqual(LIMIT);
    });
  }
});
