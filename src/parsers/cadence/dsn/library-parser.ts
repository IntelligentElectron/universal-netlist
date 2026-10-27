/**
 * Library Stream Parser - Extracts the strLst string table
 *
 * The Library stream contains fonts, page settings, and the string table
 * that all prefix property pairs index into.
 */

import { BinaryReader, decodeString } from "./binary-reader.js";

const PAGE_SETTINGS_SIZE = 156;

/** The Library stream's format version, read after its 32-byte introduction. */
export interface LibraryVersion {
  major: number;
  minor: number;
}

/**
 * Where a Library version stands with this parser:
 *
 * - `unknown`: the design has no Library stream, or one too short to hold a version.
 * - `older`: major below 3. Capture wrote these pages in an older record encoding,
 *   with no 4-byte prefix lengths and no `Packages` streams, which this parser does
 *   not read. Every 1.1 and 2.0 design in the corpus fails on its first page.
 * - `tested`: 3.2 or 3.3, the versions of every design this parser has read whole.
 * - `untested`: any other version from 3 up, read as the tested ones are.
 */
export type LibraryVersionSupport = "unknown" | "older" | "tested" | "untested";

const TESTED_VERSIONS = ["3.2", "3.3"];

/** A design whose Library version predates the page encoding this parser reads. */
export class UnsupportedDsnVersionError extends Error {}

const formatVersion = ({ major, minor }: LibraryVersion): string => `${major}.${minor}`;

/** Read the Library stream's version, or undefined when the stream is too short to hold one. */
export function readLibraryVersion(buffer: Buffer): LibraryVersion | undefined {
  if (buffer.length < 36) return undefined;
  return { major: buffer.readUInt16LE(32), minor: buffer.readUInt16LE(34) };
}

/** Classify a Library version; see {@link LibraryVersionSupport}. */
export function libraryVersionSupport(version: LibraryVersion | undefined): LibraryVersionSupport {
  if (!version) return "unknown";
  if (version.major < 3) return "older";
  return TESTED_VERSIONS.includes(formatVersion(version)) ? "tested" : "untested";
}

/** Refuse a design saved in an older Capture format, naming its version. */
export function assertReadableLibraryVersion(version: LibraryVersion | undefined): void {
  if (libraryVersionSupport(version) !== "older") return;
  throw new UnsupportedDsnVersionError(
    `OrCAD design saved in an older Capture format (Library stream version ` +
      `${formatVersion(version!)}), which this server cannot read; it reads version 3 and ` +
      `later. Open the design in a newer OrCAD Capture, save it, and query it again.`
  );
}

/**
 * The error to report for a parse that threw: unchanged, or, at a version no design
 * has been read whole at, naming that version, so the report says where to look.
 */
export function describeParseFailure(version: LibraryVersion | undefined, error: unknown): unknown {
  if (libraryVersionSupport(version) !== "untested" || !(error instanceof Error)) return error;
  return new Error(
    `${error.message} (Library stream version ${formatVersion(version!)}; designs read ` +
      `whole so far are at ${TESTED_VERSIONS.join(" and ")})`,
    { cause: error }
  );
}

/** Read a length-prefixed, null-terminated string, without the 400-character cap. */
function readLibraryString(reader: BinaryReader): string {
  const len = reader.readUint16();
  if (len === 0) {
    reader.skip(1); // null terminator
    return "";
  }
  const bytes = reader.readBytes(len);
  reader.skip(1); // null terminator
  return decodeString(bytes);
}

/**
 * Parse the Library stream and extract the strLst string table.
 *
 * Layout:
 *   32 bytes intro, 4 bytes version (uint16 major + uint16 minor),
 *   12 bytes (create_date + modify_date + zeros),
 *   uint16 text_font_len, (text_font_len - 1) * 60 bytes LOGFONTA,
 *   uint16 some_len, some_len * 2 bytes,
 *   8 unknown bytes, 8 strings, 156 bytes PageSettings,
 *   uint32 str_lst_len, str_lst_len strings
 */
export function parseLibraryStrLst(buffer: Buffer): string[] {
  const reader = new BinaryReader(buffer);

  // Header: 32 bytes intro + 4 bytes version + 12 bytes dates/zeros = 48 bytes
  reader.skip(48);

  // Text fonts
  const textFontLen = reader.readUint16();
  if (textFontLen > 0) {
    reader.skip((textFontLen - 1) * 60);
  }

  // some_len array
  const someLen = reader.readUint16();
  reader.skip(someLen * 2);

  // 8 unknown bytes
  reader.skip(8);

  // 8 strings (str_lst_part_field entries)
  for (let i = 0; i < 8; i++) {
    readLibraryString(reader);
  }

  // PageSettings
  reader.skip(PAGE_SETTINGS_SIZE);

  // String table
  const strLstLen = reader.readUint32();
  const strLst: string[] = [];
  for (let i = 0; i < strLstLen; i++) {
    strLst.push(readLibraryString(reader));
  }

  return strLst;
}
