/**
 * Variant Do Not Stuff for the .dat path
 *
 * `list_designs` hands out `pstxnet.dat` for any design that has one, so that is
 * the path queries arrive with and the PST triad is what answers them. A variant's
 * unstuffed parts are not written there: they keep an ordinary `VALUE` and both
 * `NODE_NAME`s, and the flag stays behind in the .DSN's `CIS/VariantStore`. This
 * reads it from the schematic beside the netlist so both paths answer alike.
 *
 * Resolving it costs parsing the .DSN's page streams, which is the schematic's
 * whole cost and dwarfs the triad's, so the answer is held for the file that
 * produced it and recomputed when that file changes.
 */

import { promises as fs } from "fs";
import path from "path";
import { findCadenceDatFiles, normalizeForComparison } from "./discovery.js";
import { readVariantDnsFromFile } from "./dsn/variant-store.js";

/** Sibling .DSN for a netlist directory, or null where there is no single answer. */
const designFileCache = new Map<string, string | null>();

/** Unstuffed refdes, keyed by the .DSN file that yielded them. */
const dnsCache = new Map<string, Set<string>>();

const samePath = (a: string, b: string): boolean =>
  normalizeForComparison(a) === normalizeForComparison(b);

/**
 * The .DSN a netlist directory belongs to.
 *
 * Cadence exports the triad into a subdirectory of the schematic's own
 * (`<design>/allegro/pstxnet.dat`), so the schematic is at or above the netlist.
 * A directory holding more than one .DSN is left alone rather than guessed at,
 * and the candidate is accepted only when discovery, asked from the schematic's
 * side, hands back this very netlist. Answering with a neighbour's variants
 * would mark parts unstuffed that this design stuffs, so the answer is either
 * right or absent.
 */
async function findDesignFile(pstxnetPath: string): Promise<string | null> {
  const datDir = path.dirname(pstxnetPath);
  const cached = designFileCache.get(datDir);
  if (cached !== undefined) return cached;

  let answer: string | null = null;
  for (const dir of [datDir, path.dirname(datDir)]) {
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      break;
    }

    const candidates = names.filter((n) => n.toLowerCase().endsWith(".dsn"));
    if (candidates.length === 0) continue;
    if (candidates.length > 1) break;

    const candidate = path.join(dir, candidates[0]);
    try {
      const datFiles = await findCadenceDatFiles(candidate);
      if (datFiles.pstxnet && samePath(datFiles.pstxnet, pstxnetPath)) answer = candidate;
    } catch {
      answer = null;
    }
    break;
  }

  designFileCache.set(datDir, answer);
  return answer;
}

/**
 * Read the refdes a design's variants leave unstuffed, for a netlist path.
 *
 * Returns an empty set whenever the schematic cannot be named, cannot be read,
 * or declares no variants, so the netlist still answers on its own terms.
 */
export async function readDatVariantDns(pstxnetPath: string): Promise<Set<string>> {
  const designFile = await findDesignFile(pstxnetPath);
  if (!designFile) return new Set();

  let key: string;
  try {
    const stat = await fs.stat(designFile);
    key = `${normalizeForComparison(designFile)}:${stat.mtimeMs}:${stat.size}`;
  } catch {
    return new Set();
  }

  const cached = dnsCache.get(key);
  if (cached) return cached;

  let dns: Set<string>;
  try {
    dns = readVariantDnsFromFile(designFile);
  } catch {
    dns = new Set();
  }

  dnsCache.set(key, dns);
  return dns;
}
