import { chmodSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { fixturePath, hasFixtures } from "../../test/utils.js";
import * as parsers from "../parsers/index.js";
import type { FileReader } from "../parsers/context.js";
import { MemoryCacheStore, deepFreeze, type CacheEntry } from "./cache.js";
import { DiskCacheStore } from "./disk-cache.js";
import { createNetlistService } from "./index.js";

const scratch = mkdtempSync(path.join(tmpdir(), "parse-cache-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
afterEach(() => vi.restoreAllMocks());

const entry = (value: unknown): CacheEntry => ({
  probes: [{ kind: "read", path: "/a", answer: "x" }],
  value,
});

describe("MemoryCacheStore", () => {
  it("drops the least recently used entry past maxEntries", async () => {
    const store = new MemoryCacheStore(2);
    await store.set("a", entry(1));
    await store.set("b", entry(2));
    await store.get("a");
    await store.set("c", entry(3));
    expect(await store.get("b")).toBeUndefined();
    expect((await store.get("a"))?.value).toBe(1);
    expect(store.size).toBe(2);
  });

  it("keeps nothing with maxEntries 0", async () => {
    const store = new MemoryCacheStore(0);
    await store.set("a", entry(1));
    expect(await store.get("a")).toBeUndefined();
  });
});

describe("DiskCacheStore", () => {
  it("round-trips an entry through JSON", async () => {
    const store = new DiskCacheStore(path.join(scratch, "round-trip"));
    await store.set("k", entry({ nets: { A: { U1: ["1"] } } }));
    expect(await store.get("k")).toEqual(entry({ nets: { A: { U1: ["1"] } } }));
  });

  it("answers a miss, and does not throw, when the directory cannot be written", async () => {
    const dir = path.join(scratch, "read-only");
    const store = new DiskCacheStore(path.join(dir, "cache"));
    rmSync(dir, { recursive: true, force: true });
    (await import("node:fs")).mkdirSync(dir);
    chmodSync(dir, 0o500);
    try {
      await expect(store.set("k", entry(1))).resolves.toBeUndefined();
      expect(await store.get("k")).toBeUndefined();
    } finally {
      chmodSync(dir, 0o700);
    }
  });

  it("answers a miss for an entry that is not JSON or not this format", async () => {
    const store = new DiskCacheStore(path.join(scratch, "corrupt"));
    await store.set("k", entry(1));
    writeFileSync(path.join(store.dir, "k.json"), "{ truncated");
    expect(await store.get("k")).toBeUndefined();
    writeFileSync(path.join(store.dir, "k.json"), JSON.stringify({ format: "other", value: 1 }));
    expect(await store.get("k")).toBeUndefined();
    await store.set("k", entry(2));
    expect((await store.get("k"))?.value).toBe(2);
  });

  it("never exposes part of an entry to concurrent writers and readers", async () => {
    const store = new DiskCacheStore(path.join(scratch, "concurrent"));
    const big = (n: number) => ({ n, blob: "x".repeat(200_000) });
    const writes = Array.from({ length: 20 }, (_, n) => store.set("k", entry(big(n))));
    const reads = Array.from({ length: 20 }, () => store.get("k"));
    await Promise.all(writes);
    for (const read of await Promise.all(reads)) {
      if (read) expect((read.value as { blob: string }).blob).toHaveLength(200_000);
    }
    expect(((await store.get("k"))!.value as { blob: string }).blob).toHaveLength(200_000);
    expect(readdirSync(store.dir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("evicts the least recently used entries past its size cap", async () => {
    const store = new DiskCacheStore(path.join(scratch, "evict"), 1_500);
    await store.set("old", entry("x".repeat(400)));
    await new Promise((resolve) => setTimeout(resolve, 20));
    await store.set("mid", entry("x".repeat(400)));
    await new Promise((resolve) => setTimeout(resolve, 20));
    await store.get("old");
    await store.set("new", entry("x".repeat(400)));
    const left = readdirSync(store.dir).sort();
    expect(left).toEqual(["new.json", "old.json"]);
  });
});

describe("deepFreeze", () => {
  it("freezes nested values", () => {
    const value = deepFreeze({ components: { U1: { pins: { "1": "" } } } });
    expect(() => {
      (value.components.U1.pins as Record<string, string>)["1"] = "NC";
    }).toThrow(TypeError);
  });
});

describe.skipIf(!hasFixtures)("the service's parse cache", () => {
  const source = fixturePath("cadence", "multio", "MULTIO.DSN");

  const reader = async () => {
    const bytes = { current: new Uint8Array(await readFile(source)) };
    const files: FileReader = {
      readFile: async () => bytes.current,
      exists: async () => true,
    };
    return { files, bytes };
  };

  it("parses a design once, until a file it read changes", async () => {
    const parse = vi.spyOn(parsers, "parseDesign");
    const { files, bytes } = await reader();
    const service = createNetlistService({ files });
    const first = await service.listNets({ design: "/m/MULTIO.DSN" });
    expect(await service.searchNets({ design: "/m/MULTIO.DSN", pattern: "^GPIO" })).toMatchObject({
      results: { MULTIO: ["GPIO0/2", "GPIO1/3", "GPIO14"] },
    });
    expect(await service.listNets({ design: "/m/MULTIO.DSN" })).toEqual(first);
    expect(parse).toHaveBeenCalledTimes(1);

    bytes.current = new Uint8Array(bytes.current);
    bytes.current[bytes.current.length - 1] ^= 0xff;
    await service.listNets({ design: "/m/MULTIO.DSN" });
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it("parses on every query with cache: false", async () => {
    const parse = vi.spyOn(parsers, "parseDesign");
    const { files } = await reader();
    const service = createNetlistService({ files, cache: false });
    await service.listNets({ design: "/m/MULTIO.DSN" });
    await service.listNets({ design: "/m/MULTIO.DSN" });
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it("answers a new process from the disk cache, with the result the parse gave", async () => {
    const dir = path.join(scratch, "service-disk");
    const { files } = await reader();
    const first = createNetlistService({ files, cache: { dir } });
    const parsed = await first.queryComponent({ design: "/m/MULTIO.DSN", refdes: "U1" });

    const parse = vi.spyOn(parsers, "parseDesign");
    const second = createNetlistService({ files, cache: { dir } });
    expect(await second.queryComponent({ design: "/m/MULTIO.DSN", refdes: "U1" })).toEqual(parsed);
    expect(parse).not.toHaveBeenCalled();
  });

  it("serves an unconnected pin as NC without changing the cached parse", async () => {
    const service = createNetlistService();
    const design = fixturePath("cadence", "multio", "MULTIO.DSN");
    const nets = await service.listNets({ design });
    expect(nets).toMatchObject({ nets: expect.arrayContaining(["NC"]) });
    expect(await service.listNets({ design })).toEqual(nets);
  });
});
