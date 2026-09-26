/**
 * Claude Code shows at most 2048 characters of an MCP server's instructions and
 * of each tool description and cuts the rest off without saying so. A sentence
 * past that point is written for nobody, so every description is held under
 * the limit here.
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
