/**
 * Path resolution tests.
 *
 * All tests run under win32 path semantics (vi.mock("path") -> path.win32)
 * so they are deterministic across macOS/Linux/Windows CI.
 */
import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from "vitest";

// =============================================================================
// Module mocks — hoisted to file scope by vitest
// =============================================================================

vi.mock("path", async () => {
  const actual = await vi.importActual<typeof import("path")>("path");
  return {
    ...actual.win32,
    default: actual.win32,
  };
});

vi.mock("child_process", async () => {
  const { promisify } = await import("util");
  const execFn = (
    _command: string,
    options: unknown,
    callback?: (error: Error | null, stdout: string, stderr: string) => void
  ) => {
    const cb = typeof options === "function" ? options : callback;
    if (cb) {
      cb(null, "", "");
    }
    return {};
  };
  (execFn as unknown as Record<symbol, unknown>)[promisify.custom] = async () => ({
    stdout: "",
    stderr: "",
  });
  return { exec: execFn };
});

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    promises: {
      ...actual.promises,
      readdir: vi.fn(async (target?: string, options?: { withFileTypes?: boolean }) => {
        const normalized = String(target ?? "").toLowerCase();
        const names = normalized.includes("cadence")
          ? ["SPB_17.4"]
          : normalized.endsWith("allegro")
            ? ["pstchip.dat", "pstxnet.dat", "pstxprt.dat"]
            : // Schematic directory: one DSN file and the Allegro output folder
              ["Board.dsn", "Allegro"];

        if (!options?.withFileTypes) return names;
        // resolveExportDir needs to tell a directory from a file: a plain file
        // named `allegro` must not be chosen as the output directory.
        return names.map((name) => ({
          name,
          isFile: () => name.includes("."),
          isDirectory: () => !name.includes("."),
        }));
      }),
      mkdir: vi.fn(async () => undefined),
      // resolveExportDir confirms a candidate is a directory, and the export
      // compares .dat timestamps before and after to tell a fresh netlist from
      // a previous run's. A rising clock models a run that wrote all three.
      stat: vi.fn(async (target: string) => {
        const base = String(target).split(/[\\/]/).pop() ?? "";
        return {
          isDirectory: () => !base.includes("."),
          isFile: () => base.includes("."),
          mtimeMs: statClock++,
        };
      }),
    },
  };
});

let statClock = 1;

vi.mock("./parsers/index.js", () => ({
  discoverDesigns: vi.fn(),
  findHandler: vi.fn(),
  parseDesign: vi.fn(),
}));

// =============================================================================
// Shared setup
// =============================================================================

let resolvePath: typeof import("./paths.js").resolvePath;
let listDesigns: typeof import("./service/index.js").listDesigns;
let exportCadenceNetlist: typeof import("./service/index.js").exportCadenceNetlist;
let parsers: typeof import("./parsers/index.js");
let path: typeof import("path");

const originalPlatform = process.platform;

const definePlatform = (value: string) => {
  Object.defineProperty(process, "platform", { value, configurable: true });
};

beforeAll(async () => {
  path = await import("path");
  ({ resolvePath } = await import("./paths.js"));
  parsers = await import("./parsers/index.js");
  ({ listDesigns, exportCadenceNetlist } = await import("./service/index.js"));
});

beforeEach(() => {
  definePlatform("win32");
  vi.spyOn(process, "cwd").mockReturnValue("C:\\projects");
});

afterEach(() => {
  definePlatform(originalPlatform);
  vi.restoreAllMocks();
});

// =============================================================================
// resolvePath
// =============================================================================

describe("resolvePath", () => {
  it("returns absolute paths unchanged", () => {
    expect(resolvePath("C:\\mock\\design.dsn")).toBe("C:\\mock\\design.dsn");
  });

  it("resolves relative paths against CWD", () => {
    expect(resolvePath("Board\\Board.PrjPcb")).toBe("C:\\projects\\Board\\Board.PrjPcb");
  });

  it("resolves '.' to CWD", () => {
    expect(resolvePath(".")).toBe("C:\\projects");
  });

  it("normalizes .. segments", () => {
    expect(resolvePath(".\\foo\\..\\bar\\design.dsn")).toBe("C:\\projects\\bar\\design.dsn");
  });

  it("normalizes forward slashes to backslashes", () => {
    expect(resolvePath("sub/dir/design.dsn")).toBe("C:\\projects\\sub\\dir\\design.dsn");
  });
});

// =============================================================================
// listDesigns — absolute output paths
// =============================================================================

/**
 * The designs of a successful result.
 *
 * A result carries the search root alongside them, so a test that wants the
 * designs unwraps rather than indexing the result itself.
 */
const designsOf = (result: unknown): Array<{ name: string; path: string; error?: string }> => {
  expect(result).toHaveProperty("designs");
  return (result as { designs: Array<{ name: string; path: string; error?: string }> }).designs;
};

describe("listDesigns output paths", () => {
  it("returns absolute paths", async () => {
    vi.mocked(parsers.discoverDesigns).mockResolvedValue([
      {
        name: "Board",
        sourcePath: "C:\\projects\\Board\\Board.PrjPcb",
        format: "altium",
        schdocPaths: [],
      },
    ]);

    const result = await listDesigns();

    const designPath = designsOf(result)[0]?.path;
    expect(designPath).toBe("C:\\projects\\Board\\Board.PrjPcb");
    expect(path.isAbsolute(designPath)).toBe(true);
  });
});

// =============================================================================
// listDesigns — searchPath and pattern
// =============================================================================

describe("listDesigns searchPath and pattern", () => {
  it("resolves searchPath and passes it to discoverDesigns", async () => {
    vi.mocked(parsers.discoverDesigns).mockResolvedValue([]);

    await listDesigns({ searchPath: "sub\\dir" });

    expect(parsers.discoverDesigns).toHaveBeenCalledWith(
      "C:\\projects\\sub\\dir",
      expect.any(Object)
    );
  });

  it("defaults searchPath to CWD", async () => {
    vi.mocked(parsers.discoverDesigns).mockResolvedValue([]);

    await listDesigns();

    expect(parsers.discoverDesigns).toHaveBeenCalledWith("C:\\projects", expect.any(Object));
  });

  it("filters designs by pattern", async () => {
    vi.mocked(parsers.discoverDesigns).mockResolvedValue([
      { name: "Alpha", sourcePath: "C:\\Alpha.PrjPcb", format: "altium", schdocPaths: [] },
      { name: "Beta", sourcePath: "C:\\Beta.PrjPcb", format: "altium", schdocPaths: [] },
      { name: "AlphaV2", sourcePath: "C:\\AlphaV2.PrjPcb", format: "altium", schdocPaths: [] },
    ]);

    const result = await listDesigns({ pattern: "^Alpha" });

    const names = designsOf(result).map((d) => d.name);
    expect(names).toEqual(["Alpha", "AlphaV2"]);
  });

  it("returns error for invalid regex pattern", async () => {
    const result = await listDesigns({ pattern: "[invalid" });

    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("Invalid regex pattern");
  });
});

// =============================================================================
// listDesigns — Cadence .dat path priority
// =============================================================================

describe("listDesigns Cadence path priority", () => {
  it("returns the .DSN as the one path when .dat files exist beside it", async () => {
    vi.mocked(parsers.discoverDesigns).mockResolvedValue([
      {
        name: "Board",
        sourcePath: "C:\\projects\\Board.DSN",
        format: "cadence-cis",
        datFiles: {
          pstxnet: "C:\\projects\\Allegro\\pstxnet.dat",
          pstxprt: "C:\\projects\\Allegro\\pstxprt.dat",
          pstchip: "C:\\projects\\Allegro\\pstchip.dat",
        },
      },
    ]);

    const result = await listDesigns();

    const design = designsOf(result)[0];
    expect(design.path).toBe("C:\\projects\\Board.DSN");
    // One path, and it is the design. The netlist beside it is not reported.
    expect(design).not.toHaveProperty("source");
    expect(design).not.toHaveProperty("netlist");
  });

  it("returns the .DSN as the one path when no .dat files exist", async () => {
    vi.mocked(parsers.discoverDesigns).mockResolvedValue([
      {
        name: "Board",
        sourcePath: "C:\\projects\\Board.DSN",
        format: "cadence-cis",
        datFiles: { pstxnet: null, pstxprt: null, pstchip: null },
      },
    ]);

    const result = await listDesigns();

    const design = designsOf(result)[0];
    expect(design.path).toBe("C:\\projects\\Board.DSN");
  });
});

// =============================================================================
// listDesigns — error passthrough
// =============================================================================

describe("listDesigns error passthrough", () => {
  it("forwards design error field to output", async () => {
    vi.mocked(parsers.discoverDesigns).mockResolvedValue([
      {
        name: "Broken",
        sourcePath: "C:\\Broken.DSN",
        format: "cadence-cis",
        datFiles: { pstxnet: null, pstxprt: null, pstchip: null },
        error: "Netlist files not exported.",
      },
    ]);

    const result = await listDesigns();

    const design = designsOf(result)[0];
    expect(design.error).toBe("Netlist files not exported.");
  });

  it("omits error field when design has no error", async () => {
    vi.mocked(parsers.discoverDesigns).mockResolvedValue([
      { name: "Good", sourcePath: "C:\\Good.PrjPcb", format: "altium", schdocPaths: [] },
    ]);

    const result = await listDesigns();

    const design = designsOf(result)[0];
    expect(design.error).toBeUndefined();
  });
});

// =============================================================================
// listDesigns — filesystem errors
// =============================================================================

describe("listDesigns filesystem errors", () => {
  it("returns error for nonexistent path", async () => {
    vi.mocked(parsers.discoverDesigns).mockRejectedValue(
      Object.assign(new Error("ENOENT: no such file or directory, scandir 'C:\\nonexistent'"), {
        code: "ENOENT",
      })
    );

    const result = await listDesigns({ searchPath: "C:\\nonexistent" });

    expect((result as { error: string }).error).toContain("Failed to search");
    expect((result as { error: string }).error).toContain("ENOENT");
  });

  it("returns error when path is a file", async () => {
    vi.mocked(parsers.discoverDesigns).mockRejectedValue(
      Object.assign(new Error("ENOTDIR: not a directory, scandir 'C:\\file.txt'"), {
        code: "ENOTDIR",
      })
    );

    const result = await listDesigns({ searchPath: "C:\\file.txt" });

    expect((result as { error: string }).error).toContain("Failed to search");
    expect((result as { error: string }).error).toContain("ENOTDIR");
  });
});

// =============================================================================
// listDesigns — maxResults
// =============================================================================

describe("listDesigns maxResults", () => {
  const makeDesigns = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      name: `Design${i}`,
      sourcePath: `C:\\projects\\Design${i}\\Design${i}.PrjPcb`,
      format: "altium" as const,
      schdocPaths: [],
    }));

  it("defaults to 50 results", async () => {
    vi.mocked(parsers.discoverDesigns).mockResolvedValue(makeDesigns(100));

    const result = await listDesigns();

    expect(designsOf(result).length).toBe(50);
  });

  it("respects custom maxResults", async () => {
    vi.mocked(parsers.discoverDesigns).mockResolvedValue(makeDesigns(100));

    const result = await listDesigns({ maxResults: 10 });

    expect(designsOf(result).length).toBe(10);
  });

  it("returns all results when fewer than maxResults", async () => {
    vi.mocked(parsers.discoverDesigns).mockResolvedValue(makeDesigns(3));

    const result = await listDesigns({ maxResults: 10 });

    expect(designsOf(result).length).toBe(3);
  });
});

// =============================================================================
// listDesigns — maxDepth
// =============================================================================

describe("listDesigns maxDepth", () => {
  it("passes maxDepth to discoverDesigns", async () => {
    vi.mocked(parsers.discoverDesigns).mockResolvedValue([]);

    await listDesigns({ maxDepth: 2 });

    expect(parsers.discoverDesigns).toHaveBeenCalledWith(expect.any(String), { maxDepth: 2 });
  });

  it("passes undefined maxDepth when omitted", async () => {
    vi.mocked(parsers.discoverDesigns).mockResolvedValue([]);

    await listDesigns();

    expect(parsers.discoverDesigns).toHaveBeenCalledWith(expect.any(String), {
      maxDepth: undefined,
    });
  });
});

// =============================================================================
// exportCadenceNetlist — absolute output paths
// =============================================================================

describe("exportCadenceNetlist output paths", () => {
  it("returns absolute outputDir", async () => {
    const result = await exportCadenceNetlist("C:\\repo\\schem\\Board.dsn");

    if ("error" in result) {
      throw new Error(`Unexpected error: ${result.error}`);
    }

    expect(result.outputDir).toBe("C:\\repo\\schem\\Allegro");
    expect(path.isAbsolute(result.outputDir)).toBe(true);
  });
});

// =============================================================================
// listDesigns — search root and notes
// =============================================================================

describe("listDesigns search root", () => {
  const notesOf = (result: unknown): string[] => (result as { notes?: string[] }).notes ?? [];

  it("reports the resolved directory it searched", async () => {
    vi.mocked(parsers.discoverDesigns).mockResolvedValue([]);

    const result = await listDesigns({ searchPath: "sub\\dir" });

    expect((result as { root: string }).root).toBe("C:\\projects\\sub\\dir");
  });

  it("reports the working directory as the root when no path is given", async () => {
    vi.mocked(parsers.discoverDesigns).mockResolvedValue([]);

    const result = await listDesigns();

    expect((result as { root: string }).root).toBe("C:\\projects");
  });

  // The failure this guards is a search that answers from a directory nobody
  // asked about: an unrecognised argument is dropped before it reaches the tool,
  // so a misspelled path arrives as no path and quietly searches the default.
  // Real designs come back and nothing about them looks wrong.
  it("notes that the search fell back to the working directory", async () => {
    vi.mocked(parsers.discoverDesigns).mockResolvedValue([]);

    const result = await listDesigns();

    expect(notesOf(result).join(" ")).toContain("No directory was named");
  });

  // `path` is an optional string, so a caller can send it empty. That is not a
  // directory, and it reaches the working directory by the same route an absent
  // argument does, so it earns the same note rather than passing for a choice.
  it("treats a blank path as no path", async () => {
    vi.mocked(parsers.discoverDesigns).mockResolvedValue([]);

    for (const blank of ["", "   ", "\t"]) {
      const result = await listDesigns({ searchPath: blank });

      expect((result as { root: string }).root).toBe("C:\\projects");
      expect(notesOf(result).join(" ")).toContain("No directory was named");
    }
  });

  it("says nothing about the working directory when a path is given", async () => {
    vi.mocked(parsers.discoverDesigns).mockResolvedValue([]);

    const result = await listDesigns({ searchPath: "sub\\dir" });

    expect(notesOf(result).join(" ")).not.toContain("No directory was named");
  });
});

describe("listDesigns truncation notes", () => {
  const makeDesigns = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      name: `Design${i}`,
      sourcePath: `C:\\projects\\Design${i}\\Design${i}.PrjPcb`,
      format: "altium" as const,
      schdocPaths: [],
    }));

  const notesOf = (result: unknown): string[] => (result as { notes?: string[] }).notes ?? [];

  it("says how many designs were left out", async () => {
    vi.mocked(parsers.discoverDesigns).mockResolvedValue(makeDesigns(100));

    const result = await listDesigns({ searchPath: "sub", maxResults: 10 });

    expect(notesOf(result).join(" ")).toContain("Showing 10 of 100 designs");
  });

  // The count is of designs that matched the pattern, not of everything found,
  // so a filtered search reports what the filter left rather than what the walk
  // saw.
  it("counts what the pattern matched, not what the walk found", async () => {
    vi.mocked(parsers.discoverDesigns).mockResolvedValue([
      ...makeDesigns(40),
      { name: "Other", sourcePath: "C:\\Other.PrjPcb", format: "altium" as const, schdocPaths: [] },
    ]);

    const result = await listDesigns({ searchPath: "sub", pattern: "^Design", maxResults: 10 });

    expect(notesOf(result).join(" ")).toContain("Showing 10 of 40 designs");
  });

  it("says nothing when every design fits", async () => {
    vi.mocked(parsers.discoverDesigns).mockResolvedValue(makeDesigns(3));

    const result = await listDesigns({ searchPath: "sub", maxResults: 10 });

    expect(notesOf(result)).toEqual([]);
  });
});
