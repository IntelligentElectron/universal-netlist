/**
 * Claude Code cuts an MCP server's instructions and each tool description at a
 * length limit, without saying so, and Claude sees only the text before the cut.
 * Since v2.1.296 the limit is 4096 characters for the instructions and for a tool
 * loaded upfront; tool search matches only the first 4096 characters of a tool it
 * loads (https://code.claude.com/docs/en/mcp). Before v2.1.296 the limit was 2048.
 *
 * Every description is held to 2048 here, so an older Claude Code still shows it
 * in full and tool search matches all of it. A sentence past the cut is written
 * for nobody.
 */

import { describe, expect, it } from "vitest";
import * as descriptions from "./descriptions.js";

const LIMIT = 2048;

describe("description lengths", () => {
  for (const [name, text] of Object.entries(descriptions)) {
    if (typeof text !== "string") continue;
    it(`${name} fits in ${LIMIT} characters`, () => {
      expect(text.length).toBeLessThanOrEqual(LIMIT);
    });
  }
});
