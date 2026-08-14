/**
 * Tests for what the build channel changes about the CLI commands.
 *
 * A packaged build (`BUILD_CHANNEL=packaged`) is owned by the package manager
 * that installed it, so `--update` and `--uninstall` explain that instead of
 * touching the install, and the help text drops the install.sh line.
 */

import { describe, it, expect, afterEach, vi } from "vitest";

/** Load commands.js as a packaged build. */
const loadPackagedCommands = async (): Promise<typeof import("./commands.js")> => {
  vi.doMock("../build-flags.js", () => ({ CHANNEL: "packaged", SELF_UPDATE_ENABLED: false }));
  vi.resetModules();
  return import("./commands.js");
};

const captureStdout = (): { lines: string[]; restore: () => void } => {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.join(" "));
  });
  return { lines, restore: () => spy.mockRestore() };
};

afterEach(() => {
  vi.doUnmock("../build-flags.js");
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("printHelp", () => {
  it("prints the install.sh line on the default (github) channel", async () => {
    const { printHelp } = await import("./commands.js");
    const out = captureStdout();

    printHelp();

    out.restore();
    expect(out.lines.join("\n")).toContain("install.sh | bash");
  });

  it("points at the package manager instead on a packaged build", async () => {
    const { printHelp } = await loadPackagedCommands();
    const out = captureStdout();

    printHelp();

    out.restore();
    const text = out.lines.join("\n");
    expect(text).not.toContain("install.sh");
    expect(text).toContain("package manager");
  });
});

describe("handleUpdateCommand on a packaged build", () => {
  it("explains the install is managed elsewhere and performs no network call", async () => {
    const { handleUpdateCommand } = await loadPackagedCommands();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const out = captureStdout();

    await handleUpdateCommand();

    out.restore();
    expect(out.lines.join("\n")).toContain("package manager");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("handleUninstallCommand on a packaged build", () => {
  it("removes nothing and never prompts", async () => {
    const confirmSpy = vi.fn();
    const removeFromPathSpy = vi.fn();
    const rmSyncSpy = vi.fn();
    vi.doMock("./prompts.js", () => ({ confirm: confirmSpy }));
    vi.doMock("./shell.js", () => ({ removeFromPath: removeFromPathSpy }));
    vi.doMock("node:fs", async (importOriginal) => ({
      ...(await importOriginal<typeof import("node:fs")>()),
      rmSync: rmSyncSpy,
    }));
    const { handleUninstallCommand } = await loadPackagedCommands();
    const out = captureStdout();

    await handleUninstallCommand();

    out.restore();
    vi.doUnmock("./prompts.js");
    vi.doUnmock("./shell.js");
    vi.doUnmock("node:fs");

    expect(out.lines.join("\n")).toContain("package manager");
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(removeFromPathSpy).not.toHaveBeenCalled();
    expect(rmSyncSpy).not.toHaveBeenCalled();
  });
});
