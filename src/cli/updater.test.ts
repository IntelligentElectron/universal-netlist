/**
 * Tests for the auto-update startup guard.
 *
 * Regression: running from source (tsx/node) used to fall through the
 * npm-install guard and perform a live GitHub update check, which could
 * download a binary and re-exec into it. `autoUpdate` must now no-op (and
 * touch the network) only for the compiled standalone binary.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { autoUpdate } from "./updater.js";

const ORIGINAL_EXEC_PATH = process.execPath;
const ORIGINAL_ARGV1 = process.argv[1];

const setExecPath = (value: string): void => {
  Object.defineProperty(process, "execPath", { value, configurable: true });
};

afterEach(() => {
  Object.defineProperty(process, "execPath", { value: ORIGINAL_EXEC_PATH, configurable: true });
  process.argv[1] = ORIGINAL_ARGV1;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("autoUpdate self-update guard", () => {
  it("returns false and performs no network call when running from source (tsx/node)", async () => {
    setExecPath("/usr/local/bin/node");
    // argv[1] is the source entry, NOT a node_modules path: this isolates the
    // isCompiledBinary guard from the separate npm-install guard.
    process.argv[1] = "/Users/me/Developer/universal-netlist/src/index.ts";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const updated = await autoUpdate();

    expect(updated).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reaches the network update check only when running as the compiled binary", async () => {
    // execPath is the binary itself, and argv[1] is not an npm-install path.
    const bin = "/Users/me/Library/Application Support/universal-netlist/bin/universal-netlist";
    setExecPath(bin);
    process.argv[1] = bin;
    const fetchSpy = vi.fn().mockRejectedValue(new Error("network disabled in test"));
    vi.stubGlobal("fetch", fetchSpy);

    const updated = await autoUpdate();

    // The network call failed, so no update is applied, but the guard let it
    // get as far as fetch (proving the guard, not luck, is what gates updates).
    expect(updated).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("autoUpdate on a packaged build", () => {
  afterEach(() => {
    vi.doUnmock("../build-flags.js");
    vi.resetModules();
  });

  it("returns false and performs no network call even as the compiled binary", async () => {
    // Every other guard is satisfied: this is the compiled binary, installed
    // outside node_modules. Only the build channel stops it.
    const bin = "/opt/homebrew/bin/universal-netlist";
    setExecPath(bin);
    process.argv[1] = bin;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    vi.doMock("../build-flags.js", () => ({ CHANNEL: "packaged", SELF_UPDATE_ENABLED: false }));
    vi.resetModules();
    const { autoUpdate: packagedAutoUpdate } = await import("./updater.js");

    const updated = await packagedAutoUpdate();

    expect(updated).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
