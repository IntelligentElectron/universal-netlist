/**
 * Netlists across documents: merging, renaming and settling net names.
 */

import type { NetConnections, ParsedNetlist, PinEntry } from "../../types.js";
import { mergeComponentInto } from "./components.js";

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

/** A name as reported, without its provisional marker. */
const displayName = (name: string): string => name.split(PROVISIONAL, 1)[0];

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
 * pinless nets, which offer their name and nothing else. Returns the renames applied.
 */
export const mergeNetGroups = (
  netlist: ParsedNetlist,
  groups: Iterable<Set<string>>,
  rankOf: (name: string) => number
): Map<string, string> => {
  const renames = new Map<string, string>();
  for (const names of groups) {
    const resolved = new Set([...names].map((name) => renames.get(name) ?? name));
    if (resolved.size < 2 || ![...resolved].some((name) => netlist.nets[name] !== undefined)) {
      continue;
    }
    const canonical = canonicalNetName(resolved, rankOf);
    for (const [from, to] of renames) if (resolved.has(to)) renames.set(from, canonical);
    for (const name of resolved) if (name !== canonical) renames.set(name, canonical);
  }
  applyNetRenames(netlist, renames);
  return renames;
};

/**
 * Give every provisional name its reported form: the plain name, numbered `_2`, `_3` in
 * sort order where another net already has it.
 */
export const settleProvisionalNames = (nets: NetConnections): Map<string, string> => {
  const names = Object.keys(nets);
  const taken = new Set(names.filter((name) => !name.includes(PROVISIONAL)));
  const renames = new Map<string, string>();
  for (const name of names.filter((name) => name.includes(PROVISIONAL)).sort()) {
    const plain = displayName(name);
    let candidate = plain;
    for (let n = 2; taken.has(candidate); n++) candidate = `${plain}_${n}`;
    taken.add(candidate);
    renames.set(name, candidate);
  }
  return renames;
};
