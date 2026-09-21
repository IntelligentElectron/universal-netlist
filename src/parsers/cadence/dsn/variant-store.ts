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
 * view's Hierarchy stream, whose part occurrences pair each id with the
 * instance it stands for and, once annotated, with its reference designator
 * (see hierarchy-parser.ts). A part inside a reused hierarchical block has one
 * occurrence per placement, each with its own id and refdes, so a group can
 * unstuff one placement and leave the others on the board.
 */

import type { OleDirectoryPath } from "../../ole-reader/types.js";
import { OleReader } from "../../ole-reader/ole-reader.js";
import { DsnReader } from "./dsn-reader.js";
import { parsePage } from "./page-parser.js";
import {
  buildOccurrenceRefdes,
  parseHierarchyStream,
  type HierarchyStream,
} from "./hierarchy-parser.js";
import type { DesignVariant } from "../../../types.js";
import { DEFAULT_VARIANT, isDefaultVariant } from "../../variants.js";

/** Separator between occurrence tokens in a group stream. */
const GROUP_SEPARATOR = "\xb0";

/** A group stream names itself, so `Groups/DNP/DNP` is the members list. */
const GROUP_STREAM_PATH = /^CIS\/VariantStore\/Groups\/([^/]+)\/([^/]+)$/;

/** A BOM variant's stream is named after its containing storage. */
const BOM_VARIANT_STREAM_PATH = /^CIS\/VariantStore\/BOM\/([^/]+)\/([^/]+)$/;

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
 * Parse the group names that make up one BOM variant.
 *
 * The payload is latin1 fields separated by 0xF9: a count followed by that
 * many group names. `Common` often appears here without a matching group
 * stream because it contributes no variant-specific stuffing override.
 */
export function parseBomVariantGroups(buffer: Buffer): string[] {
  if (buffer.length < 4) return [];
  const declared = buffer.readUInt32LE(0);
  const payload = buffer
    .subarray(4, 4 + Math.min(declared, buffer.length - 4))
    .toString("latin1")
    .split("\xf9");
  const count = Number(payload.shift());
  if (!Number.isInteger(count) || count < 0) return [];
  return payload.slice(0, count).filter((name) => name.length > 0);
}

/** List the actual BOM variants, excluding group and helper stream names. */
export function listCadenceVariants(entries: OleDirectoryPath[]): DesignVariant[] {
  const variants: DesignVariant[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.entry.type !== 2) continue;
    const match = BOM_VARIANT_STREAM_PATH.exec(entry.path);
    if (!match || match[1] !== match[2]) continue;
    const key = match[1].toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    variants.push({ name: match[1] });
  }
  return variants;
}

/** Read the native BOM variant names straight from a DSN. */
export function listCadenceVariantsFromFile(dsnPath: string): DesignVariant[] {
  return listCadenceVariants(new OleReader(dsnPath).listAllEntries());
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
  occurrenceRefdes: ReadonlyMap<number, string>
): Set<string> {
  const unstuffed = new Set<string>();
  const stuffed = new Set<string>();

  for (const entry of entries) {
    const refdes = occurrenceRefdes.get(entry.occurrenceId);
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
 *
 * `occurrenceRefdes` maps each occurrence id to the refdes the parser reports
 * for it; the .DSN path builds it while expanding the hierarchy
 * (`buildOccurrenceRefdes` in hierarchy-parser.ts).
 */
export function readVariantDns(
  ole: DsnReader,
  entries: OleDirectoryPath[],
  occurrenceRefdes: ReadonlyMap<number, string>,
  selectedVariant?: string
): Set<string> {
  if (selectedVariant && isDefaultVariant(selectedVariant)) return new Set();
  if (!hasVariantGroups(entries)) return new Set();

  let selectedGroups: Set<string> | undefined;
  if (selectedVariant) {
    const variants = listCadenceVariants(entries);
    const canonical = variants.find(
      (variant) => variant.name.toLowerCase() === selectedVariant.trim().toLowerCase()
    );
    if (!canonical) {
      throw new Error(
        `Variant '${selectedVariant}' not found. Available variants: [${variants.map((variant) => variant.name).join(", ")}], ${DEFAULT_VARIANT}`
      );
    }
    const membership = entries.find((entry) => {
      const match = BOM_VARIANT_STREAM_PATH.exec(entry.path);
      return (
        entry.entry.type === 2 &&
        match !== null &&
        match[1].toLowerCase() === canonical.name.toLowerCase() &&
        match[2].toLowerCase() === canonical.name.toLowerCase()
      );
    });
    selectedGroups = new Set(
      membership
        ? parseBomVariantGroups(ole.readStreamByPath(membership.path)).map((name) =>
            name.toLowerCase()
          )
        : []
    );
  }

  const groupEntries: VariantGroupEntry[] = [];
  for (const entry of entries) {
    const match = GROUP_STREAM_PATH.exec(entry.path);
    if (!match || match[1] !== match[2] || entry.entry.type !== 2) continue;
    if (selectedGroups && !selectedGroups.has(match[1].toLowerCase())) continue;
    try {
      groupEntries.push(...parseVariantGroup(ole.readStreamByPath(entry.path)));
    } catch {
      // A malformed group is skipped; the rest of the store still reads.
    }
  }

  return resolveDnsRefdes(groupEntries, occurrenceRefdes);
}

/**
 * Read the unstuffed refdes straight from a .DSN on disk.
 *
 * For the .dat path, which parses none of the schematic itself. The page
 * streams are only parsed once a variant group is known to be there, so a
 * design without variants costs the container's directory scan and nothing
 * more.
 */
export function readVariantDnsFromFile(dsnPath: string, selectedVariant?: string): Set<string> {
  if (!hasVariantGroups(new OleReader(dsnPath).listAllEntries())) return new Set();
  const ole = new DsnReader(dsnPath);
  const entries = ole.listAllEntries();

  const inlineReference = new Map<number, string>();
  for (const entry of entries) {
    if (!/^Views\/.*\/Pages\//.test(entry.path) || entry.entry.type !== 2) continue;
    try {
      for (const inst of parsePage(ole.readStreamByPath(entry.path)).placedInstances) {
        if (inst.reference) inlineReference.set(inst.dbId, inst.reference);
      }
    } catch {
      // A page that will not parse costs its own instances, not the design.
    }
  }

  const streams: HierarchyStream[] = [];
  for (const entry of entries) {
    if (!/^Views\/[^/]+\/Hierarchy\/Hierarchy$/.test(entry.path) || entry.entry.type !== 2)
      continue;
    try {
      streams.push(parseHierarchyStream(ole.readStreamByPath(entry.path)));
    } catch {
      // A view whose stream will not parse resolves no occurrences.
    }
  }

  return readVariantDns(
    ole,
    entries,
    buildOccurrenceRefdes(streams, inlineReference),
    selectedVariant
  );
}
