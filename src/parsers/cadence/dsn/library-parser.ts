/**
 * Library Stream Parser - Extracts the strLst string table
 *
 * The Library stream contains fonts, page settings, and the string table
 * that all prefix property pairs index into.
 */

import { BinaryReader } from "./binary-reader.js";

const PAGE_SETTINGS_SIZE = 156;

/** Read a length-prefixed, null-terminated string using latin1 encoding. */
function readStringLatin1(reader: BinaryReader): string {
  const len = reader.readUint16();
  if (len === 0) {
    reader.skip(1); // null terminator
    return "";
  }
  const bytes = reader.readBytes(len);
  reader.skip(1); // null terminator
  return bytes.toString("latin1");
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
    readStringLatin1(reader);
  }

  // PageSettings
  reader.skip(PAGE_SETTINGS_SIZE);

  // String table
  const strLstLen = reader.readUint32();
  const strLst: string[] = [];
  for (let i = 0; i < strLstLen; i++) {
    strLst.push(readStringLatin1(reader));
  }

  return strLst;
}
