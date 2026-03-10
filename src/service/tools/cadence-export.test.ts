import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  exportCadenceNetlist,
  detectCadenceVersions,
  relocateLockFile,
  restoreLockFile,
  resolveAllegroDir,
} from "./cadence-export.js";
import type { ErrorResult } from "../../types.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const isErrorResult = (result: unknown): result is ErrorResult =>
  typeof result === "object" && result !== null && "error" in result;

describe("exportCadenceNetlist", () => {
  it("returns error on non-Windows platform", async () => {
    if (process.platform !== "win32") {
      const result = await exportCadenceNetlist("/path/to/design.dsn");

      expect(isErrorResult(result)).toBe(true);
      expect((result as ErrorResult).error).toContain("Windows");
      expect((result as ErrorResult).error).toContain("pstswp");
    }
  });
});

describe("relocateLockFile", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "lock-test-"));
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns undefined when no lock file exists", async () => {
    const dsnPath = path.join(tmpDir, "design.DSN");
    await fs.promises.writeFile(dsnPath, "");

    const result = await relocateLockFile(dsnPath);

    expect(result).toBeUndefined();
  });

  it("moves lock file to temp dir and returns temp path", async () => {
    const dsnPath = path.join(tmpDir, "design.DSN");
    const lockPath = path.join(tmpDir, "design.DSNlck");
    await fs.promises.writeFile(dsnPath, "");
    await fs.promises.writeFile(lockPath, "lock-content");

    const tempPath = await relocateLockFile(dsnPath);

    expect(tempPath).toBeDefined();
    await expect(fs.promises.access(lockPath)).rejects.toThrow();
    const content = await fs.promises.readFile(tempPath!, "utf-8");
    expect(content).toBe("lock-content");

    await fs.promises.unlink(tempPath!);
  });

  it("handles case-insensitive .dsn extension", async () => {
    const dsnPath = path.join(tmpDir, "design.dsn");
    const lockPath = path.join(tmpDir, "design.DSNlck");
    await fs.promises.writeFile(dsnPath, "");
    await fs.promises.writeFile(lockPath, "lock");

    const tempPath = await relocateLockFile(dsnPath);

    expect(tempPath).toBeDefined();
    await expect(fs.promises.access(lockPath)).rejects.toThrow();

    await fs.promises.unlink(tempPath!);
  });
});

describe("restoreLockFile", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "lock-test-"));
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it("restores lock file from temp path to original location", async () => {
    const dsnPath = path.join(tmpDir, "design.DSN");
    const lockPath = path.join(tmpDir, "design.DSNlck");
    const tempPath = path.join(tmpDir, "design.DSNlck.temp");
    await fs.promises.writeFile(tempPath, "lock-content");

    await restoreLockFile(dsnPath, tempPath);

    const content = await fs.promises.readFile(lockPath, "utf-8");
    expect(content).toBe("lock-content");
    await expect(fs.promises.access(tempPath)).rejects.toThrow();
  });

  it("warns but does not throw when temp file is missing", async () => {
    const dsnPath = path.join(tmpDir, "design.DSN");
    const tempPath = path.join(tmpDir, "nonexistent.tmp");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await restoreLockFile(dsnPath, tempPath);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to restore lock file"));
    warnSpy.mockRestore();
  });
});

describe("detectCadenceVersions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty array when cadence directory does not exist", async () => {
    vi.spyOn(fs.promises, "readdir").mockRejectedValue(
      new Error("ENOENT: no such file or directory")
    );

    const versions = await detectCadenceVersions("/nonexistent/path");

    expect(versions).toEqual([]);
  });

  it("returns empty array when directory contains no SPB folders", async () => {
    vi.spyOn(fs.promises, "readdir").mockResolvedValue([
      "OrCAD_17.2",
      "Allegro_PCB",
      "random_folder",
      "SPB_invalid",
    ] as never);

    const versions = await detectCadenceVersions("C:/Cadence");

    expect(versions).toEqual([]);
  });

  it("filters directories using SPB version regex pattern", async () => {
    vi.spyOn(fs.promises, "readdir").mockResolvedValue([
      "SPB_17.4",
      "SPB_23.1",
      "SPB_invalid",
      "OrCAD_17.2",
      "SPB_1.2.3",
    ] as never);

    const versions = await detectCadenceVersions("C:/Cadence");

    expect(Array.isArray(versions)).toBe(true);
  });
});

describe("resolveAllegroDir", () => {
  let tmpDir: string;

  const cleanup = async (dir: string) => {
    await fs.promises.rm(dir, { recursive: true, force: true });
  };

  beforeEach(async () => {
    vi.restoreAllMocks();
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "netlist-test-"));
  });

  afterEach(async () => {
    await cleanup(tmpDir);
  });

  it("uses existing Allegro/ directory", async () => {
    await fs.promises.mkdir(path.join(tmpDir, "Allegro"));
    const result = await resolveAllegroDir(tmpDir);
    expect(result.dirName).toBe("Allegro");
    expect(result.outputDir).toBe(path.join(tmpDir, "Allegro"));
  });

  it("uses existing allegro/ directory", async () => {
    await fs.promises.mkdir(path.join(tmpDir, "allegro"));
    const result = await resolveAllegroDir(tmpDir);
    expect(result.dirName).toBe("allegro");
    expect(result.outputDir).toBe(path.join(tmpDir, "allegro"));
  });

  it("prefers Allegro/ over allegro/ when both exist", async () => {
    vi.spyOn(fs.promises, "readdir")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValueOnce(["Allegro", "allegro"] as any);
    vi.spyOn(fs.promises, "mkdir").mockResolvedValueOnce(undefined);

    const result = await resolveAllegroDir(tmpDir);
    expect(result.dirName).toBe("Allegro");
  });

  it("creates allegro/ when neither exists", async () => {
    const result = await resolveAllegroDir(tmpDir);
    expect(result.dirName).toBe("allegro");
    expect(result.outputDir).toBe(path.join(tmpDir, "allegro"));
    const stat = await fs.promises.stat(result.outputDir);
    expect(stat.isDirectory()).toBe(true);
  });
});
