/**
 * Schematic records: decoding a record stream, reading fields, and the owner tree.
 */

import type { AltiumRecord, AltiumSchematic } from "./types.js";

type Fields = Readonly<Record<string, unknown>>;

/**
 * Split a stream into record segments. Each record is a four-byte length and
 * `|KEY=VALUE|...` ending in a NUL; a segment ends where the next record's length
 * shows its two zero high bytes before `|`.
 */
const splitRecords = (buffer: Buffer): Buffer[] => {
  const segments: Buffer[] = [];
  let start = 0;
  for (let i = 0; i < buffer.length - 2; i++) {
    if (buffer[i] !== 0x00 || buffer[i + 1] !== 0x00 || buffer[i + 2] !== 0x7c) continue;
    const end = Math.max(start, i - 3);
    if (end > start) segments.push(buffer.subarray(start, end));
    start = i + 3;
    i = start - 1;
  }
  if (start < buffer.length) segments.push(buffer.subarray(start));
  return segments;
};

/**
 * Parse `KEY=VALUE|KEY=VALUE|...`: UTF-8, or Windows-1252 where UTF-8 does not decode. A
 * value the code page cannot hold is written again under `%UTF8%KEY` in UTF-8, which wins.
 */
const parseSegment = (segment: Buffer, index: number): AltiumRecord => {
  const utf8 = segment.toString("utf-8");
  const decodedAsUtf8 = !utf8.includes("\uFFFD");
  const text = decodedAsUtf8 ? utf8 : segment.toString("latin1");
  const record: AltiumRecord = { index };
  const unicode = new Map<string, string>();
  for (const pair of text.split("|")) {
    const equals = pair.indexOf("=");
    if (equals < 0) continue;
    const key = pair.slice(0, equals).trim();
    const value = pair.slice(equals + 1);
    if (key.startsWith("%UTF8%")) {
      unicode.set(
        key.slice("%UTF8%".length),
        decodedAsUtf8 ? value : Buffer.from(value, "latin1").toString("utf-8")
      );
    } else if (key) {
      record[key] = value;
    }
  }
  for (const [key, value] of unicode) record[key] = value;
  return record;
};

/** Decode a record stream, such as `FileHeader` or `Additional`. */
export const parseRecords = (buffer: Buffer): AltiumSchematic => {
  const parsed = splitRecords(buffer.subarray(5, buffer.length - 1))
    .map((segment, index) => (segment.length === 0 ? undefined : parseSegment(segment, index)))
    .filter(
      (record): record is AltiumRecord => record !== undefined && Object.keys(record).length > 1
    );
  return {
    header: parsed.filter((record) => "HEADER" in record),
    records: parsed.filter((record) => "RECORD" in record),
  };
};

export const toNumber = (value: unknown): number => {
  if (value === undefined || value === null || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** A field under its written key or its upper-case form, which older files use. */
export const field = (record: Fields, key: string): unknown =>
  record[key] ?? record[key.toUpperCase()];

/** The first of `keys` a record writes non-empty, as text. */
export const fieldText = (record: Fields, ...keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = field(record, key);
    if (value !== undefined && value !== null && value !== "") return String(value);
  }
  return undefined;
};

/** The name a port, entry or identifier is written with. */
export const recordName = (record: Fields): string | undefined => fieldText(record, "Name", "Text");

/**
 * Nest each record under the record its `OwnerIndex` names, renumbering records by
 * position so `index` and `OwnerIndex` agree.
 */
export const buildHierarchy = (schematic: AltiumSchematic): AltiumSchematic => {
  const records = schematic.records;
  records.forEach((record, index) => {
    record.index = index;
  });
  const roots: AltiumRecord[] = [];
  for (const record of records) {
    const owner = ownerIndex(record);
    const parent = owner !== undefined && owner >= 0 ? records[owner] : undefined;
    if (parent) (parent.children ??= []).push(record);
    else roots.push(record);
  }
  return { header: schematic.header, records: roots };
};

/** Every record of a tree, owners before the records they own. */
export const flattenHierarchy = (schematic: AltiumSchematic): AltiumRecord[] => {
  const flat: AltiumRecord[] = [];
  const visit = (record: AltiumRecord): void => {
    flat.push(record);
    for (const child of record.children ?? []) visit(child);
  };
  for (const record of schematic.records) visit(record);
  return flat;
};

/** Each tree's records by index, the first of an index kept. */
const recordsByIndex = new WeakMap<AltiumSchematic, AltiumRecord[]>();

export const findRecordByIndex = (
  schematic: AltiumSchematic,
  index: number
): AltiumRecord | undefined => {
  let byIndex = recordsByIndex.get(schematic);
  if (!byIndex) {
    byIndex = [];
    for (const record of flattenHierarchy(schematic)) byIndex[record.index] ??= record;
    recordsByIndex.set(schematic, byIndex);
  }
  return byIndex[index];
};

/** The `OwnerIndex` a record names, if any. */
export const ownerIndex = (record: Fields): number | undefined => {
  const owner = fieldText(record, "OwnerIndex");
  return owner === undefined ? undefined : parseInt(owner, 10);
};

/** The record that owns `record` in a tree. */
export const ownerOf = (record: Fields, schematic: AltiumSchematic): AltiumRecord | undefined => {
  const owner = ownerIndex(record);
  return owner === undefined ? undefined : findRecordByIndex(schematic, owner);
};
