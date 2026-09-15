/**
 * Netlists across documents: merging, renaming and settling net names.
 */

import type { NetConnections, ParsedNetlist, PinEntry } from "../../types.js";
import { mergeComponentInto } from "./components.js";
import { compareNaturalKeys, firstFreeName, identifierKey, naturalKey } from "./notation.js";

const pinNet = (entry: PinEntry): string => (typeof entry === "string" ? entry : entry.net);

/** Fold `source` into `target`: nets by name, components by designator, first reading first. */
export const mergeNetlistInto = (target: ParsedNetlist, source: ParsedNetlist): void => {
  for (const [netName, connections] of Object.entries(source.nets)) {
    const merged = (target.nets[netName] ??= {});
    for (const [refdes, pins] of Object.entries(connections)) {
      merged[refdes] = merged[refdes] ? [...new Set([...merged[refdes], ...pins])] : pins;
    }
  }
  for (const [refdes, component] of Object.entries(source.components)) {
    const existing = target.components[refdes];
    if (existing) mergeComponentInto(existing, component);
    else target.components[refdes] = component;
  }
};

/**
 * Make nets and components exact inverses, components deciding where a pin is: a net
 * listing a pin its component places elsewhere drops it, a net left empty goes, and a
 * pin placed on a net that does not list it is added.
 */
export const reconcileNetlist = ({ nets, components }: ParsedNetlist): void => {
  for (const [netName, connections] of Object.entries(nets)) {
    for (const [refdes, pins] of Object.entries(connections)) {
      const component = components[refdes];
      const kept = component
        ? pins.filter((pin) => {
            const entry = component.pins[pin];
            if (entry !== undefined) return pinNet(entry) === netName;
            component.pins[pin] = netName;
            return true;
          })
        : [];
      if (kept.length > 0) connections[refdes] = kept;
      else delete connections[refdes];
    }
    if (Object.keys(connections).length === 0) delete nets[netName];
  }
  for (const [refdes, component] of Object.entries(components)) {
    for (const [pin, entry] of Object.entries(component.pins)) {
      const netName = pinNet(entry);
      if (netName === "") continue;
      const listed = ((nets[netName] ??= {})[refdes] ??= []);
      if (!listed.includes(pin)) listed.push(pin);
    }
  }
};

/** Rename nets, merging those renamed alike, and the component pins on them. */
export const applyNetRenames = (
  netlist: ParsedNetlist,
  renames: ReadonlyMap<string, string>
): void => {
  if (renames.size === 0) return;
  for (const [from, to] of renames) {
    const connections = netlist.nets[from];
    if (!connections) continue;
    delete netlist.nets[from];
    const target = (netlist.nets[to] ??= {});
    for (const [refdes, pins] of Object.entries(connections)) {
      target[refdes] = [...new Set([...(target[refdes] ?? []), ...pins])];
    }
  }
  for (const component of Object.values(netlist.components)) {
    for (const [pin, entry] of Object.entries(component.pins)) {
      const renamed = renames.get(pinNet(entry));
      if (!renamed) continue;
      if (typeof entry === "string") component.pins[pin] = renamed;
      else entry.net = renamed;
    }
  }
};

/**
 * Marks a provisional name: one that is its net's own until links are resolved, so that
 * merging by name does not fold two such nets. No name Altium writes contains it.
 */
export const PROVISIONAL = "\u0000";

/**
 * Marks a sheet-local name: its sheet's own until links resolve, then the plain name again,
 * nets that still share it merging. No name Altium writes contains it.
 */
export const LOCAL = "\u0001";

/** Each sheet-local name's plain form, merging nets that share it. */
export const restoreLocalNames = (nets: NetConnections): Map<string, string> =>
  new Map(
    Object.keys(nets)
      .filter((name) => name.includes(LOCAL))
      .map((name) => [name, name.slice(0, name.indexOf(LOCAL))])
  );

/** A name as reported, without its provisional or local marker. */
const displayName = (name: string): string => {
  const [provisional, local] = [name.indexOf(PROVISIONAL), name.indexOf(LOCAL)];
  const end = provisional < 0 ? local : local < 0 ? provisional : Math.min(provisional, local);
  return end < 0 ? name : name.slice(0, end);
};

/** The name a group of merged nets keeps: the strongest claim, then the first in sort order. */
export const canonicalNetName = (
  names: Iterable<string>,
  rankOf: (name: string) => number
): string =>
  [...names].sort((a, b) => {
    const [plainA, plainB] = [displayName(a), displayName(b)];
    return rankOf(a) - rankOf(b) || (plainA < plainB ? -1 : plainA > plainB ? 1 : 0);
  })[0];

/**
 * Fold each group of net names into one net under its canonical name. A group may name
 * pinless nets, which give their name and nothing else.
 */
export const mergeNetGroups = (
  netlist: ParsedNetlist,
  groups: Iterable<Set<string>>,
  rankOf: (name: string) => number
): void => {
  const renames = new Map<string, string>();
  for (const names of groups) {
    if (names.size < 2 || ![...names].some((name) => netlist.nets[name] !== undefined)) continue;
    const canonical = canonicalNetName(names, rankOf);
    for (const name of names) if (name !== canonical) renames.set(name, canonical);
  }
  applyNetRenames(netlist, renames);
};

/**
 * Give every provisional name its reported form: its plain name where no other net has it,
 * else that name numbered `_2`, `_3` past every name given, ignoring case. Plain names go
 * first, by name and then by instance; numbered ones follow in the same order.
 */
export const settleProvisionalNames = (nets: NetConnections): Map<string, string> => {
  const names = Object.keys(nets);
  const taken = new Set(names.filter((name) => !name.includes(PROVISIONAL)).map(identifierKey));
  const provisional = names
    .filter((name) => name.includes(PROVISIONAL))
    .map((name) => ({
      name,
      plain: displayName(name),
      order: naturalKey(displayName(name)),
      instance: naturalKey(name.slice(name.indexOf(PROVISIONAL) + 1)),
    }))
    .sort(
      (a, b) => compareNaturalKeys(a.order, b.order) || compareNaturalKeys(a.instance, b.instance)
    );
  const renames = new Map<string, string>();
  const duplicates: typeof provisional = [];
  for (const entry of provisional) {
    if (taken.has(identifierKey(entry.plain))) duplicates.push(entry);
    else {
      renames.set(entry.name, entry.plain);
      taken.add(identifierKey(entry.plain));
    }
  }
  for (const { name, plain } of duplicates) {
    const numbered = firstFreeName(plain, taken);
    renames.set(name, numbered);
    taken.add(identifierKey(numbered));
  }
  return renames;
};
