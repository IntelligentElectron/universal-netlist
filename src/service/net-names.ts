/**
 * Net names with leading or trailing whitespace, and names a netlister writes
 * differently from the schematic.
 *
 * Every tool reports a net under the name its schematic gives it, whitespace
 * and length included, because that is the name the designer can find and fix.
 * The Cadence Allegro netlister writes some of those names differently, and a
 * name taken from its export, or from a mating board's, then finds nothing.
 * Two rewrites are known from real exports (issue #235):
 *
 * - Leading and trailing whitespace is trimmed, by every writer checked
 *   (PSTWRITER 17.4 and 23.1). `"SIGNAL_A "` is written `SIGNAL_A`. The trimmed
 *   name is computed at export; the schematic stores only the raw one.
 * - Names over 31 characters are cut to 31 by PSTWRITER 16.6. Writers 17.4,
 *   23.1 and 25.1 write them in full, so a cut name is only a lookup alias here
 *   and never a net's netlist name.
 *
 * Both are Allegro behaviour and apply to Cadence designs only. Other formats
 * get the whitespace checks without them.
 *
 * Where two nets read the same once trimmed, the netlister renames one of them
 * (warning ORCAP-36005), and which one, under which suffix, is decided at
 * export and stored nowhere in the schematic. Those nets get no netlist name.
 * The same holds for a padded label inside a hierarchical block, where the
 * placement suffix follows the whitespace (`"SIG _U1"`): nothing shows how the
 * netlister writes it. A lookup that could mean several nets returns them all
 * rather than guessing.
 */

import { hasEdgeWhitespace } from "../net-categories.js";
import type { NetLabelSource, NetNameWarning } from "../types.js";

/** The net-name length PSTWRITER 16.6 cuts to. Later writers keep names whole. */
export const LEGACY_NETLIST_NAME_LIMIT = 31;

/** The no-connect placeholder every loader writes; it names no net. */
const NO_CONNECT = "NC";

/** How a name passed to a lookup resolved to a net. */
export type NetNameResolution =
  | { status: "exact"; net: string }
  /** The name matches one net once leading and trailing whitespace is ignored. */
  | { status: "whitespace"; net: string }
  /** The name is the 31-character prefix a PSTWRITER 16.6 export gives one net. */
  | { status: "truncated"; net: string }
  | {
      status: "ambiguous";
      reason: "whitespace" | "truncated" | "whitespace_or_truncated";
      candidates: string[];
    }
  | { status: "missing" };

export interface NetNameIndexOptions {
  /** Objects whose padded text names a net, keyed by that net (Cadence .DSN only). */
  sources?: Record<string, NetLabelSource[]>;
  /** Whether the design is Cadence, so the Allegro netlister's rules apply. */
  allegro?: boolean;
}

const quote = (name: string): string => JSON.stringify(name);

const PROBLEM_TEXT: Record<NetNameWarning["problem"], string> = {
  leading_whitespace: "leading whitespace",
  trailing_whitespace: "trailing whitespace",
  leading_and_trailing_whitespace: "leading and trailing whitespace",
  whitespace_only: "only whitespace",
  whitespace_before_block_suffix: "whitespace before its block placement suffix",
};

const edgeProblem = (name: string): NetNameWarning["problem"] => {
  const trimmed = name.trim();
  if (trimmed === "") return "whitespace_only";
  const leading = !name.startsWith(trimmed);
  const trailing = !name.endsWith(trimmed);
  if (leading && trailing) return "leading_and_trailing_whitespace";
  return leading ? "leading_whitespace" : "trailing_whitespace";
};

/** Index of a design's net names, built once per tool call. */
export class NetNameIndex {
  private readonly names: string[];
  private readonly nameSet: Set<string>;
  private readonly allegro: boolean;
  private readonly sources: Record<string, NetLabelSource[]>;
  /** Each net's names with the label whitespace removed. */
  private readonly keysOf = new Map<string, Set<string>>();
  /** Whitespace-free key to every net that reads as it. */
  private readonly byKey = new Map<string, string[]>();
  private readonly warnings = new Map<string, NetNameWarning>();

  constructor(netNames: Iterable<string>, options: NetNameIndexOptions = {}) {
    const all = [...netNames];
    // Exact lookups see every name; the whitespace keys and collisions leave
    // out the no-connect placeholder, as ERC does.
    this.nameSet = new Set(all);
    this.names = all.filter((n) => n !== NO_CONNECT);
    this.allegro = options.allegro ?? false;
    this.sources = options.sources ?? {};

    for (const name of this.names) {
      const keys = new Set([name.trim()]);
      // A padded label inside a block keeps its whitespace ahead of the
      // placement suffix: "SIG _U1" reads as "SIG_U1".
      for (const { text } of this.sources[name] ?? []) {
        if (name.startsWith(text)) keys.add(text.trim() + name.slice(text.length));
      }
      this.keysOf.set(name, keys);
      for (const key of keys) {
        const group = this.byKey.get(key) ?? [];
        group.push(name);
        this.byKey.set(key, group);
      }
    }
    for (const name of this.names) {
      if (this.isFlagged(name)) this.warnings.set(name, this.buildWarning(name));
    }
  }

  private isFlagged(name: string): boolean {
    return hasEdgeWhitespace(name) || (this.sources[name]?.length ?? 0) > 0;
  }

  /** Other nets that read the same as this one with the label whitespace removed. */
  private sameAs(name: string): string[] {
    const others = new Set<string>();
    for (const key of this.keysOf.get(name) ?? []) {
      for (const other of this.byKey.get(key) ?? []) if (other !== name) others.add(other);
    }
    return [...others].sort();
  }

  private buildWarning(name: string): NetNameWarning {
    const problem = hasEdgeWhitespace(name) ? edgeProblem(name) : "whitespace_before_block_suffix";
    const others = this.sameAs(name);
    const warning: NetNameWarning = { net: name, problem, message: "" };
    const what = `Net name ${quote(name)} has ${PROBLEM_TEXT[problem]}`;

    if (problem === "whitespace_only") {
      warning.message = `${what}. Rename the object that names it.`;
    } else if (others.length > 0) {
      warning.same_name_after_trim = others;
      warning.message =
        `${what} and reads the same as ${others.map(quote).join(", ")} once the whitespace ` +
        `is removed. They are separate nets, drawn with what reads as one name.` +
        (this.allegro
          ? ` The Allegro netlister renames one of them (warning ORCAP-36005) when it ` +
            `exports, so neither name is known to match the export: compare them by connectivity.`
          : "");
    } else if (problem === "whitespace_before_block_suffix") {
      warning.message =
        `${what}: a label inside a hierarchical block carries the whitespace. ` +
        (this.allegro
          ? `How the Allegro netlister writes this name is not known from the schematic, ` +
            `so compare it by connectivity, and fix the label.`
          : `Fix the label.`);
    } else if (this.allegro) {
      warning.netlist_name = name.trim();
      warning.message =
        `${what}. The Allegro netlister trims it and writes ${quote(name.trim())}, which ` +
        `is the name to compare against an export or another design.`;
    } else {
      warning.message = `${what}, which reads the same as ${quote(name.trim())}. Fix the label.`;
    }

    const where = this.sources[name];
    if (where && where.length > 0) warning.sources = where;
    return warning;
  }

  /** The warning for one net, when its name needs one. */
  warningFor(net: string): NetNameWarning | undefined {
    return this.warnings.get(net);
  }

  /** The warnings for the nets given, once each, in name order. */
  warningsFor(nets: Iterable<string>): NetNameWarning[] {
    const seen = new Set<string>();
    const out: NetNameWarning[] = [];
    for (const net of nets) {
      if (seen.has(net)) continue;
      seen.add(net);
      const warning = this.warnings.get(net);
      if (warning) out.push(warning);
    }
    return out.sort((a, b) => a.net.localeCompare(b.net));
  }

  /** Every net whose name carries label whitespace, in name order. */
  flaggedNets(): string[] {
    return [...this.warnings.keys()].sort();
  }

  /**
   * Every net that reads the same as another once label whitespace is removed,
   * where at least one of them carries it, in name order.
   */
  collidingNets(): string[] {
    const out = new Set<string>();
    for (const group of this.byKey.values()) {
      const distinct = [...new Set(group)];
      if (distinct.length > 1 && distinct.some((n) => this.warnings.has(n))) {
        for (const n of distinct) out.add(n);
      }
    }
    return [...out].sort();
  }

  /**
   * Resolve a name a caller passed to the net it means.
   *
   * An exact match always wins, so this never moves a name onto another net.
   * Otherwise the name is matched ignoring label whitespace on both sides, and,
   * for a Cadence design, as the 31-character prefix a PSTWRITER 16.6 export
   * writes. One match resolves; more than one returns them all.
   */
  resolve(input: string): NetNameResolution {
    if (this.nameSet.has(input)) return { status: "exact", net: input };

    const key = input.trim();
    if (key === "") return { status: "missing" };

    const byWhitespace = [...new Set(this.byKey.get(key) ?? [])];
    const byTruncation =
      this.allegro && key.length === LEGACY_NETLIST_NAME_LIMIT
        ? this.names.filter(
            (n) =>
              !byWhitespace.includes(n) &&
              n.trim().length > LEGACY_NETLIST_NAME_LIMIT &&
              n.trim().startsWith(key)
          )
        : [];

    const candidates = [...byWhitespace, ...byTruncation].sort();
    if (candidates.length === 0) return { status: "missing" };
    if (candidates.length === 1) {
      return byWhitespace.length === 1
        ? { status: "whitespace", net: candidates[0] }
        : { status: "truncated", net: candidates[0] };
    }
    const reason =
      byTruncation.length === 0
        ? "whitespace"
        : byWhitespace.length === 0
          ? "truncated"
          : "whitespace_or_truncated";
    return { status: "ambiguous", reason, candidates };
  }
}

/** The warning a lookup adds when it matched a name other than exactly. */
export const describeResolution = (
  input: string,
  resolution: Extract<NetNameResolution, { status: "whitespace" | "truncated" }>
): string =>
  resolution.status === "whitespace"
    ? `No net is named ${quote(input)} exactly. It matched ${quote(resolution.net)}, which ` +
      `differs from it only by whitespace a label carries.`
    : `No net is named ${quote(input)} exactly. It matched ${quote(resolution.net)}: Allegro ` +
      `netlists written by PSTWRITER 16.6 cut net names to ${LEGACY_NETLIST_NAME_LIMIT} ` +
      `characters, and this is that net's cut name. PSTWRITER 17.4 and later write it in full.`;

/** The error a lookup returns when a name could mean more than one net. */
export const describeAmbiguity = (
  input: string,
  resolution: Extract<NetNameResolution, { status: "ambiguous" }>
): string => {
  const list = resolution.candidates.map(quote).join(", ");
  switch (resolution.reason) {
    case "whitespace":
      return (
        `Net ${quote(input)} is ambiguous: ${list} differ only by whitespace a label ` +
        `carries and are separate nets. Query one of them by its exact name.`
      );
    case "truncated":
      return (
        `Net ${quote(input)} is ambiguous: it is the first ${LEGACY_NETLIST_NAME_LIMIT} ` +
        `characters of ${list}, which a PSTWRITER 16.6 export cannot tell apart. Query one ` +
        `of them by its full name.`
      );
    case "whitespace_or_truncated":
      return (
        `Net ${quote(input)} is ambiguous: it could mean ${list}, which differ from it by ` +
        `whitespace or extend its first ${LEGACY_NETLIST_NAME_LIMIT} characters. Query one ` +
        `of them by its exact name.`
      );
  }
};

/** The index for a loaded design. */
export const indexNetNames = (netlist: {
  nets: Record<string, unknown>;
  netLabelSources?: Record<string, NetLabelSource[]>;
  format?: string;
}): NetNameIndex =>
  new NetNameIndex(Object.keys(netlist.nets), {
    sources: netlist.netLabelSources,
    allegro: netlist.format === "cadence",
  });
