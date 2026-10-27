/**
 * Parse cache.
 *
 * A parse is stored with every file probe it made: each file it read (by
 * content hash), each path it checked for, each directory it listed. A later
 * load of the same design, variant and package version repeats those probes
 * and reuses the parse only when every answer is the same, so the entry is in
 * effect keyed by the content hash of every file the design reads. Editing a
 * sheet, adding a saved `.net` export beside a KiCad project, or upgrading the
 * package each makes the next load parse again.
 *
 * Two kinds of entry share the cache: a design's variant list and one parsed
 * build. A parse that fails is not stored, and neither is a password-protected
 * design, so its decrypted content never outlives the passwords that opened it.
 *
 * Cached values are deep-frozen: every caller shares one parse, and a caller
 * that tried to change it would change every later answer.
 */

import { createHash } from "node:crypto";
import type { DirEntry, FileReader, ParserContext } from "../parsers/context.js";
import { VERSION } from "../version.js";

// =============================================================================
// File probes
// =============================================================================

/** One thing a parse learned from its file reader, and what it learned. */
export type Probe =
  | { readonly kind: "read"; readonly path: string; readonly answer: string }
  | { readonly kind: "exists"; readonly path: string; readonly answer: string }
  | { readonly kind: "list"; readonly path: string; readonly answer: string }
  | {
      readonly kind: "prefix";
      readonly path: string;
      readonly length: number;
      readonly answer: string;
    };

const sha256 = (data: Uint8Array | string): string =>
  createHash("sha256").update(data).digest("hex");

/** A probe's answer when the reader threw: the error's code, which a retry compares. */
const failure = (error: unknown): string => {
  const code = (error as { code?: unknown } | null)?.code;
  return `error:${typeof code === "string" ? code : "unknown"}`;
};

const listing = (entries: readonly DirEntry[]): string =>
  sha256(
    entries
      .map((entry) => `${entry.isDirectory() ? "d" : entry.isFile() ? "f" : "o"}:${entry.name}`)
      .sort()
      .join("\n")
  );

const probeKey = (probe: Pick<Probe, "kind" | "path"> & { length?: number }): string =>
  `${probe.kind}\0${probe.path}\0${probe.length ?? ""}`;

/**
 * Wrap a reader so every call is noted with its answer. A call that throws is
 * noted too, by its error code, and still throws.
 */
export const recordProbes = (files: FileReader): { files: FileReader; probes: () => Probe[] } => {
  const probes = new Map<string, Probe>();
  const note = (probe: Probe) => probes.set(probeKey(probe), probe);

  const recorded = async <T>(
    run: () => Promise<T>,
    answer: (value: T) => string,
    make: (answer: string) => Probe
  ): Promise<T> => {
    try {
      const value = await run();
      note(make(answer(value)));
      return value;
    } catch (error) {
      note(make(failure(error)));
      throw error;
    }
  };

  const wrapped: FileReader = {
    readFile: (path) =>
      recorded(
        () => files.readFile(path),
        sha256,
        (answer) => ({ kind: "read", path, answer })
      ),
    exists: (path) =>
      recorded(
        () => files.exists(path),
        String,
        (answer) => ({ kind: "exists", path, answer })
      ),
    ...(files.listDir
      ? {
          listDir: (path: string) =>
            recorded(
              () => files.listDir!(path),
              listing,
              (answer) => ({ kind: "list", path, answer })
            ),
        }
      : {}),
    ...(files.readPrefix
      ? {
          readPrefix: (path: string, length: number) =>
            recorded(
              () => files.readPrefix!(path, length),
              sha256,
              (answer) => ({ kind: "prefix", path, length, answer })
            ),
        }
      : {}),
  };
  return { files: wrapped, probes: () => [...probes.values()] };
};

/** Repeat one probe on a reader, and return the answer it gives now. */
const askAgain = async (probe: Probe, files: FileReader): Promise<string> => {
  try {
    switch (probe.kind) {
      case "read":
        return sha256(await files.readFile(probe.path));
      case "exists":
        return String(await files.exists(probe.path));
      case "list":
        if (!files.listDir) return "error:unlistable";
        return listing(await files.listDir(probe.path));
      case "prefix":
        if (!files.readPrefix)
          return sha256((await files.readFile(probe.path)).subarray(0, probe.length));
        return sha256(await files.readPrefix(probe.path, probe.length));
    }
  } catch (error) {
    return failure(error);
  }
};

/** Whether every probe gives the answer it gave when the entry was stored. */
export const probesHold = async (probes: readonly Probe[], files: FileReader): Promise<boolean> => {
  const answers = await Promise.all(probes.map((probe) => askAgain(probe, files)));
  return answers.every((answer, index) => answer === probes[index].answer);
};

// =============================================================================
// Entries
// =============================================================================

/** What an entry is of: a design's variant list, or one parsed build. */
export interface CacheSlot {
  readonly kind: "variants" | "netlist";
  /** The design's absolute path. */
  readonly path: string;
  /** The build, for a netlist entry. */
  readonly variant?: string;
}

/** A stored value and the probes it depends on. */
export interface CacheEntry {
  readonly probes: readonly Probe[];
  readonly value: unknown;
}

/** Where entries are kept: memory, disk, or both. */
export interface CacheStore {
  get(key: string): Promise<CacheEntry | undefined>;
  set(key: string, entry: CacheEntry): Promise<void>;
}

/**
 * The key an entry is stored under. The package version is part of it, so an
 * upgrade never answers from a parse an older parser made.
 */
export const slotKey = (slot: CacheSlot, version = VERSION): string =>
  sha256(JSON.stringify([version, slot.kind, slot.path, slot.variant ?? null]));

/** Freeze a value and everything it holds. */
export const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

/**
 * In-memory entries, the least recently used dropped first once there are
 * more than `maxEntries`. A `maxEntries` of 0 keeps nothing.
 */
export class MemoryCacheStore implements CacheStore {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(readonly maxEntries: number) {}

  async get(key: string): Promise<CacheEntry | undefined> {
    const entry = this.entries.get(key);
    if (entry) {
      // Map order is insertion order, so moving a hit to the end keeps the
      // least recently used entry first.
      this.entries.delete(key);
      this.entries.set(key, entry);
    }
    return entry;
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    if (this.maxEntries <= 0) return;
    this.entries.delete(key);
    this.entries.set(key, entry);
    while (this.entries.size > this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value!);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}

/** Memory in front of a slower store; a hit in the slower one is kept in memory too. */
export class TieredCacheStore implements CacheStore {
  constructor(
    private readonly memory: CacheStore,
    private readonly slower: CacheStore
  ) {}

  async get(key: string): Promise<CacheEntry | undefined> {
    const fast = await this.memory.get(key);
    if (fast) return fast;
    const slow = await this.slower.get(key);
    if (slow) await this.memory.set(key, slow);
    return slow;
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    await this.memory.set(key, entry);
    await this.slower.set(key, entry);
  }
}

/** Default number of in-memory entries: a few designs, each with a variant list and a build or two. */
export const DEFAULT_MAX_ENTRIES = 8;

/**
 * Answer from the store when the entry's probes still hold; otherwise run
 * `produce` against a recording reader and store what it returns. A store that
 * fails is skipped, never failing the answer.
 */
export const cached = async <T>(
  store: CacheStore | undefined,
  slot: CacheSlot,
  context: ParserContext,
  produce: (context: ParserContext) => Promise<T>,
  prepare: (value: T) => T = (value) => value
): Promise<T> => {
  if (!store) return prepare(await produce(context));

  const key = slotKey(slot);
  const entry = await store.get(key).catch(() => undefined);
  if (entry && (await probesHold(entry.probes, context.files))) {
    return deepFreeze(entry.value) as T;
  }

  const recording = recordProbes(context.files);
  let opened = false;
  const passwords = context.dsnPasswords;
  const value = prepare(
    await produce({
      ...context,
      files: recording.files,
      // Asked for passwords only when a design is protected.
      dsnPasswords: {
        configuredBy: passwords.configuredBy,
        list: () => {
          opened = true;
          return passwords.list();
        },
      },
    })
  );
  // A parse that read nothing has nothing to check an entry against later.
  const probes = recording.probes();
  if (!opened && probes.length > 0) {
    await store.set(key, { probes, value: deepFreeze(value) }).catch(() => {});
  }
  return value;
};
