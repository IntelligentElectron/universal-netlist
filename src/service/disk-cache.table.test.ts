/**
 * Replays the golden disk-cache tables in docs/decision-tables/disk-cache
 * against `diskCacheEnabled` and `resolveDiskCacheDir`, one test per cell.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cellName, readTable } from "../../test/helpers/decision-table.js";
import {
  CACHE_DIRECTORY_NAME,
  CACHE_DIR_ENV,
  CACHE_ENV,
  tmpCacheDirectoryName,
  diskCacheEnabled,
  resolveDiskCacheDir,
  type CacheDirHost,
} from "./disk-cache.js";

const TABLES = path.resolve(__dirname, "../../docs/decision-tables/disk-cache");

describe("golden table: enabled", () => {
  const dims = ["flag", "cache_env", "dir_env"];
  const words = { unset: undefined, on: " Yes ", off: "OFF", other: "maybe" } as Record<
    string,
    string | undefined
  >;
  for (const row of readTable(TABLES, "enabled")) {
    it(cellName(row, dims), () => {
      const env: NodeJS.ProcessEnv = {};
      if (words[row.cache_env] !== undefined) env[CACHE_ENV] = words[row.cache_env];
      if (row.dir_env === "set") env[CACHE_DIR_ENV] = "/cache";
      expect(diskCacheEnabled(row.flag === "present", env) ? "on" : "off").toBe(row.outcome);
    });
  }
});

describe("golden table: location", () => {
  const dims = ["named", "xdg", "home", "tmp"];
  const NAMED = path.resolve("/volumes/cache");
  const XDG = path.resolve("/xdg");
  const HOME = path.resolve("/home/agent");
  const TMP = path.resolve("/tmp");
  const expected: Record<string, string | undefined> = {
    "named dir": NAMED,
    "xdg dir": path.join(XDG, CACHE_DIRECTORY_NAME),
    "home dir": path.join(HOME, ".cache", CACHE_DIRECTORY_NAME),
    "tmp dir": path.join(TMP, tmpCacheDirectoryName()),
    "no disk cache": undefined,
  };

  for (const row of readTable(TABLES, "location")) {
    it(cellName(row, dims), async () => {
      const env: NodeJS.ProcessEnv = {};
      if (row.named !== "unset") env[CACHE_DIR_ENV] = NAMED;
      if (row.xdg === "relative") env.XDG_CACHE_HOME = "relative/cache";
      else if (row.xdg !== "unset") env.XDG_CACHE_HOME = XDG;
      const writable = new Set<string>();
      if (row.named === "writable") writable.add(NAMED);
      if (row.xdg === "writable") writable.add(expected["xdg dir"]!);
      if (row.home === "writable") writable.add(expected["home dir"]!);
      if (row.tmp === "writable") writable.add(expected["tmp dir"]!);
      // A relative XDG_CACHE_HOME resolved against the working directory must
      // never be chosen, so it is writable here.
      writable.add(path.resolve("relative/cache", CACHE_DIRECTORY_NAME));
      const host: CacheDirHost = {
        homedir: () => (row.home === "none" ? undefined : HOME),
        tmpdir: () => TMP,
        writable: async (dir, isPrivate) => {
          // Only the named directory is taken as the user gives it.
          expect(isPrivate).toBe(dir !== NAMED);
          return writable.has(dir);
        },
      };
      const location = await resolveDiskCacheDir(env, host);
      expect(location?.dir).toBe(expected[row.outcome]);
      if (location) expect(location.isPrivate).toBe(row.outcome !== "named dir");
    });
  }
});
