/**
 * Net names the Allegro netlister writes differently from the schematic.
 *
 * Every tool reports a net under the name its schematic gives it, whitespace
 * and length included, because that is the name the designer can find and fix.
 * The netlister writes some of those names differently, and a name taken from
 * its export, or from a mating board's, then finds nothing. Two rewrites are
 * known from real exports (issue #235):
 *
 * - Leading and trailing whitespace is trimmed, by every writer checked
 *   (PSTWRITER 17.4 and 23.1). `"SIGNAL_A "` is written `SIGNAL_A`. The trimmed
 *   name is computed at export; the schematic stores only the raw one.
 * - Names over 31 characters are cut to 31 by PSTWRITER 16.6. Writers 17.4,
 *   23.1 and 25.1 write them in full, so a truncated name is only a lookup
 *   alias here and never a net's netlist name.
 *
 * Where two nets read the same once trimmed, the netlister renames one of them
 * (warning ORCAP-36005), and which one, under which suffix, is decided at
 * export and stored nowhere in the schematic. Those nets get no netlist name,
 * and a lookup that could mean either returns both rather than guessing.
 */

import type { NetLabelSource, NetNameWarning } from "../types.js";

/** The net-name length PSTWRITER 16.6 cuts to. Later writers keep names whole. */
export const LEGACY_NETLIST_NAME_LIMIT = 31;

/** How a name passed to a lookup resolved to a net. */
export type NetNameResolution =
  | { status: "exact"; net: string }
  /** The name matches one net once leading and trailing whitespace is ignored. */
  | { status: "whitespace"; net: string }
  /** The name is the 31-character prefix a PSTWRITER 16.6 export gives one net. */
  | { status: "truncated"; net: string }
  | { status: "ambiguous"; reason: "whitespace" | "truncated"; candidates: string[] }
  | { status: "missing" };

const hasPadding = (name: string): boolean => name !== name.trim();

const describeProblem = (name: string): NetNameWarning["problem"] => {
  const trimmed = name.trim();
  if (trimmed === "") return "whitespace_only";
  const leading = !name.startsWith(trimmed);
  const trailing = !name.endsWith(trimmed);
  if (leading && trailing) return "leading_and_trailing_whitespace";
  return leading ? "leading_whitespace" : "trailing_whitespace";
};

const PROBLEM_TEXT: Record<NetNameWarning["problem"], string> = {
  leading_whitespace: "leading whitespace",
  trailing_whitespace: "trailing whitespace",
  leading_and_trailing_whitespace: "leading and trailing whitespace",
  whitespace_only: "only whitespace",
};

const quote = (name: string): string => JSON.stringify(name);

/** Index of a design's net names, built once per tool call. */
export class NetNameIndex {
  private readonly names: string[];
  private readonly nameSet: Set<string>;
  /** Trimmed name to every net that reads as it. */
  private readonly byTrimmed = new Map<string, string[]>();
  private readonly warnings = new Map<string, NetNameWarning>();

  constructor(
    netNames: Iterable<string>,
    private readonly sources: Record<string, NetLabelSource[]> = {}
  ) {
    this.names = [...netNames];
    this.nameSet = new Set(this.names);
    for (const name of this.names) {
      const key = name.trim();
      const group = this.byTrimmed.get(key);
      if (group) group.push(name);
      else this.byTrimmed.set(key, [name]);
    }
    for (const name of this.names) {
      if (hasPadding(name)) this.warnings.set(name, this.buildWarning(name));
    }
  }

  private buildWarning(name: string): NetNameWarning {
    const problem = describeProblem(name);
    const trimmed = name.trim();
    const others = (this.byTrimmed.get(trimmed) ?? []).filter((n) => n !== name).sort();
    const warning: NetNameWarning = { net: name, problem, message: "" };

    if (problem === "whitespace_only") {
      warning.message =
        `Net name ${quote(name)} is ${PROBLEM_TEXT[problem]}. The Allegro netlister ` +
        `cannot write it as it stands; rename the object that names it.`;
    } else if (others.length > 0) {
      warning.same_name_after_trim = others;
      warning.message =
        `Net name ${quote(name)} has ${PROBLEM_TEXT[problem]} and reads the same as ` +
        `${others.map(quote).join(", ")} once trimmed. They are separate nets. The Allegro ` +
        `netlister renames one of them (warning ORCAP-36005) when it exports, so neither ` +
        `name is known to match the export: compare them by connectivity.`;
    } else {
      warning.netlist_name = trimmed;
      warning.message =
        `Net name ${quote(name)} has ${PROBLEM_TEXT[problem]}. The Allegro netlister ` +
        `trims it and writes ${quote(trimmed)}, which is the name to compare against an ` +
        `export or another design.`;
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

  /** Every net whose name needs a warning. */
  get paddedNets(): string[] {
    return [...this.warnings.keys()];
  }

  /**
   * Groups of two or more nets whose names read the same once trimmed, at
   * least one of them padded, keyed by the trimmed name.
   */
  collisions(): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const [trimmed, group] of this.byTrimmed) {
      if (group.length > 1 && group.some(hasPadding)) out.set(trimmed, [...group].sort());
    }
    return out;
  }

  /**
   * Resolve a name a caller passed to the net it means.
   *
   * An exact match always wins, so this never moves a name onto another net.
   * Otherwise the name is matched ignoring leading and trailing whitespace on
   * both sides, then as the 31-character prefix a PSTWRITER 16.6 export writes.
   * One match resolves; more than one returns them all.
   */
  resolve(input: string): NetNameResolution {
    if (this.nameSet.has(input)) return { status: "exact", net: input };

    const key = input.trim();
    if (key === "") return { status: "missing" };

    const byWhitespace = this.byTrimmed.get(key);
    if (byWhitespace && byWhitespace.length === 1) {
      return { status: "whitespace", net: byWhitespace[0] };
    }
    if (byWhitespace && byWhitespace.length > 1) {
      return { status: "ambiguous", reason: "whitespace", candidates: [...byWhitespace].sort() };
    }

    if (key.length === LEGACY_NETLIST_NAME_LIMIT) {
      const truncated = this.names
        .filter((n) => n.trim().length > LEGACY_NETLIST_NAME_LIMIT && n.trim().startsWith(key))
        .sort();
      if (truncated.length === 1) return { status: "truncated", net: truncated[0] };
      if (truncated.length > 1) {
        return { status: "ambiguous", reason: "truncated", candidates: truncated };
      }
    }

    return { status: "missing" };
  }
}

/** The warning a lookup adds when it matched a name other than exactly. */
export const describeResolution = (
  input: string,
  resolution: Extract<NetNameResolution, { status: "whitespace" | "truncated" }>
): string =>
  resolution.status === "whitespace"
    ? `No net is named ${quote(input)} exactly. It matched ${quote(resolution.net)}, which ` +
      `differs from it only by leading or trailing whitespace.`
    : `No net is named ${quote(input)} exactly. It matched ${quote(resolution.net)}: Allegro ` +
      `netlists written by PSTWRITER 16.6 cut net names to ${LEGACY_NETLIST_NAME_LIMIT} ` +
      `characters, and this is that net's cut name. PSTWRITER 17.4 and later write it in full.`;

/** The error a lookup returns when a name could mean more than one net. */
export const describeAmbiguity = (
  input: string,
  resolution: Extract<NetNameResolution, { status: "ambiguous" }>
): string =>
  resolution.reason === "whitespace"
    ? `Net ${quote(input)} is ambiguous: ${resolution.candidates.map(quote).join(", ")} ` +
      `differ only by leading or trailing whitespace and are separate nets. Query one of ` +
      `them by its exact name.`
    : `Net ${quote(input)} is ambiguous: it is the first ${LEGACY_NETLIST_NAME_LIMIT} ` +
      `characters of ${resolution.candidates.map(quote).join(", ")}, which a PSTWRITER ` +
      `16.6 export cannot tell apart. Query one of them by its full name.`;

/** The index for a loaded design. */
export const indexNetNames = (netlist: {
  nets: Record<string, unknown>;
  netLabelSources?: Record<string, NetLabelSource[]>;
}): NetNameIndex => new NetNameIndex(Object.keys(netlist.nets), netlist.netLabelSources);
