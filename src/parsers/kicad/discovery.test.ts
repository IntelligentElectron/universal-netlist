import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock only readdir; keep the rest of node:fs/promises (e.g. access) real.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readdir: vi.fn() };
});

import { readdir } from "node:fs/promises";
import { discoverKicadDesigns } from "./discovery.js";

const mockedReaddir = vi.mocked(readdir);
const withCode = (code: string): Error => Object.assign(new Error(code), { code });

describe("discoverKicadDesigns walker error handling", () => {
  beforeEach(() => {
    mockedReaddir.mockReset();
  });

  it("skips a directory that throws EACCES (returns no designs)", async () => {
    mockedReaddir.mockRejectedValueOnce(withCode("EACCES"));
    await expect(discoverKicadDesigns("/some/protected/dir")).resolves.toEqual([]);
  });

  it("skips a directory removed or replaced mid-walk (ENOENT / ENOTDIR)", async () => {
    mockedReaddir.mockRejectedValueOnce(withCode("ENOENT"));
    await expect(discoverKicadDesigns("/gone")).resolves.toEqual([]);
    mockedReaddir.mockRejectedValueOnce(withCode("ENOTDIR"));
    await expect(discoverKicadDesigns("/not-a-dir")).resolves.toEqual([]);
  });

  it("re-throws non-skippable readdir errors (e.g. EIO)", async () => {
    mockedReaddir.mockRejectedValueOnce(withCode("EIO"));
    await expect(discoverKicadDesigns("/io-error")).rejects.toThrow(/EIO/);
  });
});
