import { describe, expect, it } from "vitest";
import { classifyToolError, getErrorClass, TOOL_ERROR_TYPES } from "./error-category.js";

describe("classifyToolError", () => {
  it.each([
    ["Invalid regex pattern '[abc'", "invalid_argument"],
    ["Design file not found", "not_found"],
    ["EACCES: permission denied", "permission_denied"],
    ["stdout maxBuffer length exceeded", "resource_exhausted"],
    ["Operation cancelled", "cancelled"],
    ["Export timed out", "timeout"],
    ["connect ECONNREFUSED 127.0.0.1:4318", "unavailable"],
    ["The parser reached an impossible state", "internal"],
  ] as const)("classifies %s as %s", (message, expected) => {
    expect(classifyToolError(message)).toBe(expected);
  });

  it("uses stable Node error codes before message text", () => {
    const error = Object.assign(new Error("opaque dependency message"), { code: "ENOENT" });
    expect(classifyToolError(error)).toBe("not_found");
  });

  it("classifies thrown and returned forms of the same failure identically", () => {
    expect(classifyToolError(new Error("Design file not found"))).toBe("not_found");
    expect(classifyToolError("Design file not found")).toBe("not_found");
  });

  it("always returns a member of the documented closed set", () => {
    const unstringifiable = Object.create(null);
    expect(TOOL_ERROR_TYPES).toContain(classifyToolError(unstringifiable));
  });
});

describe("getErrorClass", () => {
  it("keeps thrown exception classes separate from the category", () => {
    expect(getErrorClass(new TypeError("boom"))).toBe("TypeError");
    expect(getErrorClass("boom")).toBeUndefined();
  });
});
