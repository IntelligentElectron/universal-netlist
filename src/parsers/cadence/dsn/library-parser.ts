/**
 * Library Stream Parser - Extracts the strLst string table and the root schematic
 *
 * The Library stream contains fonts, page settings, the string table that all
 * prefix property pairs index into, and, in a design file, the name of the
 * design's root schematic.
 */

import { BinaryReader, decodeString } from "./binary-reader.js";

const PAGE_SETTINGS_SIZE = 156;

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
 * Read the Library stream from its start through the strLst string table,
 * leaving the reader just past the table.
 *
 * Layout:
 *   32 bytes intro, 4 bytes version (uint16 major + uint16 minor),
 *   12 bytes (create_date + modify_date + zeros),
 *   uint16 text_font_len, (text_font_len - 1) * 60 bytes LOGFONTA,
 *   uint16 some_len, some_len * 2 bytes,
 *   8 unknown bytes, 8 strings, 156 bytes PageSettings,
 *   uint32 str_lst_len, str_lst_len strings
 */
function readThroughStrLst(reader: BinaryReader): string[] {
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

/** Parse the Library stream and extract the strLst string table. */
export function parseLibraryStrLst(buffer: Buffer): string[] {
  return readThroughStrLst(new BinaryReader(buffer));
}

const DESIGN_INTRODUCTION = "OrCAD Windows Design";

/**
 * Parse the Library stream once for its strLst string table and, in a design
 * file, its root schematic: undefined when the stream is a library's or its
 * tail does not read cleanly.
 *
 * A design's stream ends with its alias table and a footer whose last field is
 * the root schematic: the one Capture's Make Root marks, and the one its
 * netlist starts from.
 *
 *   uint16 alias_lst_len, alias_lst_len * (string alias, string package),
 *   4 bytes 0x00000000, 2 unknown, 2 unknown, string schematic_name
 *
 * The name is the stream's last field, so a read that does not end exactly at
 * the end of the stream misread something before it and names nothing.
 */
export function parseLibraryStream(buffer: Buffer): {
  strLst: string[];
  rootSchematic: string | undefined;
} {
  const reader = new BinaryReader(buffer);
  const strLst = readThroughStrLst(reader);
  return { strLst, rootSchematic: readRootSchematic(buffer, reader) };
}

/** The design footer's root schematic, read with `reader` just past the strLst table. */
function readRootSchematic(buffer: Buffer, reader: BinaryReader): string | undefined {
  const introduction = buffer.subarray(0, 32).toString("latin1");
  if (!introduction.startsWith(DESIGN_INTRODUCTION)) return undefined;
  try {
    const aliasLstLen = reader.readUint16();
    for (let i = 0; i < aliasLstLen; i++) {
      readLibraryString(reader); // alias
      readLibraryString(reader); // package
    }
    reader.skip(8);
    const name = readLibraryString(reader);
    return name && reader.isEof() ? name : undefined;
  } catch {
    return undefined;
  }
}
