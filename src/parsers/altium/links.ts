/**
 * Cross-sheet links: the identities each net claims, and the nets those claims join.
 */

import type { NetConnections } from "../../types.js";
import { RECORD_TYPES, type AltiumNet, type AltiumRecord, type AltiumSchematic } from "./types.js";
import { field, fieldText, findRecordByIndex, ownerIndex } from "./records.js";
import { identifierKey, repeatBaseName } from "./notation.js";
import { isBusIdentifier } from "./bus.js";
import { isSignalSheetEntry } from "./net-extractor.js";
import { harnessSignalKey, portBundle, splitHarnessSignalKey } from "./harness.js";
import { sheetSymbolChild } from "./sheet-hierarchy.js";
import { powerPortsAreGlobal, type NetIdentifierScope } from "./project-options.js";
import { UnionFind } from "./union-find.js";

/**
 * A net's identity claims, as keys `<kind>|<fields>`:
 * - `hier|<instance>|<name>`: a port on a document instance, meeting the entry of that
 *   name on the channel that placed it.
 * - `entry|<instance>|<document>|<symbol index>|<name>|<channel>`: a sheet entry, reaching
 *   the given channel of its symbol, or every channel when none is given.
 * - `port|<name>`: a port, meeting ports of its name under Flat and Global scope.
 * - `power|<name>`: a power port, global under every scope but Strict Hierarchical.
 * - `harness|<signal key>`: a bus member reaching a harness entry or harness-typed port.
 */
export interface NetLinkGroup {
  /** The net's name, absent for a net without pins. */
  net?: string;
  /** The name a pinless net offers the nets it links. */
  name?: string;
  keys: string[];
}

const hasHarnessType = (record: AltiumRecord): boolean => Boolean(field(record, "HarnessType"));

/** Every net's identity claims, for a document read as the instance `placement`. */
export const collectNetLinks = (
  nets: AltiumNet[],
  schematic: AltiumSchematic,
  connections: NetConnections,
  documentName: string,
  placement: string
): NetLinkGroup[] => {
  const entryKey = (entry: AltiumRecord, name: string, channel = ""): string | undefined => {
    const symbol = ownerIndex(entry);
    if (symbol === undefined || !sheetSymbolChild(findRecordByIndex(schematic, symbol))) {
      return undefined;
    }
    return `entry|${placement}|${documentName}|${symbol}|${name}|${channel}`;
  };

  const groups: NetLinkGroup[] = [];
  for (const net of nets) {
    const keys = new Set<string>();
    const add = (key: string | undefined): void => {
      if (key !== undefined) keys.add(key);
    };
    const port = (name: string): void => {
      add(`port|${name}`);
      add(`hier|${placement}|${name}`);
    };

    for (const device of net.devices) {
      if (device.RECORD === RECORD_TYPES.POWER_PORT) {
        const name = fieldText(device, "Text");
        if (name) add(`power|${name}`);
        continue;
      }
      // A bundle joins through its harness signals; a range through its bus members.
      if (hasHarnessType(device) || isBusIdentifier(device)) continue;
      const name = fieldText(device, "Name");
      if (!name) continue;
      if (device.RECORD === RECORD_TYPES.PORT) port(name);
      else if (device.RECORD === RECORD_TYPES.SHEET_ENTRY && isSignalSheetEntry(device)) {
        add(entryKey(device, name));
      }
    }

    for (const { device, member, channel } of net.busCarriers ?? []) {
      const name = fieldText(device, "Name");
      if (!name) continue;
      if (device.RECORD === RECORD_TYPES.PORT) {
        if (hasHarnessType(device)) add(`harness|${harnessSignalKey(portBundle(name), member)}`);
        else port(member);
      } else if (device.RECORD === RECORD_TYPES.SHEET_ENTRY) {
        if (hasHarnessType(device)) continue;
        const base = repeatBaseName(name);
        add(
          base
            ? entryKey(device, base, String(channel ?? parseInt(member.slice(base.length), 10)))
            : entryKey(device, member)
        );
      } else if (device.RECORD === RECORD_TYPES.HARNESS_ENTRY && device.harnessSignal) {
        const { bundle } = splitHarnessSignalKey(device.harnessSignal);
        add(`harness|${harnessSignalKey(bundle, member)}`);
      }
    }

    if (keys.size === 0) continue;
    const named = net.name && connections[net.name] ? net.name : undefined;
    const offered =
      !named && net.name && net.nameSource && net.nameSource !== "pin" ? net.name : undefined;
    groups.push({ net: named, name: offered, keys: [...keys] });
  }
  return groups;
};

/**
 * The groups of net names that links join, a name of a pinless net among them. Keys match
 * ignoring case; `symbolChannels` lists each `<document>#<symbol index>`'s channels.
 */
export const linkedNetGroups = (
  links: readonly NetLinkGroup[],
  scope: NetIdentifierScope,
  symbolChannels: ReadonlyMap<string, readonly number[]>
): Map<string, Set<string>> => {
  const portsJoinByName = scope === "flat" || scope === "global";
  const resolve = (key: string): string[] => {
    const [kind, ...fields] = key.split("|");
    if (kind === "entry") {
      const [parent, document, symbolIndex, name, channel] = fields;
      const channels = channel
        ? [channel]
        : (symbolChannels.get(`${document}#${symbolIndex}`) ?? []).map(String);
      return channels.map((index) => `hier|${parent}/${symbolIndex}@${index}|${name}`);
    }
    if (kind === "port") return portsJoinByName ? [key] : [];
    if (kind === "power") return powerPortsAreGlobal(scope) ? [key] : [];
    return [key];
  };

  const sets = new UnionFind<string>();
  const netNodes = new Set<string>();
  for (const group of links) {
    const keys = group.keys.flatMap(resolve).map(identifierKey);
    if (keys.length === 0) continue;
    const member = group.net ?? group.name;
    const nodes = member ? [`net:${member}`, ...keys] : keys;
    if (member) netNodes.add(nodes[0]);
    for (const node of nodes) sets.union(nodes[0], node);
  }

  const groups = new Map<string, Set<string>>();
  for (const node of netNodes) {
    const root = sets.find(node);
    (groups.get(root) ?? groups.set(root, new Set()).get(root)!).add(node.slice("net:".length));
  }
  return groups;
};
