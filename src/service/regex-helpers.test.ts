import { describe, it, expect } from "vitest";
import { parseRegexPattern } from "./regex-helpers.js";

describe("parseRegexPattern", () => {
  it("returns regex for plain pattern with no flags", () => {
    const result = parseRegexPattern("foo");
    expect("regex" in result).toBe(true);
    if ("regex" in result) {
      expect(result.regex.source).toBe("foo");
      expect(result.regex.flags).toBe("");
    }
  });

  it("applies default flags when no inline flags present", () => {
    const result = parseRegexPattern("foo", "i");
    expect("regex" in result).toBe(true);
    if ("regex" in result) {
      expect(result.regex.flags).toBe("i");
    }
  });

  it("strips (?i) and applies i flag", () => {
    const result = parseRegexPattern("(?i)vdd");
    expect("regex" in result).toBe(true);
    if ("regex" in result) {
      expect(result.regex.source).toBe("vdd");
      expect(result.regex.flags).toBe("i");
    }
  });

  it("strips (?m) and applies m flag", () => {
    const result = parseRegexPattern("(?m)^line");
    expect("regex" in result).toBe(true);
    if ("regex" in result) {
      expect(result.regex.source).toBe("^line");
      expect(result.regex.flags).toBe("m");
    }
  });

  it("strips combined (?im) flags", () => {
    const result = parseRegexPattern("(?im)pattern");
    expect("regex" in result).toBe(true);
    if ("regex" in result) {
      expect(result.regex.source).toBe("pattern");
      expect(result.regex.flags).toContain("i");
      expect(result.regex.flags).toContain("m");
    }
  });

  it("deduplicates when inline flag matches default", () => {
    const result = parseRegexPattern("(?i)test", "i");
    expect("regex" in result).toBe(true);
    if ("regex" in result) {
      expect(result.regex.flags).toBe("i");
    }
  });

  it("merges inline flags with different defaults", () => {
    const result = parseRegexPattern("(?m)test", "i");
    expect("regex" in result).toBe(true);
    if ("regex" in result) {
      expect(result.regex.flags).toContain("i");
      expect(result.regex.flags).toContain("m");
    }
  });

  it("returns error for (?i) in the middle of pattern", () => {
    const result = parseRegexPattern("foo(?i)bar");
    expect("error" in result).toBe(true);
  });

  it("does not strip scoped group (?i:...)", () => {
    const result = parseRegexPattern("(?i:foo)bar");
    // On Node v25+ the scoped modifier (?i:...) is valid RegExp syntax.
    // On older engines it throws. Either way, the prefix must NOT be stripped.
    if ("regex" in result) {
      expect(result.regex.source).toContain("(?i:foo)");
      expect(result.regex.test("FOObar")).toBe(true);
      expect(result.regex.test("fooBAR")).toBe(false);
    } else {
      expect(result.error).toContain("Invalid regex pattern");
    }
  });

  it("returns error for invalid regex after flag stripping", () => {
    const result = parseRegexPattern("(?i)[unclosed");
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("Invalid regex pattern");
    }
  });

  it("(?i)vdd matches VDD_1V8", () => {
    const result = parseRegexPattern("(?i)vdd");
    expect("regex" in result).toBe(true);
    if ("regex" in result) {
      expect(result.regex.test("VDD_1V8")).toBe(true);
    }
  });

  it("plain vdd does NOT match VDD_1V8", () => {
    const result = parseRegexPattern("vdd");
    expect("regex" in result).toBe(true);
    if ("regex" in result) {
      expect(result.regex.test("VDD_1V8")).toBe(false);
    }
  });
});
