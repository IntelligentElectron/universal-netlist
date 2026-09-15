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

  it.each([
    [
      "Password-protected OrCAD design: set UNIVERSAL_NETLIST_DSN_PASSWORD or UNIVERSAL_NETLIST_DSN_PASSWORD_FILE",
      "permission_denied",
    ],
    [
      "No password in UNIVERSAL_NETLIST_DSN_PASSWORD or UNIVERSAL_NETLIST_DSN_PASSWORD_FILE opens this OrCAD design",
      "permission_denied",
    ],
    [
      "Cannot read UNIVERSAL_NETLIST_DSN_PASSWORD_FILE: ENOENT: no such file or directory, open '/p.txt'",
      "not_found",
    ],
    [
      "Stream 'Views/A/Hierarchy' is encrypted in a format other than SYENCRYPT01",
      "invalid_argument",
    ],
    ["Protected OrCAD design has no encrypted Library stream", "invalid_argument"],
    [
      "Design 'A.DSN' defines design variants ['Standard']. Pass design_variant='<Default>' (alias 'default') for the unmodified/core design, or one of those names. list_designs() reports them under design_variants.",
      "invalid_argument",
    ],
    [
      "Design variant 'Nope' not found for design 'A.DSN'. Available: ['Standard', '<Default>'].",
      "not_found",
    ],
    ["Design variant 'Nope' not found. Available: ['Standard']", "not_found"],
    ["Missing required parameter: type", "invalid_argument"],
    ["MCP error -32602: Tool list_variants not found", "not_found"],
    [
      'No netlist for A.kicad_pro. Expected a committed "A.net" beside the project, or a root .kicad_sch plus an installed kicad-cli (set KICAD_CLI_PATH if KiCad is in a non-standard location).',
      "not_found",
    ],
    [
      'kicad-cli not found at KICAD_CLI_PATH="/opt/kicad-cli". Unset it or point it at a valid kicad-cli binary.',
      "unavailable",
    ],
    [
      "kicad-cli netlist export failed for /d/A.kicad_sch: Command failed: kicad-cli sch export netlist",
      "unavailable",
    ],
    [
      "kicad-cli netlist export failed for /d/A.kicad_sch: Command failed (timed out after 120000ms; raise KICAD_CLI_TIMEOUT for very large designs)",
      "timeout",
    ],
    ["A.netlist.json: not valid JSON (Unexpected end of JSON input)", "invalid_argument"],
    ["A.netlist.json: a net has an empty name", "invalid_argument"],
    ["A.netlist.json: net 'VCC' lists R1.1 twice", "invalid_argument"],
    ["A.netlist.json: R1.1 is on 'VCC', but no net 'VCC' is declared", "invalid_argument"],
    ["Sector chain too long, possible corruption", "invalid_argument"],
    ["String length 512 exceeds limit of 400 at offset 1024", "invalid_argument"],
    ["A.netlist.json: net 'TIMEOUT' lists R1.1 twice", "invalid_argument"],
    ["timeout.netlist.json: unexpected component key 'forbidden'", "invalid_argument"],
    [
      "Design 'A.PrjPcb' defines design variants ['Timeout Test']. Pass design_variant='<Default>'",
      "invalid_argument",
    ],
    ["Net 'CANCELLED' not found in design 'A'.", "not_found"],
    [
      "Failed to search '/Users/o'brien/x': ENOENT: no such file or directory, scandir '/Users/o'brien/x'",
      "not_found",
    ],
    [
      "Failed to search '/Volumes/Bob's Share/Invalid Boards': EPERM: operation not permitted, scandir '/Volumes/Bob's Share/Invalid Boards'",
      "permission_denied",
    ],
    [
      "Failed to search '/Volumes/Bob's Share/Expected': ETIMEDOUT: connection timed out, scandir '/Volumes/Bob's Share/Expected'",
      "timeout",
    ],
    [
      "Could not create the netlist output directory beside O'Brien.DSN: EACCES: permission denied, mkdir 'C:\\Needs Review\\allegro'.",
      "permission_denied",
    ],
    [
      "Design variant 'Bob's Build' needs the root .kicad_sch beside O'Brien.kicad_pro, which was not found.",
      "invalid_argument",
    ],
    ["O'Brien.netlist.json: net 'TIMEOUT' lists R1.1 twice", "invalid_argument"],
    [
      "Design 'A.PrjPcb' defines design variants ['Bob's Build', 'Timeout Test']. Pass design_variant='<Default>'",
      "invalid_argument",
    ],
    [
      "Failed to search '/Users/me/Chris' Projects/Cancelled (old)': EPERM: operation not permitted, scandir '/Users/me/Chris' Projects/Cancelled (old)'",
      "permission_denied",
    ],
    [
      "Failed to search '/Volumes/Share/Invalid Boards/Rev B (Jess')': ETIMEDOUT: connection timed out, scandir '/Volumes/Share/Invalid Boards/Rev B (Jess')'",
      "timeout",
    ],
    [
      "Failed to search '/data/Timeout/Designs '24'': ENOENT: no such file or directory, scandir '/data/Timeout/Designs '24''",
      "not_found",
    ],
    [
      "kicad-cli netlist export failed for /d/A.kicad_sch: ENOENT: no such file or directory, open '/tmp/kicad-netlist-a/netlist.net'",
      "unavailable",
    ],
    [
      `board.netlist.json: not valid JSON (Unexpected token 'E', "ENOENT: no"... is not valid JSON)`,
      "invalid_argument",
    ],
    [
      `board.netlist.json: not valid JSON (Unexpected token 'E', "EACCES: pe"... is not valid JSON)`,
      "invalid_argument",
    ],
    ["Invalid regex pattern 'ENOENT: ('", "invalid_argument"],
    ["Net 'ETIMEDOUT: x' not found in design 'A'.", "not_found"],
    [
      "Failed to search '/data/ENOENT: old': EACCES: permission denied, scandir '/data/ENOENT: old'",
      "permission_denied",
    ],
    [
      'No netlist for watchdog-timeout.kicad_pro. Expected a committed "watchdog-timeout.net" beside the project, or a root .kicad_sch plus an installed kicad-cli (set KICAD_CLI_PATH if KiCad is in a non-standard location).',
      "not_found",
    ],
    [
      "No schematic documents found for project /Users/me/Projects/Cancelled/Board.PrjPcb",
      "invalid_argument",
    ],
    [
      "Design variant 'Lite' needs the root .kicad_sch beside watchdog-timeout.kicad_pro, which was not found.",
      "invalid_argument",
    ],
    ["MCP error -32602: Tool timeout not found", "not_found"],
    [
      "Unknown rule id(s): timeout. Valid ids: net.single_pin, net.testpoint_orphan",
      "invalid_argument",
    ],
    ["ENOTDIR: not a directory, scandir '/d/board.txt'", "not_found"],
    ["Attempt to access memory outside buffer bounds", "invalid_argument"],
    ['"offset" is outside of buffer bounds', "invalid_argument"],
    ["Offset is outside the bounds of the DataView", "invalid_argument"],
    [
      "Cannot read UNIVERSAL_NETLIST_DSN_PASSWORD_FILE: EISDIR: illegal operation on a directory, read",
      "invalid_argument",
    ],
    ["No Universal Netlist codec is registered for current schema version 3", "internal"],
  ] as const)("classifies the design failure %s as %s", (message, expected) => {
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
