/**
 * Tests for executable detection.
 *
 * `isCompiledBinary` gates self-update: only the Bun-compiled standalone binary
 * may update itself. Running from source (tsx/node) or via the bun interpreter
 * must report false so it never downloads and re-execs a binary.
 */

import { describe, it, expect, afterEach } from "vitest";
import { isCompiledBinary, getCurrentExecutablePath } from "./executable.js";

const ORIGINAL_EXEC_PATH = process.execPath;
const ORIGINAL_ARGV1 = process.argv[1];

const setExecPath = (value: string): void => {
  Object.defineProperty(process, "execPath", { value, configurable: true });
};

afterEach(() => {
  Object.defineProperty(process, "execPath", { value: ORIGINAL_EXEC_PATH, configurable: true });
  process.argv[1] = ORIGINAL_ARGV1;
});

describe("isCompiledBinary", () => {
  it("is false when running via the node interpreter (e.g. tsx src/index.ts)", () => {
    setExecPath("/usr/local/bin/node");
    expect(isCompiledBinary()).toBe(false);
  });

  it("is false when running via the bun interpreter", () => {
    setExecPath("/Users/me/.bun/bin/bun");
    expect(isCompiledBinary()).toBe(false);
  });

  it("is true when execPath is the standalone binary itself", () => {
    setExecPath("/Users/me/Library/Application Support/universal-netlist/bin/universal-netlist");
    expect(isCompiledBinary()).toBe(true);
  });
});

describe("getCurrentExecutablePath", () => {
  it("returns argv[1] (the script) when running under an interpreter", () => {
    setExecPath("/usr/local/bin/node");
    process.argv[1] = "/repo/src/index.ts";
    expect(getCurrentExecutablePath()).toBe("/repo/src/index.ts");
  });

  it("returns execPath (the binary) for a compiled binary", () => {
    const bin = "/opt/universal-netlist/bin/universal-netlist";
    setExecPath(bin);
    expect(getCurrentExecutablePath()).toBe(bin);
  });
});
