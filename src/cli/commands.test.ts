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
  vi.doMock("../build-flags.js", () => ({
    CHANNEL: "packaged",
    SELF_UPDATE_ENABLED: false,
    COMPILED_BINARY: true,
  }));
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

const ORIGINAL_EXEC_PATH = process.execPath;
const ORIGINAL_ARGV1 = process.argv[1];

/** Run as an interpreter that is not named node or bun, from an npm-style bin link. */
const runAsRenamedInterpreter = (): void => {
  Object.defineProperty(process, "execPath", { value: "/opt/rt/bin/js", configurable: true });
  process.argv[1] = "/usr/local/bin/universal-netlist";
};

afterEach(() => {
  Object.defineProperty(process, "execPath", { value: ORIGINAL_EXEC_PATH, configurable: true });
  process.argv[1] = ORIGINAL_ARGV1;
  vi.doUnmock("./prompts.js");
  vi.doUnmock("./shell.js");
  vi.doUnmock("./executable.js");
  vi.doUnmock("./updater.js");
});

describe("handleUninstallCommand under an interpreter", () => {
  it("points at npm and removes nothing, whatever the interpreter or entry point", async () => {
    runAsRenamedInterpreter();
    const confirmSpy = vi.fn();
    const removeFromPathSpy = vi.fn();
    vi.doMock("./prompts.js", () => ({ confirm: confirmSpy }));
    vi.doMock("./shell.js", () => ({ removeFromPath: removeFromPathSpy }));
    const { handleUninstallCommand } = await import("./commands.js");
    const out = captureStdout();

    await handleUninstallCommand();

    out.restore();
    expect(out.lines.join("\n")).toContain(
      "npm uninstall -g @intelligentelectron/universal-netlist"
    );
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(removeFromPathSpy).not.toHaveBeenCalled();
  });
});

describe("handleUpdateCommand under an interpreter", () => {
  it("names the npm package and leaves the files alone, outside node_modules too", async () => {
    runAsRenamedInterpreter();
    const performUpdate = vi.fn();
    vi.doMock("./updater.js", async (importOriginal) => ({
      ...(await importOriginal<typeof import("./updater.js")>()),
      checkForUpdate: async () => ({ updateAvailable: true, latestVersion: "9.9.9" }),
      performUpdate,
    }));
    const { handleUpdateCommand } = await import("./commands.js");
    const out = captureStdout();

    await handleUpdateCommand();

    out.restore();
    expect(out.lines.join("\n")).toContain("npm update -g @intelligentelectron/universal-netlist");
    expect(performUpdate).not.toHaveBeenCalled();
  });
});

describe("handleUninstallCommand as the standalone binary", () => {
  /** Uninstall the binary at `binary`, confirming the prompt; returns what it printed. */
  const uninstall = async (binary: string): Promise<string> => {
    vi.doMock("./executable.js", () => ({
      isCompiledBinary: () => true,
      getCurrentExecutablePath: () => binary,
    }));
    vi.doMock("./prompts.js", () => ({ confirm: async () => true }));
    vi.doMock("./shell.js", () => ({ removeFromPath: () => [] }));
    vi.resetModules();
    const { handleUninstallCommand } = await import("./commands.js");
    const out = captureStdout();
    try {
      await handleUninstallCommand();
    } finally {
      out.restore();
    }
    return out.lines.join("\n");
  };

  const layout = (files: string[]): string => {
    const root = mkdtempSync(join(tmpdir(), "uninstall-"));
    for (const file of files) {
      mkdirSync(join(root, file, ".."), { recursive: true });
      writeFileSync(join(root, file), "");
    }
    return root;
  };

  it("removes the installer's directory once its own files are gone", async () => {
    const root = layout([
      "universal-netlist/bin/universal-netlist",
      "universal-netlist/bin/universal-netlist.backup.1700000000000",
      "universal-netlist/telemetry.jsonl",
      "universal-netlist/universal-netlist.mcpb",
    ]);
    try {
      await uninstall(join(root, "universal-netlist/bin/universal-netlist"));
      expect(readdirSync(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("takes only the binary from any other directory, empty parents included", async () => {
    const root = layout([
      "prefix/bin/universal-netlist",
      "prefix/bin/other-tool",
      "prefix/telemetry.jsonl",
      "prefix/lib/node_modules/other/index.js",
      "opt/foo/universal-netlist",
    ]);
    try {
      await uninstall(join(root, "prefix/bin/universal-netlist"));
      await uninstall(join(root, "opt/foo/universal-netlist"));
      expect(readdirSync(join(root, "prefix/bin"))).toEqual(["other-tool"]);
      expect(existsSync(join(root, "prefix/telemetry.jsonl"))).toBe(true);
      expect(existsSync(join(root, "prefix/lib/node_modules/other/index.js"))).toBe(true);
      expect(readdirSync(join(root, "opt"))).toEqual(["foo"]);
      expect(readdirSync(join(root, "opt/foo"))).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("lists what it could not remove instead of stopping", async () => {
    const root = layout(["universal-netlist/bin/universal-netlist"]);
    vi.doMock("node:fs", async (importOriginal) => ({
      ...(await importOriginal<typeof import("node:fs")>()),
      rmdirSync: () => {
        throw new Error("EACCES: permission denied");
      },
    }));
    try {
      const printed = await uninstall(join(root, "universal-netlist/bin/universal-netlist"));
      expect(printed).toContain("remove by hand");
      expect(printed).toContain("EACCES: permission denied");
      expect(existsSync(join(root, "universal-netlist/bin/universal-netlist"))).toBe(false);
    } finally {
      vi.doUnmock("node:fs");
      rmSync(root, { recursive: true, force: true });
    }
  });
});
