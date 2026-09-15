/**
 * Tests for what the build channel changes about the CLI commands.
 *
 * A packaged build (`BUILD_CHANNEL=packaged`) is owned by the package manager
 * that installed it, so `--update` and `--uninstall` explain that instead of
 * touching the install, and the help text drops the install.sh line.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

describe("handleUninstallCommand under Node.js", () => {
  it("points at npm and removes nothing, whatever directory holds the entry point", async () => {
    const confirmSpy = vi.fn();
    const removeFromPathSpy = vi.fn();
    vi.doMock("./prompts.js", () => ({ confirm: confirmSpy }));
    vi.doMock("./shell.js", () => ({ removeFromPath: removeFromPathSpy }));
    const { handleUninstallCommand } = await import("./commands.js");
    const out = captureStdout();

    await handleUninstallCommand();

    out.restore();
    vi.doUnmock("./prompts.js");
    vi.doUnmock("./shell.js");
    expect(out.lines.join("\n")).toContain(
      "npm uninstall -g @intelligentelectron/universal-netlist"
    );
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(removeFromPathSpy).not.toHaveBeenCalled();
  });
});

describe("handleUpdateCommand under Node.js", () => {
  it("names the npm package and leaves the files alone", async () => {
    vi.doMock("./updater.js", async (importOriginal) => ({
      ...(await importOriginal<typeof import("./updater.js")>()),
      checkForUpdate: async () => ({ updateAvailable: true, latestVersion: "9.9.9" }),
      performUpdate: vi.fn(),
    }));
    const { handleUpdateCommand } = await import("./commands.js");
    const updater = await import("./updater.js");
    const out = captureStdout();

    await handleUpdateCommand();

    out.restore();
    vi.doUnmock("./updater.js");
    expect(out.lines.join("\n")).toContain("npm update -g @intelligentelectron/universal-netlist");
    expect(updater.performUpdate).not.toHaveBeenCalled();
  });
});

describe("handleUninstallCommand as the standalone binary", () => {
  /** Uninstall a binary at `<root>/bin/universal-netlist`, confirming the prompt. */
  const uninstallFrom = async (root: string): Promise<void> => {
    vi.doMock("./executable.js", () => ({
      isCompiledBinary: () => true,
      getCurrentExecutablePath: () => join(root, "bin", "universal-netlist"),
    }));
    vi.doMock("./prompts.js", () => ({ confirm: async () => true }));
    vi.doMock("./shell.js", () => ({ removeFromPath: () => [] }));
    const { handleUninstallCommand } = await import("./commands.js");
    const out = captureStdout();
    await handleUninstallCommand();
    out.restore();
    vi.doUnmock("./executable.js");
    vi.doUnmock("./prompts.js");
    vi.doUnmock("./shell.js");
  };

  const layout = (files: string[]): string => {
    const root = mkdtempSync(join(tmpdir(), "uninstall-"));
    for (const file of files) {
      mkdirSync(join(root, file, ".."), { recursive: true });
      writeFileSync(join(root, file), "");
    }
    return root;
  };

  it("removes the install directory it created, once its own files are gone", async () => {
    const root = layout([
      "un/bin/universal-netlist",
      "un/bin/universal-netlist.backup.1700000000000",
      "un/telemetry.jsonl",
      "un/universal-netlist.mcpb",
    ]);
    try {
      await uninstallFrom(join(root, "un"));
      expect(existsSync(join(root, "un"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("leaves everything else in a shared directory such as a prefix", async () => {
    const root = layout([
      "bin/universal-netlist",
      "bin/other-tool",
      "lib/node_modules/other/index.js",
      "share/notes.txt",
    ]);
    try {
      await uninstallFrom(root);
      expect(readdirSync(join(root, "bin"))).toEqual(["other-tool"]);
      expect(existsSync(join(root, "lib/node_modules/other/index.js"))).toBe(true);
      expect(existsSync(join(root, "share/notes.txt"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
