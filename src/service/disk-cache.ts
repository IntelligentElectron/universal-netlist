/**
 * Disk cache for parses, so a command line run in a new process each time can
 * answer from an earlier run's parse.
 *
 * It never fails a query: a directory that cannot be written, an entry that is
 * missing, unreadable, corrupt or written by another version is a miss, and
 * the query parses and answers as it would without a cache. Entries are written
 * to a temporary file and renamed into place, so a process (or a container
 * sharing the volume) reading at the same moment sees the old entry or the new
 * one, never part of one. Past a size cap the least recently used entries go.
 *
 * Entries are this module's own versioned JSON, not Universal Netlist JSON:
 * that schema does not carry `alternate_part` or the net label sources behind
 * `net_name_warnings`, both of which queries report.
 */

import { constants } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { VERSION } from "../version.js";
import type { CacheEntry, CacheStore, Probe } from "./cache.js";

/** Bumped whenever an entry's layout changes, so an old entry is a miss. */
export const DISK_CACHE_FORMAT_VERSION = 1;
const FORMAT = "universal-netlist-parse-cache";

/** Default cap on the directory's entries: 256 MiB. */
export const DEFAULT_MAX_BYTES = 256 * 1024 * 1024;

/** The directory name used under XDG_CACHE_HOME, ~/.cache and the temp directory. */
export const CACHE_DIRECTORY_NAME = "universal-netlist";

export const CACHE_ENV = "UNIVERSAL_NETLIST_CACHE";
export const CACHE_DIR_ENV = "UNIVERSAL_NETLIST_CACHE_DIR";
export const CACHE_MAX_MB_ENV = "UNIVERSAL_NETLIST_CACHE_MAX_MB";

interface EntryFile {
  format: typeof FORMAT;
  formatVersion: number;
  packageVersion: string;
  key: string;
  probes: Probe[];
  value: unknown;
}

const isEntryFile = (raw: unknown, key: string): raw is EntryFile => {
  if (!raw || typeof raw !== "object") return false;
  const file = raw as Partial<EntryFile>;
  return (
    file.format === FORMAT &&
    file.formatVersion === DISK_CACHE_FORMAT_VERSION &&
    file.packageVersion === VERSION &&
    file.key === key &&
    Array.isArray(file.probes) &&
    file.probes.every(
      (probe) =>
        probe &&
        typeof probe === "object" &&
        typeof probe.kind === "string" &&
        typeof probe.path === "string" &&
        typeof probe.answer === "string"
    ) &&
    "value" in file
  );
};

/** Entries as JSON files in one directory. */
export class DiskCacheStore implements CacheStore {
  constructor(
    readonly dir: string,
    readonly maxBytes = DEFAULT_MAX_BYTES
  ) {}

  private file(key: string): string {
    return path.join(this.dir, `${key}.json`);
  }

  async get(key: string): Promise<CacheEntry | undefined> {
    const file = this.file(key);
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(file, "utf-8"));
    } catch {
      return undefined;
    }
    if (!isEntryFile(raw, key)) return undefined;
    // A hit is recent use; eviction goes by modification time.
    const now = new Date();
    await utimes(file, now, now).catch(() => {});
    return { probes: raw.probes, value: raw.value };
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    const body: EntryFile = {
      format: FORMAT,
      formatVersion: DISK_CACHE_FORMAT_VERSION,
      packageVersion: VERSION,
      key,
      probes: [...entry.probes],
      value: entry.value,
    };
    const file = this.file(key);
    const temporary = `${file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    try {
      await mkdir(this.dir, { recursive: true });
      await writeFile(temporary, JSON.stringify(body));
      await rename(temporary, file);
    } catch {
      await unlink(temporary).catch(() => {});
      return;
    }
    await this.evict().catch(() => {});
  }

  /**
   * Remove the least recently used entries until the directory is under its
   * cap, and temporary files a crashed writer left behind. Another process may
   * be evicting at the same time, so a file already gone is not an error.
   */
  async evict(): Promise<void> {
    const names = await readdir(this.dir);
    const entries: { file: string; size: number; mtime: number }[] = [];
    const hour = Date.now() - 60 * 60 * 1000;
    for (const name of names) {
      const file = path.join(this.dir, name);
      const info = await stat(file).catch(() => undefined);
      if (!info?.isFile()) continue;
      if (name.endsWith(".tmp")) {
        if (info.mtimeMs < hour) await unlink(file).catch(() => {});
        continue;
      }
      if (name.endsWith(".json")) entries.push({ file, size: info.size, mtime: info.mtimeMs });
    }
    let total = entries.reduce((sum, entry) => sum + entry.size, 0);
    entries.sort((a, b) => a.mtime - b.mtime);
    for (const entry of entries) {
      if (total <= this.maxBytes) break;
      await unlink(entry.file).catch(() => {});
      total -= entry.size;
    }
  }
}

// =============================================================================
// Configuration
// =============================================================================

const ON = new Set(["1", "true", "yes", "on"]);
const OFF = new Set(["0", "false", "no", "off"]);

/**
 * Whether the disk cache is on. A `--cache` flag turns it on for that call.
 * Otherwise `UNIVERSAL_NETLIST_CACHE` decides when it is set to an on or off
 * word, and naming a directory in `UNIVERSAL_NETLIST_CACHE_DIR` turns it on.
 */
export const diskCacheEnabled = (flag: boolean, env: NodeJS.ProcessEnv = process.env): boolean => {
  if (flag) return true;
  const setting = env[CACHE_ENV]?.trim().toLowerCase() ?? "";
  if (ON.has(setting)) return true;
  if (OFF.has(setting)) return false;
  return Boolean(env[CACHE_DIR_ENV]?.trim());
};

/** What `resolveDiskCacheDir` asks of the machine, so tests can answer for it. */
export interface CacheDirHost {
  /** The user's home directory, or undefined when there is none. */
  homedir(): string | undefined;
  tmpdir(): string;
  /** Create the directory if needed, and say whether it can be written. */
  writable(dir: string): Promise<boolean>;
}

const homedirOrNone = (): string | undefined => {
  try {
    const home = os.homedir();
    return home && path.isAbsolute(home) ? home : undefined;
  } catch {
    // No HOME and no passwd entry, as in a container run as an arbitrary uid.
    return undefined;
  }
};

export const nodeCacheDirHost: CacheDirHost = {
  homedir: homedirOrNone,
  tmpdir: () => os.tmpdir(),
  writable: async (dir) => {
    try {
      await mkdir(dir, { recursive: true });
      await access(dir, constants.W_OK);
      return true;
    } catch {
      return false;
    }
  },
};

/**
 * The directory the disk cache uses, or undefined when there is none to write.
 *
 * `UNIVERSAL_NETLIST_CACHE_DIR` is used as it is, or not at all: a cache named
 * on purpose does not move somewhere else. Otherwise the first writable of
 * `$XDG_CACHE_HOME/universal-netlist` (when it is an absolute path, as the XDG
 * spec requires), `~/.cache/universal-netlist`, and the temp directory's
 * `universal-netlist`, so a read-only root filesystem or a missing home
 * directory falls through to a writable temp mount.
 */
export const resolveDiskCacheDir = async (
  env: NodeJS.ProcessEnv = process.env,
  host: CacheDirHost = nodeCacheDirHost
): Promise<string | undefined> => {
  const named = env[CACHE_DIR_ENV]?.trim();
  if (named) {
    const dir = path.resolve(named);
    return (await host.writable(dir)) ? dir : undefined;
  }

  const candidates: string[] = [];
  const xdg = env.XDG_CACHE_HOME?.trim();
  if (xdg && path.isAbsolute(xdg)) candidates.push(path.join(xdg, CACHE_DIRECTORY_NAME));
  const home = host.homedir();
  if (home) candidates.push(path.join(home, ".cache", CACHE_DIRECTORY_NAME));
  candidates.push(path.join(host.tmpdir(), CACHE_DIRECTORY_NAME));

  for (const dir of candidates) {
    if (await host.writable(dir)) return dir;
  }
  return undefined;
};

/** The size cap `UNIVERSAL_NETLIST_CACHE_MAX_MB` sets, or the default. */
export const diskCacheMaxBytes = (env: NodeJS.ProcessEnv = process.env): number => {
  const megabytes = Number(env[CACHE_MAX_MB_ENV]);
  return Number.isFinite(megabytes) && megabytes > 0
    ? Math.floor(megabytes * 1024 * 1024)
    : DEFAULT_MAX_BYTES;
};
