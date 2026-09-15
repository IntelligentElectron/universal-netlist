/**
 * The sheet hierarchy: which sheet symbols place which documents, and every instance of
 * every document those placements produce.
 */

import path from "path";
import { RECORD_TYPES, type AltiumRecord } from "./types.js";
import { fieldText, flattenHierarchy } from "./records.js";
import { compareNatural, repeatChannels, repeatSheetName, type RepeatChannel } from "./notation.js";
import type { ReadDocument } from "./document.js";

const childRecord = (symbol: AltiumRecord | undefined, type: string): AltiumRecord | undefined =>
  symbol?.children?.find((child) => child.RECORD === type);

/** The document a sheet symbol places, as its lower-case file name. */
export const sheetSymbolChild = (symbol: AltiumRecord | undefined): string | undefined => {
  const file = childRecord(symbol, RECORD_TYPES.SHEET_FILE_NAME);
  const fileName = file && fieldText(file, "Text", "Name");
  return fileName ? path.basename(fileName.replace(/\\/g, "/")).toLowerCase() : undefined;
};

/** A sheet symbol's designator, `Repeat(NAME,start,end)` for a repeated sheet. */
export const sheetSymbolDesignator = (symbol: AltiumRecord): string => {
  const name = childRecord(symbol, RECORD_TYPES.SHEET_NAME);
  return (name && fieldText(name, "Text", "Name")) ?? "";
};

/** A sheet symbol placing a document. */
export interface SheetPlacement {
  parent: ReadDocument;
  /** The parent's position in the project. */
  parentOrder: number;
  symbol: AltiumRecord;
  /** One channel for a plain designator, one per index for `Repeat(NAME,start,end)`. */
  channels: RepeatChannel[];
  /** `NAME` of a `Repeat(NAME,start,end)` designator. */
  repeatName?: string;
}

/** Every sheet symbol of a project, by the document it places. */
export const findSheetPlacements = (
  documents: readonly ReadDocument[]
): Map<string, SheetPlacement[]> => {
  const placements = new Map<string, SheetPlacement[]>();
  documents.forEach((parent, parentOrder) => {
    for (const symbol of flattenHierarchy(parent.hierarchical)) {
      if (symbol.RECORD !== RECORD_TYPES.SHEET_SYMBOL) continue;
      const child = sheetSymbolChild(symbol);
      if (!child) continue;
      const designator = sheetSymbolDesignator(symbol);
      const repeated = repeatChannels(designator);
      (placements.get(child) ?? placements.set(child, []).get(child)!).push({
        parent,
        parentOrder,
        symbol,
        channels: repeated.length > 0 ? repeated : [{ designator, index: 1 }],
        repeatName: repeated.length > 0 ? repeatSheetName(designator) : undefined,
      });
    }
  });
  return placements;
};

/** One instance of a document: the chain of channels that places it. */
export interface DocumentInstance {
  /**
   * The document no symbol places, then `/<symbol index>@<channel index>` per placement
   * down to this one. The instance's ports meet the entries of the last symbol.
   */
  key: string;
  path: { placement: SheetPlacement; channel: RepeatChannel }[];
  /** The room: `$RoomName`. */
  room: string;
  /** 1-based position among the document's instances: `$ChannelIndex`, `$ChannelAlpha`. */
  ordinal: number;
}

/**
 * Altium's channel letter for a 1-based channel: `A` to `Z`, then the characters after
 * `Z`, channel 27 being `[`.
 */
export const channelAlpha = (channel: number): string =>
  String.fromCharCode(64 + Math.max(1, channel));

/**
 * Every instance of every document, as Altium numbers them.
 *
 * A document has one instance per chain of channels down from a document no symbol
 * places. Instances are ordered by chain, level by level: by channel designator, then,
 * between symbols of one designator, the later in the project first. A room is the last
 * level's channel; rooms that repeat are numbered in instance order, past any room they
 * would spell. Room naming style `1` writes numbers as letters.
 */
export const documentInstances = (
  documents: readonly ReadDocument[],
  placements: ReadonlyMap<string, readonly SheetPlacement[]>,
  roomNamingStyle: string
): Map<string, DocumentInstance[]> => {
  type Chain = Pick<DocumentInstance, "key" | "path">;
  const chainsOf = (name: string, visiting: ReadonlySet<string>): Chain[] => {
    const placed = placements.get(name) ?? [];
    if (placed.length === 0 || visiting.has(name)) return [{ key: name, path: [] }];
    const inside = new Set(visiting).add(name);
    return placed.flatMap((placement) =>
      chainsOf(placement.parent.name, inside).flatMap((parent) =>
        placement.channels.map((channel) => ({
          key: `${parent.key}/${placement.symbol.index}@${channel.index}`,
          path: [...parent.path, { placement, channel }],
        }))
      )
    );
  };

  type Level = Chain["path"][number];
  const compareLevels = (a: Level, b: Level): number =>
    compareNatural(a.channel.designator, b.channel.designator) ||
    (a.placement === b.placement
      ? a.channel.index - b.channel.index
      : b.placement.parentOrder - a.placement.parentOrder ||
        b.placement.symbol.index - a.placement.symbol.index);
  const compareChains = (a: Chain, b: Chain): number => {
    for (let i = 0; i < Math.min(a.path.length, b.path.length); i++) {
      const order = compareLevels(a.path[i], b.path[i]);
      if (order !== 0) return order;
    }
    return a.path.length - b.path.length;
  };
  const number = (n: number): string => (roomNamingStyle === "1" ? channelAlpha(n) : String(n));

  const instances = new Map<string, DocumentInstance[]>();
  for (const document of documents) {
    const chains = chainsOf(document.name, new Set()).sort(compareChains);
    const rooms = chains.map(({ path: levels }) => {
      const leaf = levels[levels.length - 1];
      if (!leaf) return document.name;
      return leaf.placement.repeatName === undefined
        ? leaf.channel.designator
        : `${leaf.placement.repeatName}${number(leaf.channel.index)}`;
    });
    const counts = new Map<string, number>();
    for (const room of rooms) counts.set(room, (counts.get(room) ?? 0) + 1);
    const taken = new Set(rooms.filter((room) => counts.get(room) === 1));
    const numbered = new Map<string, number>();
    instances.set(
      document.name,
      chains.map((chain, i) => {
        let room = rooms[i];
        if (counts.get(room)! > 1) {
          let n = numbered.get(rooms[i]) ?? 0;
          do n++;
          while (taken.has(`${rooms[i]}${number(n)}`));
          numbered.set(rooms[i], n);
          room = `${rooms[i]}${number(n)}`;
        }
        taken.add(room);
        return { ...chain, room, ordinal: i + 1 };
      })
    );
  }
  return instances;
};
