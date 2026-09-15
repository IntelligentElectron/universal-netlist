/**
 * Multi-channel sheets: each instance of a sheet as a document of its own, its parts and
 * nets named by the project's channel designator format.
 */

import type { ComponentDetails, NetConnections, PinEntry } from "../../types.js";
import {
  RECORD_TYPES,
  type AltiumNet,
  type AltiumRecord,
  type NetNameSource,
  type PinNameSource,
} from "./types.js";
import { fieldText } from "./records.js";
import { expandBusRange, identifierKey, repeatBaseName } from "./notation.js";
import { resolveHarnessMembers, type HarnessDefinitions } from "./harness.js";
import { pinNetName } from "./net-naming.js";
import { channelAlpha, type DocumentInstance } from "./sheet-hierarchy.js";
import { PROVISIONAL } from "./netlist.js";
import type { ParsedDocument } from "./document.js";
import type { NetLinkGroup } from "./links.js";
import type { NetIdentifierKinds } from "./net-scoping.js";

/** `ChannelDesignatorFormatString` tokens, longest first so `$Component` does not match `$ComponentPrefix`. */
const CHANNEL_FORMAT_TOKEN =
  /\$(ComponentPrefix|ComponentIndex|ChannelIndex|ChannelAlpha|Component|RoomName)/g;

/**
 * Apply a channel designator format to a name: `$Component_$RoomName` gives `R5_AY1`,
 * `$Component$ChannelAlpha` gives `R5B` in channel 2. An unknown token is left as written.
 */
export const applyChannelFormat = (
  format: string,
  component: string,
  roomName: string,
  channelIndex: number
): string => {
  const [, prefix = component, index = ""] = component.match(/^([^0-9]*)([0-9].*)?$/) ?? [];
  const tokens: Record<string, string> = {
    Component: component,
    ComponentPrefix: prefix,
    ComponentIndex: index,
    RoomName: roomName,
    ChannelIndex: String(channelIndex),
    ChannelAlpha: channelAlpha(channelIndex),
  };
  return format.replace(CHANNEL_FORMAT_TOKEN, (token, name: string) => tokens[name] ?? token);
};

/** What a repeated sheet's nets are, as channel naming needs to see them. */
export interface ChannelNetScope {
  /** Nets a power port names that stay one supply across every channel. */
  powerNetNames: ReadonlySet<string>;
  /** Signals the parent's plain entries carry to every channel. */
  sharedNames: ReadonlySet<string>;
  /** The pin each pin-named net was named after. */
  pinNamed: ReadonlyMap<string, PinNameSource>;
}

/**
 * What a channel calls each of its sheet's nets. A supply and a shared signal keep their
 * names; a pin-named net is rebuilt around the channel's designator (`NetDD12_AY1_5`);
 * any other net is named by the channel designator format.
 */
export const planChannelNetNames = (
  netNames: Iterable<string>,
  scope: ChannelNetScope,
  roomName: string,
  channelIndex: number,
  channelFormat: string
): Map<string, string> => {
  const shared = new Set([...scope.sharedNames].map(identifierKey));
  const names = new Map<string, string>();
  for (const name of netNames) {
    const pin = scope.pinNamed.get(name);
    if (scope.powerNetNames.has(name) || shared.has(identifierKey(name))) {
      names.set(name, name);
    } else if (pin) {
      const refdes = applyChannelFormat(channelFormat, pin.refdes, roomName, channelIndex);
      names.set(name, pinNetName({ refdes, pin: pin.pin }));
    } else {
      names.set(name, applyChannelFormat(channelFormat, name, roomName, channelIndex));
    }
  }
  return names;
};

/**
 * The signals a sheet symbol's plain entries share with every channel: each entry's name,
 * a range's members, and a harness-typed entry's harness members, qualified and leaf.
 */
export const sharedEntryNames = (
  symbol: AltiumRecord,
  definitions: HarnessDefinitions,
  nestedTypes: ReadonlyMap<string, string>
): Set<string> => {
  const shared = new Set<string>();
  for (const entry of symbol.children ?? []) {
    if (entry.RECORD !== RECORD_TYPES.SHEET_ENTRY) continue;
    const name = fieldText(entry, "Name") ?? "";
    if (repeatBaseName(name) !== undefined) continue;
    const members = expandBusRange(name);
    for (const signal of members.length > 0 ? members : [name]) shared.add(signal);
    const harnessType = fieldText(entry, "HarnessType");
    if (!harnessType) continue;
    for (const member of resolveHarnessMembers(harnessType, definitions, nestedTypes)) {
      shared.add(member);
      const leaf = member.slice(member.lastIndexOf(".") + 1);
      if (leaf) shared.add(leaf);
    }
  }
  return shared;
};

/**
 * The scope channel naming reads from a sheet's nets: its supplies, where power ports are
 * global, and the nets carrying a signal its parent shares through a port or harness.
 */
export const channelNetScope = (
  nets: AltiumNet[],
  sharedNames: ReadonlySet<string>,
  suppliesAreGlobal: boolean
): ChannelNetScope => {
  const sharedKeys = new Set([...sharedNames].map(identifierKey));
  /** A port, or a harness entry of a harness port's bundle, directly or through a bus. */
  const toParent = (device: AltiumRecord): boolean =>
    device.RECORD === RECORD_TYPES.PORT ||
    (device.RECORD === RECORD_TYPES.HARNESS_ENTRY &&
      Boolean(device.harnessSignal?.startsWith("port|")));
  const reachesParent = (net: AltiumNet): boolean =>
    net.devices.some(toParent) || (net.busCarriers ?? []).some(({ device }) => toParent(device));
  return {
    powerNetNames: new Set(
      nets
        .filter(
          (net) =>
            suppliesAreGlobal &&
            net.name &&
            net.devices.some((device) => device.RECORD === RECORD_TYPES.POWER_PORT)
        )
        .map((net) => net.name!)
    ),
    sharedNames: new Set(
      nets
        .filter((net) => net.name && sharedKeys.has(identifierKey(net.name)) && reachesParent(net))
        .map((net) => net.name!)
    ),
    pinNamed: new Map(
      nets
        .filter((net) => net.name && net.nameSource === "pin" && net.pinNameSource)
        .map((net) => [net.name!, net.pinNameSource!])
    ),
  };
};

/**
 * One instance of a sheet as its own document: parts named by the channel designator
 * format and nets as planChannelNetNames names them. A net the channel names itself is
 * provisional, so a name it shares with another net does not merge the two.
 */
export const channelDocument = (
  base: ParsedDocument,
  instance: DocumentInstance,
  channelFormat: string,
  scope: ChannelNetScope
): ParsedDocument => {
  const names = new Set([
    ...Object.keys(base.netlist.nets),
    ...base.nameSources.keys(),
    ...base.netIdentifiers.keys(),
    ...base.links.flatMap((group) => [group.net, group.name].filter((name) => name !== undefined)),
  ]);
  const planned = planChannelNetNames(names, scope, instance.room, instance.ordinal, channelFormat);
  // A pin name is unique already, unless the sheet had to number it.
  for (const [from, to] of planned) {
    const pin = scope.pinNamed.get(from);
    if (to !== from && (!pin || from !== pinNetName(pin)))
      planned.set(from, `${to}${PROVISIONAL}${instance.key}`);
  }
  const rename = (name: string): string => planned.get(name) ?? name;
  const refdes = (name: string): string =>
    applyChannelFormat(channelFormat, name, instance.room, instance.ordinal);

  const nets: NetConnections = {};
  for (const [netName, connections] of Object.entries(base.netlist.nets)) {
    const target = (nets[rename(netName)] ??= {});
    for (const [designator, pins] of Object.entries(connections)) {
      const expanded = refdes(designator);
      target[expanded] = [...new Set([...(target[expanded] ?? []), ...pins])];
    }
  }
  const components: ComponentDetails = {};
  for (const [designator, component] of Object.entries(base.netlist.components)) {
    const pins: Record<string, PinEntry> = {};
    for (const [pin, entry] of Object.entries(component.pins)) {
      pins[pin] = typeof entry === "string" ? rename(entry) : { ...entry, net: rename(entry.net) };
    }
    components[refdes(designator)] = { ...component, pins };
  }

  // A channel keeps its net labels to itself, as its label names show.
  const links: NetLinkGroup[] = base.links.map((group) => ({
    keys: group.keys.filter((key) => !key.startsWith("label|")),
    net: group.net === undefined ? undefined : rename(group.net),
    name: group.name === undefined ? undefined : rename(group.name),
  }));
  const renameKeys = <T>(map: ReadonlyMap<string, T>): Map<string, T> =>
    new Map([...map].map(([name, value]) => [rename(name), value]));

  return {
    ...base,
    placement: instance.key,
    netlist: { nets, components },
    links,
    nameSources: renameKeys<NetNameSource>(base.nameSources),
    netIdentifiers: renameKeys<NetIdentifierKinds>(base.netIdentifiers),
    // Channel net names already tell instances apart.
    sheetNumber: undefined,
  };
};
