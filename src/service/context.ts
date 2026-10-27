/**
 * What a tool runs against: the parser context it reads designs through, the
 * directory relative paths resolve against, and the parse cache.
 */

import { parserContextFromEnvironment, type ParserContext } from "../parsers/context.js";
import { DEFAULT_MAX_ENTRIES, MemoryCacheStore, type CacheStore } from "./cache.js";

export interface ServiceContext {
  readonly parser: ParserContext;
  /**
   * The directory a relative design or search path resolves against. Omitted,
   * the process's working directory at the time of the call.
   */
  readonly root?: string;
  /** Where parses are kept between queries. Omitted, every query parses. */
  readonly cache?: CacheStore;
}

/** How many parses the MCP server keeps in memory; 0 turns the cache off. */
export const CACHE_ENTRIES_ENV = "UNIVERSAL_NETLIST_CACHE_ENTRIES";

/** The in-memory entry count the environment sets, or the default. */
export const cacheEntriesFromEnvironment = (env: NodeJS.ProcessEnv = process.env): number => {
  const raw = env[CACHE_ENTRIES_ENV]?.trim();
  const entries = raw ? Number(raw) : NaN;
  return Number.isInteger(entries) && entries >= 0 ? entries : DEFAULT_MAX_ENTRIES;
};

/**
 * One memory cache per entry count, shared by every environment context in the
 * process, so the positional functions, which build a context per call, still
 * reuse a parse.
 */
const sharedStores = new Map<number, MemoryCacheStore>();
const sharedMemoryStore = (entries: number): MemoryCacheStore | undefined => {
  if (entries <= 0) return undefined;
  let store = sharedStores.get(entries);
  if (!store) {
    store = new MemoryCacheStore(entries);
    sharedStores.set(entries, store);
  }
  return store;
};

/**
 * The local disk, the environment's settings and a process-wide memory cache,
 * as the MCP server and the CLI run.
 */
export const serviceContextFromEnvironment = (
  env: NodeJS.ProcessEnv = process.env
): ServiceContext => {
  const cache = sharedMemoryStore(cacheEntriesFromEnvironment(env));
  return { parser: parserContextFromEnvironment(env), ...(cache ? { cache } : {}) };
};
