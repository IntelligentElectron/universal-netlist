import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  exportCadenceNetlist,
  detectCadenceVersions,
  relocateLockFile,
  restoreLockFile,
  resolveExportDir,
} from "./cadence-export.js";
import type { ErrorResult } from "../../types.js";
import { netlistDirName } from "../../paths.js";
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

  it("moves the lock file aside and returns where it went", async () => {
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

  it("keeps the relocated lock beside the design rather than in the temp directory", async () => {
    // These designs live on mapped and UNC shares. A rename into tmpdir() crosses
    // volumes there and raises EXDEV, which surfaced as "Close the design in
    // Cadence and try again" for a design nobody had open, and no design on a
    // share could be exported at all.
    const dsnPath = path.join(tmpDir, "design.DSN");
    await fs.promises.writeFile(dsnPath, "");
    await fs.promises.writeFile(path.join(tmpDir, "design.DSNlck"), "lock");

    const tempPath = await relocateLockFile(dsnPath);

    expect(path.dirname(tempPath!)).toBe(tmpDir);
    expect(tempPath!.startsWith(os.tmpdir() + path.sep)).toBe(
      tmpDir.startsWith(os.tmpdir() + path.sep)
    );

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

  it("moves the lock file aside for a .DSN without touching the design", async () => {
    const design = path.join(tmpDir, "BOARD.DSN");
    await fs.promises.writeFile(design, "design");
    await fs.promises.writeFile(path.join(tmpDir, "BOARD.DSNlck"), "lock");

    const moved = await relocateLockFile(design);

    expect(moved).toBeDefined();
    expect(path.basename(moved!)).toContain("BOARD.DSNlck");
    expect(await fs.promises.readFile(design, "utf-8")).toBe("design");
  });

  it("never moves the design when the path is not a .DSN", async () => {
    // `replace` returns the string unchanged when the pattern does not match, so
    // the lock path WAS the design path and this moved the user's design into
    // the temp directory. list_designs hands out pstxnet.dat for a dat-only
    // design and the .cpm for an HDL one, so following the documented workflow
    // reached it.
    for (const name of ["BOARD.cpm", "pstxnet.dat", "BOARD.DSN.bak"]) {
      const design = path.join(tmpDir, name);
      await fs.promises.writeFile(design, "design");

      expect(await relocateLockFile(design)).toBeUndefined();
      expect(await fs.promises.readFile(design, "utf-8")).toBe("design");
    }
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

describe("resolveExportDir", () => {
  let tmpDir: string;

  const cleanup = async (dir: string) => {
    await fs.promises.rm(dir, { recursive: true, force: true });
  };

  /** Create files in the temp dir and return the path of the first. */
  const withDesigns = async (...names: string[]): Promise<string> => {
    for (const name of names) await fs.promises.writeFile(path.join(tmpDir, name), "");
    return path.join(tmpDir, names[0]);
  };

  beforeEach(async () => {
    // The describes above install persistent readdir/mkdir spies. Restoring here
    // keeps these real-filesystem tests from silently passing against a mock.
    vi.restoreAllMocks();
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "netlist-test-"));
  });

  afterEach(async () => {
    await cleanup(tmpDir);
  });

  it("gives each design in a shared folder its own directory", async () => {
    // The reported bug: pstswp writes pstxnet.dat under a fixed name, so two
    // designs exporting to one directory leave only the second design's netlist.
    const first = await withDesigns("BOARD_A.DSN", "BOARD_B.DSN");
    const second = path.join(tmpDir, "BOARD_B.DSN");

    const a = await resolveExportDir(first);
    const b = await resolveExportDir(second);

    expect(a.dirName).toBe("BOARD_A_netlist");
    expect(b.dirName).toBe("BOARD_B_netlist");
    expect(a.outputDir).not.toBe(b.outputDir);
  });

  it("separates designs even when the folder has a legacy Allegro/ directory", async () => {
    await fs.promises.mkdir(path.join(tmpDir, "Allegro"));
    const first = await withDesigns("BOARD_A.DSN", "BOARD_B.DSN");

    expect((await resolveExportDir(first)).dirName).toBe("BOARD_A_netlist");
  });

  it("counts an HDL sibling as a design", async () => {
    // Design Entry HDL's netlister writes the same three filenames into the same
    // directory pstswp does, so a .cpm neighbour collides just as a .DSN does.
    await fs.promises.mkdir(path.join(tmpDir, "allegro"));
    const first = await withDesigns("BOARD.DSN", "OTHER.cpm");

    expect((await resolveExportDir(first)).dirName).toBe("BOARD_netlist");
  });

  it("does not count an AppleDouble sidecar as a design", async () => {
    // macOS writes ._NAME.DSN beside real files on SMB and NFS shares, and a
    // Windows workstation exporting from that share sees both entries.
    await fs.promises.mkdir(path.join(tmpDir, "allegro"));
    const first = await withDesigns("BOARD.DSN", "._BOARD.DSN");

    expect((await resolveExportDir(first)).dirName).toBe("allegro");
  });

  it("writes to an existing <design>_netlist even when a legacy allegro/ is there", async () => {
    // Discovery ranks <design>_netlist/ above a bare allegro/ by the whole export
    // bonus. Checking allegro/ first meant the exporter wrote to one directory
    // while every reader read the other: each re-export reported success and
    // every query kept answering from a netlist that had stopped updating.
    await fs.promises.mkdir(path.join(tmpDir, "allegro"));
    await fs.promises.mkdir(path.join(tmpDir, "BOARD_netlist"));
    const only = await withDesigns("BOARD.DSN");

    expect((await resolveExportDir(only)).dirName).toBe("BOARD_netlist");
  });

  it("reports whether the output directory already existed", async () => {
    // A failed export may only remove a directory it brought into being: nothing
    // of the caller's can be inside one that did not exist a moment ago, and a
    // half-written trio left behind outranks the intact netlist beside it.
    const only = await withDesigns("BOARD.DSN");

    expect((await resolveExportDir(only)).created).toBe(true);
    expect((await resolveExportDir(only)).created).toBe(false);
  });

  it("keeps using an existing Allegro/ for a folder with one design", async () => {
    await fs.promises.mkdir(path.join(tmpDir, "Allegro"));
    const only = await withDesigns("BOARD.DSN");

    const result = await resolveExportDir(only);
    expect(result.dirName).toBe("Allegro");
    expect(result.outputDir).toBe(path.join(tmpDir, "Allegro"));
  });

  it("recognises an existing ALLEGRO/ whatever its case", async () => {
    await fs.promises.mkdir(path.join(tmpDir, "ALLEGRO"));
    const only = await withDesigns("BOARD.DSN");

    expect((await resolveExportDir(only)).dirName).toBe("ALLEGRO");
  });

  it("picks the allegro directory that already holds a netlist", async (ctx) => {
    // Several spellings can only coexist on a case-sensitive filesystem, which
    // macOS and Windows are not. Skipped rather than deleted, because Linux CI
    // is exactly where a share like this shows up.
    //
    // ctx.skip(), not a bare return: returning early reports a pass, so on the
    // two platforms where the condition holds this read as covered while
    // asserting nothing at all.
    await fs.promises.mkdir(path.join(tmpDir, "ALLEGRO"));
    const caseInsensitive = await fs.promises
      .access(path.join(tmpDir, "allegro"))
      .then(() => true)
      .catch(() => false);
    if (caseInsensitive) ctx.skip();

    await fs.promises.mkdir(path.join(tmpDir, "allegro"));
    await fs.promises.writeFile(path.join(tmpDir, "allegro", "pstxnet.dat"), "");
    const only = await withDesigns("BOARD.DSN");

    expect((await resolveExportDir(only)).dirName).toBe("allegro");
  });

  it("ignores a plain file named allegro", async () => {
    // It would otherwise be chosen and the mkdir would fail.
    await fs.promises.writeFile(path.join(tmpDir, "allegro"), "not a directory");
    const only = await withDesigns("BOARD.DSN");

    expect((await resolveExportDir(only)).dirName).toBe("BOARD_netlist");
  });

  it("does not mistake a similarly named directory for the legacy one", async () => {
    await fs.promises.mkdir(path.join(tmpDir, "allegro_old"));
    const only = await withDesigns("BOARD.DSN");

    expect((await resolveExportDir(only)).dirName).toBe("BOARD_netlist");
  });

  it("creates the per-design directory when no legacy directory exists", async () => {
    const only = await withDesigns("BOARD.DSN");

    const result = await resolveExportDir(only);
    expect(result.dirName).toBe("BOARD_netlist");
    const stat = await fs.promises.stat(result.outputDir);
    expect(stat.isDirectory()).toBe(true);
  });

  it("uses the per-design directory for a design alone in an empty folder", async () => {
    const only = path.join(tmpDir, "BOARD.DSN");

    expect((await resolveExportDir(only)).dirName).toBe("BOARD_netlist");
  });

  it("keeps the design's own spelling in the directory name", () => {
    expect(netlistDirName("reServer J401 v1.1")).toBe("reServer J401 v1.1_netlist");
  });
});

describe("exportCadenceNetlist input validation", () => {
  it("refuses a path that is not a .DSN before touching the filesystem", async () => {
    const result = await exportCadenceNetlist("/tmp/whatever/BOARD.cpm");

    expect(result).toHaveProperty("error");
    expect((result as ErrorResult).error).toContain(".DSN");
  });
});
