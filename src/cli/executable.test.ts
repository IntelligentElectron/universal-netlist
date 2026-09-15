/**
 * Tests for executable detection.
 *
 * `isCompiledBinary` gates self-update and uninstall: only the standalone binary, which
 * the build script compiles with `BUILD_VERSION` defined, may replace or remove itself.
 * An interpreter never is, whatever its executable is called.
 */

import { describe, it, expect, afterEach, vi } from "vitest";

const ORIGINAL_EXEC_PATH = process.execPath;
const ORIGINAL_ARGV1 = process.argv[1];

const setExecPath = (value: string): void => {
  Object.defineProperty(process, "execPath", { value, configurable: true });
};

/** Load executable.js as a compiled binary or an interpreter run. */
const load = async (compiled: boolean): Promise<typeof import("./executable.js")> => {
  vi.doMock("../build-flags.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../build-flags.js")>()),
    COMPILED_BINARY: compiled,
  }));
  vi.resetModules();
  return import("./executable.js");
};

afterEach(() => {
  Object.defineProperty(process, "execPath", { value: ORIGINAL_EXEC_PATH, configurable: true });
  process.argv[1] = ORIGINAL_ARGV1;
  vi.doUnmock("../build-flags.js");
  vi.resetModules();
});

describe("isCompiledBinary", () => {
  it("is false without the build define, whatever the interpreter is called", async () => {
    const { isCompiledBinary } = await import("./executable.js");
    for (const path of ["/usr/local/bin/node", "/Users/me/.bun/bin/bun", "/opt/rt/bin/js"]) {
      setExecPath(path);
      expect(isCompiledBinary()).toBe(false);
    }
  });

  it("is true for the compiled binary, whatever directory holds it", async () => {
    const { isCompiledBinary } = await load(true);
    setExecPath("/home/ubuntu/.local/share/universal-netlist/bin/universal-netlist");
    expect(isCompiledBinary()).toBe(true);
  });
});

describe("getCurrentExecutablePath", () => {
  it("returns argv[1] (the script) when running under an interpreter", async () => {
    const { getCurrentExecutablePath } = await load(false);
    setExecPath("/opt/rt/bin/js");
    process.argv[1] = "/repo/src/index.ts";
    expect(getCurrentExecutablePath()).toBe("/repo/src/index.ts");
  });

  it("returns execPath (the binary) for a compiled binary", async () => {
    const { getCurrentExecutablePath } = await load(true);
    const bin = "/opt/universal-netlist/bin/universal-netlist";
    setExecPath(bin);
    expect(getCurrentExecutablePath()).toBe(bin);
  });
});
