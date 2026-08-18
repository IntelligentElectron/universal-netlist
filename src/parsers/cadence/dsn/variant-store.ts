/**
 * CIS Variant Store Parser - the Do Not Stuff set a design's variants declare
 *
 * OrCAD Capture CIS records variants in the `CIS/VariantStore` storage of the
 * .DSN compound file. A part that is unstuffed for a variant keeps an ordinary
 * `VALUE` and both of its `NODE_NAME`s in the PST triad, so the DNS markers the
 * .dat parsers read say nothing about it: the flag lives here alone.
 *
 * Layout, read off the fixtures rather than a specification:
 *
 *   CIS/VariantStore/Groups/<group>/<group>
 *     uint32 payload length, then latin1 text split on 0xB0. Every occurrence
 *     is written `<id>~<state>`, state `0` for a part the group leaves off the
 *     board and `1` for one it puts on. The leading token carries no `~` and is
 *     a flag rather than an occurrence, and an empty token separates sections,
 *     so a token without `~` is skipped rather than counted.
 *
 *   CIS/VariantStore/VariantNames
 *     uint32 0x384, uint32 count, then `uint16 length` + latin1 + NUL strings.
 *
 * The ids are occurrence ids, which are their own numbering: they are neither
 * the `dbId` a placed instance carries nor the `INSnnn` of a PST `C_PATH`, and
 * neither of those appears anywhere in the container. They resolve through the
 * view's Hierarchy stream, whose records carry the structure preamble
 * `FF E4 5C 39` followed by its uint32 length of trailing data (zero here):
 *
 *   <type> 00 00 FF E4 5C 39 00 00 00 00 <uint32 occurrence> <uint32 dbId>
 *
 * Type 66 is `SthInHierarchy1`, which OpenOrCadParser leaves unidentified. It is
 * the part occurrence: on every fixture the count of these records equals the
 * design's placed-instance count, and every dbId they name is one of that
 * design's instances, which is where the refdes comes from. Type 67 beside it is
 * the reference's `NetDbIdMapping`, and reading it the same way yields that
 * record's documented dbId and net name, which is what says the offsets are read
 * from the right place.
 */

import type { OleDirectoryPath } from "../../ole-reader/types.js";
import { OleReader } from "../../ole-reader/ole-reader.js";
import { parsePage } from "./page-parser.js";

/** Separator between occurrence tokens in a group stream. */
const GROUP_SEPARATOR = "\xb0";

/** The structure preamble, which anchors a record in the Hierarchy stream. */
const PREAMBLE_MAGIC = Buffer.from([0xff, 0xe4, 0x5c, 0x39]);

/** `SthInHierarchy1`: the record standing for a placed part. */
const PART_OCCURRENCE_TYPE = 66;

/** Bytes from the preamble to the body: the magic plus its uint32 length. */
const OCCURRENCE_ID_OFFSET = 8;

/** Bytes from the preamble to the dbId that follows the occurrence id. */
const DB_ID_OFFSET = 12;

/** A group stream names itself, so `Groups/DNP/DNP` is the members list. */
const GROUP_STREAM_PATH = /^CIS\/VariantStore\/Groups\/([^/]+)\/([^/]+)$/;

/** One occurrence a variant group names, and whether it is stuffed for it. */
export interface VariantGroupEntry {
  occurrenceId: number;
  stuffed: boolean;
}

/**
 * Read the payload of a variant-store stream.
 *
 * The leading uint32 is the payload's own byte length, so a stream truncated
 * in transit is read to its real end rather than past it.
 */
function readPayload(buffer: Buffer): string {
  if (buffer.length < 4) return "";
  const declared = buffer.readUInt32LE(0);
  const available = buffer.length - 4;
  return buffer.subarray(4, 4 + Math.min(declared, available)).toString("latin1");
}

/**
 * Parse a variant group stream into the occurrences it names.
 *
 * Only `<id>~0` and `<id>~1` are read. A token carrying any other state is
 * left out, so a state this corpus has never shown cannot be mistaken for the
 * one that unstuffs a part.
 */
export function parseVariantGroup(buffer: Buffer): VariantGroupEntry[] {
  const entries: VariantGroupEntry[] = [];

  for (const token of readPayload(buffer).split(GROUP_SEPARATOR)) {
    const tilde = token.indexOf("~");
    if (tilde <= 0) continue;

    const occurrenceId = Number(token.slice(0, tilde));
    if (!Number.isInteger(occurrenceId) || occurrenceId <= 0) continue;

    const state = token.slice(tilde + 1);
    if (state !== "0" && state !== "1") continue;

    entries.push({ occurrenceId, stuffed: state === "1" });
  }

  return entries;
}

/**
 * Parse the VariantNames stream into the names it lists.
 *
 * The list repeats itself: it names variants, the groups they draw on, and
 * each `bom-<variant>` the BOM storage holds, so a name can appear more than
 * once and is returned as often as it is written.
 */
export function parseVariantNames(buffer: Buffer): string[] {
  if (buffer.length < 8) return [];

  const names: string[] = [];
  let offset = 8; // uint32 magic, uint32 count

  while (offset + 2 <= buffer.length) {
    const length = buffer.readUInt16LE(offset);
    offset += 2;
    if (length === 0 || offset + length > buffer.length) break;
    names.push(buffer.subarray(offset, offset + length).toString("latin1"));
    offset += length;
    if (buffer[offset] === 0x00) offset += 1; // NUL terminator
  }

  return names;
}

/**
 * Map each part occurrence in a Hierarchy stream to the dbId it stands for.
 */
export function buildOccurrenceDbIds(hierarchy: Buffer): Map<number, number> {
  const occurrences = new Map<number, number>();

  let at = hierarchy.indexOf(PREAMBLE_MAGIC);
  while (at !== -1) {
    if (
      at >= 3 &&
      hierarchy[at - 3] === PART_OCCURRENCE_TYPE &&
      at + DB_ID_OFFSET + 4 <= hierarchy.length
    ) {
      const occurrenceId = hierarchy.readUInt32LE(at + OCCURRENCE_ID_OFFSET);
      const dbId = hierarchy.readUInt32LE(at + DB_ID_OFFSET);
      if (!occurrences.has(occurrenceId)) occurrences.set(occurrenceId, dbId);
    }
    at = hierarchy.indexOf(PREAMBLE_MAGIC, at + 1);
  }

  return occurrences;
}

/**
 * Resolve the variant groups' occurrences to the refdes they leave off the board.
 *
 * A refdes is unstuffed when a group says so and no group says otherwise. Every
 * design read for this keeps the two apart, unstuffing whole groups (`DNP`,
 * `DNM`) and stuffing whole ones (`RF`, `XDS`), with no part named by both; a
 * design that did name one both ways is reported stuffed, which leaves it on
 * the board rather than dropping a part a caller would have to find missing.
 */
export function resolveDnsRefdes(
  entries: VariantGroupEntry[],
  occurrenceDbIds: Map<number, number>,
  refdesByDbId: Map<number, string>
): Set<string> {
  const unstuffed = new Set<string>();
  const stuffed = new Set<string>();

  for (const entry of entries) {
    const dbId = occurrenceDbIds.get(entry.occurrenceId);
    if (dbId === undefined) continue;
    const refdes = refdesByDbId.get(dbId);
    if (!refdes) continue;
    (entry.stuffed ? stuffed : unstuffed).add(refdes);
  }

  for (const refdes of stuffed) unstuffed.delete(refdes);
  return unstuffed;
}

/** Whether a .DSN's entries carry a variant group at all. */
export function hasVariantGroups(entries: OleDirectoryPath[]): boolean {
  return entries.some((e) => {
    const match = GROUP_STREAM_PATH.exec(e.path);
    return match !== null && match[1] === match[2] && e.entry.type === 2;
  });
}

/**
 * Read the refdes a design's variants leave unstuffed.
 *
 * Returns an empty set for a design that declares no variants, which is the
 * common case and costs only the directory scan the caller has already done.
 */
export function readVariantDns(
  ole: OleReader,
  entries: OleDirectoryPath[],
  refdesByDbId: Map<number, string>
): Set<string> {
  if (!hasVariantGroups(entries)) return new Set();

  const hierarchyEntry = entries.find(
    (e) => /^Views\/.*\/Hierarchy\/Hierarchy$/.test(e.path) && e.entry.type === 2
  );
  if (!hierarchyEntry) return new Set();

  let occurrenceDbIds: Map<number, number>;
  try {
    occurrenceDbIds = buildOccurrenceDbIds(ole.readStreamByPath(hierarchyEntry.path));
  } catch {
    return new Set();
  }

  const groupEntries: VariantGroupEntry[] = [];
  for (const entry of entries) {
    const match = GROUP_STREAM_PATH.exec(entry.path);
    if (!match || match[1] !== match[2] || entry.entry.type !== 2) continue;
    try {
      groupEntries.push(...parseVariantGroup(ole.readStreamByPath(entry.path)));
    } catch {
      // A malformed group is skipped; the rest of the store still reads.
    }
  }

  return resolveDnsRefdes(groupEntries, occurrenceDbIds, refdesByDbId);
}

/**
 * Read the unstuffed refdes straight from a .DSN on disk.
 *
 * For the .dat path, which parses none of the schematic itself. The page
 * streams are only parsed once a variant group is known to be there, so a
 * design without variants costs the container's directory scan and nothing
 * more.
 */
export function readVariantDnsFromFile(dsnPath: string): Set<string> {
  const ole = new OleReader(dsnPath);
  const entries = ole.listAllEntries();
  if (!hasVariantGroups(entries)) return new Set();

  const refdesByDbId = new Map<number, string>();
  for (const entry of entries) {
    if (!/^Views\/.*\/Pages\//.test(entry.path) || entry.entry.type !== 2) continue;
    try {
      for (const inst of parsePage(ole.readStreamByPath(entry.path)).placedInstances) {
        if (inst.reference) refdesByDbId.set(inst.dbId, inst.reference);
      }
    } catch {
      // A page that will not parse costs its own instances, not the design.
    }
  }

  return readVariantDns(ole, entries, refdesByDbId);
}
