import { describe, it, expect } from "vitest";
import { parseSexpr, tag, childByTag, childrenByTag, childString, hasChild } from "./sexpr.js";

describe("parseSexpr", () => {
  it("parses a simple list", () => {
    expect(parseSexpr("(ref \"C1\")")).toEqual([["ref", "C1"]]);
  });

  it("parses nested lists and bare atoms", () => {
    expect(parseSexpr("(comp (ref \"R1\") (value \"10k\"))")).toEqual([
      ["comp", ["ref", "R1"], ["value", "10k"]],
    ]);
  });

  it("treats the head as a bare atom and quoted args as strings", () => {
    const [node] = parseSexpr('(pin passive line)');
    expect(node).toEqual(["pin", "passive", "line"]);
  });

  it("handles a field with a trailing bare string value", () => {
    expect(parseSexpr('(field (name "Rating") "25V")')).toEqual([
      ["field", ["name", "Rating"], "25V"],
    ]);
  });

  it("handles a marker child with no value (e.g. dnp)", () => {
    expect(parseSexpr('(property (name "dnp"))')).toEqual([["property", ["name", "dnp"]]]);
  });

  it("decodes escaped quotes and backslashes inside strings", () => {
    expect(parseSexpr('(value "a\\"b\\\\c")')).toEqual([["value", 'a"b\\c']]);
  });

  it("preserves KiCad overbar/subscript notation verbatim", () => {
    expect(parseSexpr('(pinfunction "~{RESET}")')).toEqual([["pinfunction", "~{RESET}"]]);
  });

  it("tolerates extra whitespace and newlines", () => {
    expect(parseSexpr("(a\n\t(b  \"c\")\n)")).toEqual([["a", ["b", "c"]]]);
  });

  it("throws on unbalanced parentheses", () => {
    expect(() => parseSexpr("(a (b)")).toThrow();
    expect(() => parseSexpr("(a))")).toThrow();
  });

  it("throws on an unterminated quoted string (e.g. truncated file)", () => {
    expect(() => parseSexpr('(value "abc')).toThrow(/unterminated/i);
  });
});

describe("accessors", () => {
  const [comp] = parseSexpr(`
    (comp
      (ref "U1")
      (value "LM358")
      (property (name "MPN") (value "LM358-X"))
      (property (name "dnp"))
      (node (ref "U1") (pin "1")))
  `);

  it("tag returns the list head", () => {
    expect(tag(comp)).toBe("comp");
    expect(tag("atom")).toBeUndefined();
  });

  it("childString reads the first string arg of a tagged child", () => {
    expect(childString(comp, "ref")).toBe("U1");
    expect(childString(comp, "value")).toBe("LM358");
    expect(childString(comp, "missing")).toBeUndefined();
  });

  it("childByTag / childrenByTag find tagged children", () => {
    expect(childrenByTag(comp, "property")).toHaveLength(2);
    expect(childString(childByTag(comp, "property"), "name")).toBe("MPN");
  });

  it("hasChild detects marker presence", () => {
    const dnp = childrenByTag(comp, "property").find((p) => childString(p, "name") === "dnp");
    expect(dnp).toBeDefined();
    expect(hasChild(comp, "value")).toBe(true);
    expect(hasChild(comp, "footprint")).toBe(false);
  });
});
