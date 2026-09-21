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
 * `FF E4 5C 39` followed by its uint32 length of trailing data:
 *
 *   <type> 00 00 FF E4 5C 39 <uint32 extra> <extra bytes>
 *     <uint32 occurrence> <uint32 dbId> <type> <uint32> <7 zero bytes>
 *     <uint16 length> <latin1 reference> 00
 *
 * That `extra` count is the part of the preamble this parser used to read as a
 * zero it could skip. It is zero on most designs, and when it is not, the whole
 * body sits that many bytes further on, so every field after it has to be read
 * relative to it rather than to the magic.
 *
 * Type 66 is `SthInHierarchy1`, which OpenOrCadParser leaves unidentified. It is
 * the part occurrence: on every fixture the count of these records equals the
 * design's placed-instance count, and every dbId they name is one of that
 * design's instances. Type 67 beside it is the reference's `NetDbIdMapping`, and
 * reading it the same way yields that record's documented dbId and net name,
 * which is what says the offsets are read from the right place.
 *
 * The trailing reference is the *occurrence* copy of the part's reference
 * designator. OrCAD keeps a second, *instance* copy inline in the page record,
 * and the two are not interchangeable: annotation writes the occurrence copy,
 * and that is what Capture displays and what the netlist and board flows
 * consume. The instance copy is only written when the design has never been
 * re-annotated, so where the occurrence carries a reference the instance one is
 * routinely stale or a never-annotated `U?`/`C?` placeholder.
 *
 * Whether a design writes the occurrence copy is not something the container
 * announces, so it is not worth predicting: a record either carries a reference
 * or it does not, and that is the test.
 */

import type { OleDirectoryPath } from "../../ole-reader/types.js";
import { OleReader } from "../../ole-reader/ole-reader.js";
import { DsnReader } from "./dsn-reader.js";
import { parsePage } from "./page-parser.js";
import type { DesignVariant } from "../../../types.js";
import { DEFAULT_VARIANT, isDefaultVariant } from "../../variants.js";

/** Separator between occurrence tokens in a group stream. */
const GROUP_SEPARATOR = "\xb0";

/** The structure preamble, which anchors a record in the Hierarchy stream. */
const PREAMBLE_MAGIC = Buffer.from([0xff, 0xe4, 0x5c, 0x39]);

/** `SthInHierarchy1`: the record standing for a placed part. */
const PART_OCCURRENCE_TYPE = 66;

/** Bytes from the preamble to the uint32 counting the body's leading extra. */
const TRAILING_LENGTH_OFFSET = 4;

/** Bytes from the preamble, past the extra, to the occurrence id. */
const OCCURRENCE_ID_OFFSET = 8;

/** Bytes from the preamble, past the extra, to the dbId. */
const DB_ID_OFFSET = 12;

/** Bytes from the preamble, past the extra, to the length-prefixed reference. */
const REFERENCE_OFFSET = 28;

/**
 * Longest reference designator accepted. Real ones are short, and a cap keeps a
 * stray length word from swallowing the bytes that follow it.
 */
const MAX_REFERENCE_LENGTH = 16;

/**
 * An extra longer than this is not a record this parser understands. Real ones
 * are tens of bytes; the guard bounds the read rather than trusting the file.
 */
const MAX_TRAILING_LENGTH = 4096;

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

/** One part occurrence, read off the Hierarchy stream. */
interface PartOccurrence {
  occurrenceId: number;
  dbId: number;
  /** The annotated reference designator, where the record carries one. */
  reference?: string;
}

/**
 * Is `text` shaped like a reference designator — a letter-led alphanumeric tag,
 * optionally carrying OrCAD's `?` placeholder (`U?`, `C?`)?
 *
 * The offset is fixed, so this is the guard that keeps a same-shaped
 * neighbouring field from being read as the reference: anything failing it
 * means the record is not the layout expected and its reference is left unset.
 */
function isReferenceShaped(text: string): boolean {
  return /^[A-Za-z][A-Za-z0-9?_]*$/.test(text);
}

/** Read the length-prefixed, NUL-terminated reference at `at`, if one is there. */
function readReference(hierarchy: Buffer, at: number): string | undefined {
  if (at + 2 > hierarchy.length) return undefined;
  const length = hierarchy.readUInt16LE(at);
  if (length === 0 || length > MAX_REFERENCE_LENGTH) return undefined;
  if (at + 2 + length >= hierarchy.length) return undefined;
  if (hierarchy[at + 2 + length] !== 0x00) return undefined;
  const text = hierarchy.subarray(at + 2, at + 2 + length).toString("latin1");
  return isReferenceShaped(text) ? text : undefined;
}

/**
 * How far past the preamble this record's body starts.
 *
 * Zero for the compact record, which is what most designs write; a record
 * carrying a display-property block for the reference declares its length here
 * and pushes every later field along by it.
 */
function readTrailingLength(hierarchy: Buffer, at: number): number {
  if (at + TRAILING_LENGTH_OFFSET + 4 > hierarchy.length) return 0;
  const extra = hierarchy.readUInt32LE(at + TRAILING_LENGTH_OFFSET);
  return extra > MAX_TRAILING_LENGTH ? 0 : extra;
}

/** Walk the part occurrences a Hierarchy stream records, in stream order. */
function* readPartOccurrences(hierarchy: Buffer): Generator<PartOccurrence> {
  let at = hierarchy.indexOf(PREAMBLE_MAGIC);
  while (at !== -1) {
    const body = at + readTrailingLength(hierarchy, at);
    if (
      at >= 3 &&
      hierarchy[at - 3] === PART_OCCURRENCE_TYPE &&
      body + DB_ID_OFFSET + 4 <= hierarchy.length
    ) {
      yield {
        occurrenceId: hierarchy.readUInt32LE(body + OCCURRENCE_ID_OFFSET),
        dbId: hierarchy.readUInt32LE(body + DB_ID_OFFSET),
        reference: readReference(hierarchy, body + REFERENCE_OFFSET),
      };
    }
    at = hierarchy.indexOf(PREAMBLE_MAGIC, at + 1);
  }
}

/**
 * Map each part occurrence in a Hierarchy stream to the dbId it stands for.
 */
export function buildOccurrenceDbIds(hierarchy: Buffer): Map<number, number> {
  const occurrences = new Map<number, number>();
  for (const { occurrenceId, dbId } of readPartOccurrences(hierarchy)) {
    if (!occurrences.has(occurrenceId)) occurrences.set(occurrenceId, dbId);
  }
  return occurrences;
}

/**
 * Map each placed instance to the reference designator its occurrence carries.
 *
 * Returns an empty map for a design whose occurrences record no reference,
 * which is the common case: there the instance copy in the page record is the
 * annotated one and nothing needs overriding. A multi-section part contributes
 * one record per section, all naming the same reference, and the first record
 * for a dbId wins.
 */
export function buildOccurrenceRefdes(hierarchy: Buffer): Map<number, string> {
  const references = new Map<number, string>();
  for (const { dbId, reference } of readPartOccurrences(hierarchy)) {
    if (reference !== undefined && !references.has(dbId)) references.set(dbId, reference);
  }
  return references;
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

/** The view's Hierarchy stream, which holds the occurrence records. */
function readHierarchy(ole: DsnReader, entries: OleDirectoryPath[]): Buffer {
  const entry = entries.find(
    (e) => /^Views\/.*\/Hierarchy\/Hierarchy$/.test(e.path) && e.entry.type === 2
  );
  if (!entry) throw new Error("No Hierarchy stream");
  return ole.readStreamByPath(entry.path);
}

/**
 * Read the refdes a design's variants leave unstuffed.
 *
 * Returns an empty set for a design that declares no variants, which is the
 * common case and costs only the directory scan the caller has already done.
 *
 * Pass `hierarchy` where the stream has already been read: the .DSN path reads
 * it for the canonical net names and there is no reason to read it twice.
 */
export function readVariantDns(
  ole: DsnReader,
  entries: OleDirectoryPath[],
  refdesByDbId: Map<number, string>,
  hierarchy?: Buffer,
  selectedVariant?: string
): Set<string> {
  if (selectedVariant && isDefaultVariant(selectedVariant)) return new Set();
  if (!hasVariantGroups(entries)) return new Set();

  let occurrenceDbIds: Map<number, number>;
  try {
    occurrenceDbIds = buildOccurrenceDbIds(hierarchy ?? readHierarchy(ole, entries));
  } catch {
    return new Set();
  }

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
export function readVariantDnsFromFile(dsnPath: string, selectedVariant?: string): Set<string> {
  if (!hasVariantGroups(new OleReader(dsnPath).listAllEntries())) return new Set();
  const ole = new DsnReader(dsnPath);
  const entries = ole.listAllEntries();

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

  return readVariantDns(ole, entries, refdesByDbId, undefined, selectedVariant);
}
