/**
 * Path resolution tests.
 *
 * All tests run under win32 path semantics (vi.mock("path") → path.win32)
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
      readdir: vi.fn(async (target?: string) => {
        const normalized = String(target ?? "").toLowerCase();
        if (normalized.includes("cadence")) {
          return ["SPB_17.4"];
        }
        if (normalized.includes("allegro")) {
          return ["pstchip.dat", "pstxnet.dat", "pstxprt.dat"];
        }
        return [];
      }),
    },
  };
});

vi.mock("./parsers/index.js", () => ({
  discoverDesigns: vi.fn(),
  findHandler: vi.fn(),
  parseDesign: vi.fn(),
}));

// =============================================================================
// Shared setup
// =============================================================================

let resolvePath: typeof import("./paths.js").resolvePath;
let toRelativePath: typeof import("./paths.js").toRelativePath;
let listDesigns: typeof import("./service.js").listDesigns;
let exportCadenceNetlist: typeof import("./service.js").exportCadenceNetlist;
let parsers: typeof import("./parsers/index.js");
let path: typeof import("path");

const originalPlatform = process.platform;

const definePlatform = (value: string) => {
  Object.defineProperty(process, "platform", { value, configurable: true });
};

beforeAll(async () => {
  path = await import("path");
  ({ resolvePath, toRelativePath } = await import("./paths.js"));
  parsers = await import("./parsers/index.js");
  ({ listDesigns, exportCadenceNetlist } = await import("./service.js"));
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
// toRelativePath
// =============================================================================

describe("toRelativePath", () => {
  it("converts absolute path under CWD to relative", () => {
    const rel = toRelativePath("C:\\projects\\Board\\Board.PrjPcb");
    expect(rel).toBe("Board\\Board.PrjPcb");
    expect(path.isAbsolute(rel)).toBe(false);
  });

  it("returns empty string for CWD itself", () => {
    expect(toRelativePath("C:\\projects")).toBe("");
  });

  it("uses .. for paths above CWD", () => {
    expect(toRelativePath("C:\\")).toBe("..");
  });

  it("returns absolute path when on a different drive (no relative representation)", () => {
    const result = toRelativePath("D:\\other\\design.dsn");
    expect(result).toBe("D:\\other\\design.dsn");
    expect(path.isAbsolute(result)).toBe(true);
  });
});

// =============================================================================
// listDesigns — relative output (paths relative to search directory)
// =============================================================================

describe("listDesigns output paths", () => {
  beforeEach(() => {
    vi.spyOn(process, "cwd").mockReturnValue("C:\\repo");
  });

  it("returns path relative to search directory (defaults to CWD)", async () => {
    vi.mocked(parsers.discoverDesigns).mockResolvedValue([
      {
        name: "Board",
        sourcePath: "C:\\repo\\projects\\Board\\Board.PrjPcb",
        format: "altium",
        schdocPaths: [],
      },
    ]);

    const result = await listDesigns();

    expect(Array.isArray(result)).toBe(true);
    const designPath = (result as Array<{ path: string }>)[0]?.path;
    expect(designPath).toBe("projects\\Board\\Board.PrjPcb");
    expect(path.isAbsolute(designPath)).toBe(false);
  });

  it("returns path relative to explicit search path", async () => {
    vi.mocked(parsers.discoverDesigns).mockResolvedValue([
      {
        name: "Board",
        sourcePath: "C:\\repo\\projects\\Board\\Board.PrjPcb",
        format: "altium",
        schdocPaths: [],
      },
    ]);

    const result = await listDesigns("C:\\repo\\projects");

    expect(Array.isArray(result)).toBe(true);
    const designPath = (result as Array<{ path: string }>)[0]?.path;
    expect(designPath).toBe("Board\\Board.PrjPcb");
    expect(path.isAbsolute(designPath)).toBe(false);
  });

  it("falls back to absolute path when drives differ", async () => {
    vi.mocked(parsers.discoverDesigns).mockResolvedValue([
      {
        name: "Board",
        sourcePath: "D:\\projects\\Board\\Board.PrjPcb",
        format: "altium",
        schdocPaths: [],
      },
    ]);

    const result = await listDesigns();

    expect(Array.isArray(result)).toBe(true);
    const designPath = (result as Array<{ path: string }>)[0]?.path;
    expect(designPath).toBe("D:\\projects\\Board\\Board.PrjPcb");
    expect(path.isAbsolute(designPath)).toBe(true);
  });
});

// =============================================================================
// listDesigns — max_depth and max_results
// =============================================================================

describe("listDesigns max_depth", () => {
  it("passes maxDepth to discoverDesigns", async () => {
    vi.mocked(parsers.discoverDesigns).mockResolvedValue([]);

    await listDesigns(undefined, ".*", 3);

    expect(parsers.discoverDesigns).toHaveBeenCalledWith(expect.any(String), { maxDepth: 3 });
  });

  it("passes undefined maxDepth when not specified", async () => {
    vi.mocked(parsers.discoverDesigns).mockResolvedValue([]);

    await listDesigns();

    expect(parsers.discoverDesigns).toHaveBeenCalledWith(expect.any(String), {
      maxDepth: undefined,
    });
  });
});

describe("listDesigns max_results", () => {
  beforeEach(() => {
    vi.spyOn(process, "cwd").mockReturnValue("C:\\repo");
    vi.mocked(parsers.discoverDesigns).mockResolvedValue([
      {
        name: "A",
        sourcePath: "C:\\repo\\A\\A.dsn",
        format: "cadence-cis",
        datFiles: { pstxnet: null, pstxprt: null, pstchip: null },
      },
      {
        name: "B",
        sourcePath: "C:\\repo\\B\\B.dsn",
        format: "cadence-cis",
        datFiles: { pstxnet: null, pstxprt: null, pstchip: null },
      },
      {
        name: "C",
        sourcePath: "C:\\repo\\C\\C.dsn",
        format: "cadence-cis",
        datFiles: { pstxnet: null, pstxprt: null, pstchip: null },
      },
    ]);
  });

  it("limits results when max_results is set", async () => {
    const result = await listDesigns(undefined, ".*", undefined, 2);

    expect(Array.isArray(result)).toBe(true);
    expect((result as Array<{ name: string }>).length).toBe(2);
    expect((result as Array<{ name: string }>)[0].name).toBe("A");
    expect((result as Array<{ name: string }>)[1].name).toBe("B");
  });

  it("returns all results when max_results is not set", async () => {
    const result = await listDesigns();

    expect(Array.isArray(result)).toBe(true);
    expect((result as Array<{ name: string }>).length).toBe(3);
  });

  it("returns all results when max_results exceeds count", async () => {
    const result = await listDesigns(undefined, ".*", undefined, 10);

    expect(Array.isArray(result)).toBe(true);
    expect((result as Array<{ name: string }>).length).toBe(3);
  });
});

// =============================================================================
// exportCadenceNetlist — relative output
// =============================================================================

describe("exportCadenceNetlist output paths", () => {
  beforeEach(() => {
    vi.spyOn(process, "cwd").mockReturnValue("C:\\repo");
  });

  it("returns relative outputDir on the same drive", async () => {
    const result = await exportCadenceNetlist("C:\\repo\\schem\\Board.dsn");

    if ("error" in result) {
      throw new Error(`Unexpected error: ${result.error}`);
    }

    expect(result.outputDir).toBe("schem\\Allegro");
    expect(path.isAbsolute(result.outputDir)).toBe(false);
  });

  it("falls back to absolute outputDir when drives differ", async () => {
    const result = await exportCadenceNetlist("D:\\schem\\Board.dsn");

    if ("error" in result) {
      throw new Error(`Unexpected error: ${result.error}`);
    }

    expect(result.outputDir).toBe("D:\\schem\\Allegro");
    expect(path.isAbsolute(result.outputDir)).toBe(true);
  });
});
