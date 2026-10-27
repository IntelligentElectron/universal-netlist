import { describe, expect, it, vi } from "vitest";
import { readOnce, readText, type FileReader } from "./context.js";

const reader = (overrides: Partial<FileReader> = {}): FileReader => ({
  readFile: vi.fn(async () => new Uint8Array([1, 2, 3, 4])),
  exists: vi.fn(async () => true),
  ...overrides,
});

describe("readOnce", () => {
  it("shares one read of a path, and answers a prefix from it", async () => {
    const files = reader();
    const once = readOnce(files);
    await once.readFile("/a");
    await once.readFile("/a");
    expect(await once.readPrefix!("/a", 2)).toEqual(new Uint8Array([1, 2]));
    expect(files.readFile).toHaveBeenCalledTimes(1);
  });

  it("uses the reader's own readPrefix until the whole file has been read", async () => {
    const readPrefix = vi.fn(async () => new Uint8Array([9]));
    const once = readOnce(reader({ readPrefix }));
    expect(await once.readPrefix!("/a", 1)).toEqual(new Uint8Array([9]));
    await once.readFile("/a");
    expect(await once.readPrefix!("/a", 1)).toEqual(new Uint8Array([1]));
    expect(readPrefix).toHaveBeenCalledTimes(1);
  });

  it("reads again after a failed read", async () => {
    const readFile = vi
      .fn<FileReader["readFile"]>()
      .mockRejectedValueOnce(Object.assign(new Error("EBUSY"), { code: "EBUSY" }))
      .mockResolvedValueOnce(new Uint8Array([7]));
    const once = readOnce(reader({ readFile }));
    await expect(once.readFile("/a")).rejects.toThrow("EBUSY");
    await expect(once.readFile("/a")).resolves.toEqual(new Uint8Array([7]));
  });

  it("keeps a reader without listDir unable to list", () => {
    expect(readOnce(reader()).listDir).toBeUndefined();
  });
});

describe("readText", () => {
  it("decodes a view into a larger buffer without its neighbours", async () => {
    const backing = new TextEncoder().encode("xxhello");
    const files = reader({ readFile: async () => backing.subarray(2) });
    expect(await readText(files, "/a")).toBe("hello");
  });
});
