/**
 * An OrCAD design container's streams. A password-protected design stores streams
 * encrypted under `FILE_FMT_SYENCRYPT01`; they read decrypted with a password from the
 * environment.
 */

import { readFileSync } from "fs";
import { OleReader } from "../../ole-reader/ole-reader.js";
import type { OleDirectoryPath } from "../../ole-reader/types.js";
import { decryptSapphireII } from "./sapphire.js";

export const DSN_PASSWORD = "UNIVERSAL_NETLIST_DSN_PASSWORD";
/** A file of passwords, one per line. */
export const DSN_PASSWORD_FILE = "UNIVERSAL_NETLIST_DSN_PASSWORD_FILE";

const MARKER = Buffer.from("FILE_FMT_SYENCRYPT01", "latin1");
/** The root `Library` stream keeps its first bytes in clear, ahead of the marker. */
const LIBRARY_CLEAR_BYTES = 22;
const LIBRARY_HEADER = Buffer.from("OrCAD Windows Design           \0", "latin1");
/** The Library header through its font count: introduction, version, dates, zeros. */
const LIBRARY_HEADER_BYTES = 50;
const PASSWORD_FORM = /^[\x20-\x7e]{1,255}$/;

/** A protected design that no configured password opens. */
export class ProtectedDesignError extends Error {}

/**
 * Whether decrypted bytes open as a design's Library: its exact 32-byte introduction, or,
 * where OrCAD left other bytes after the text, the header's fixed fields: version 1 to 9
 * with minor 0 to 99 at offset 32, four zero bytes at 44 and a font count of 1 to 1024 at 48.
 */
const isLibraryHeader = (library: Buffer): boolean => {
  if (library.length < LIBRARY_HEADER_BYTES) return false;
  if (library.subarray(0, LIBRARY_HEADER.length).equals(LIBRARY_HEADER)) return true;
  const [major, minor, fonts] = [
    library.readUInt16LE(32),
    library.readUInt16LE(34),
    library.readUInt16LE(48),
  ];
  return (
    library.toString("latin1", 0, 20) === "OrCAD Windows Design" &&
    major >= 1 &&
    major <= 9 &&
    minor <= 99 &&
    library.readUInt32LE(44) === 0 &&
    fonts >= 1 &&
    fonts <= 1024
  );
};

interface EncryptedStream {
  path: string;
  data: Buffer;
  /** Where the marker starts. */
  at: number;
}

/** Where a stream's encryption marker starts, if the stream is encrypted. */
const markerAt = (path: string, data: Buffer): number | undefined => {
  const at = path === "Library" ? LIBRARY_CLEAR_BYTES : 0;
  const tag = data.toString("latin1", at, at + 9);
  if (tag !== "FILE_FMT_" && tag !== "FILE_FMT=") return undefined;
  if (!data.subarray(at, at + MARKER.length).equals(MARKER)) {
    throw new ProtectedDesignError(
      `Stream '${path}' is encrypted in a format other than SYENCRYPT01`
    );
  }
  return at;
};

/**
 * The configured passwords: the variable's, then each line of the file's. A password
 * that cannot be a key is set aside with the reason, not tried.
 */
const configuredKeys = (): { keys: Buffer[]; unusable: string[] } => {
  const passwords: Array<{ source: string; password: string }> = [];
  const password = process.env[DSN_PASSWORD];
  if (password) passwords.push({ source: DSN_PASSWORD, password });
  const file = process.env[DSN_PASSWORD_FILE];
  if (file) {
    let text: string;
    try {
      text = readFileSync(file, "utf-8").replace(/^\uFEFF/, "");
    } catch (error) {
      throw new ProtectedDesignError(
        `Cannot read ${DSN_PASSWORD_FILE}: ${(error as Error).message}`
      );
    }
    text.split(/\r?\n/).forEach((line, index) => {
      if (line)
        passwords.push({ source: `${DSN_PASSWORD_FILE} line ${index + 1}`, password: line });
    });
  }
  const keys: Buffer[] = [];
  const unusable: string[] = [];
  for (const { source, password } of passwords) {
    if (PASSWORD_FORM.test(password)) keys.push(Buffer.from(password, "latin1"));
    else unusable.push(source);
  }
  return { keys, unusable };
};

const decrypt = ({ data, at }: EncryptedStream, key: Buffer): Buffer =>
  Buffer.concat([data.subarray(0, at), decryptSapphireII(data.subarray(at + MARKER.length), key)]);

/** A design's streams by path, encrypted streams decrypted. */
export class DsnReader {
  private readonly entries: OleDirectoryPath[];
  private readonly streams = new Map<string, Buffer>();

  constructor(dsnPath: string) {
    const ole = new OleReader(dsnPath);
    this.entries = ole.listAllEntries();
    const encrypted: EncryptedStream[] = [];
    for (const { path, entry } of this.entries) {
      if (entry.type !== 2) continue;
      const data = ole.readStreamByPath(path);
      this.streams.set(path, data);
      const at = markerAt(path, data);
      if (at !== undefined) encrypted.push({ path, data, at });
    }
    if (encrypted.length === 0) return;

    // A key opens the design when the Library header it decrypts reads as one.
    const library = encrypted.find((stream) => stream.path === "Library");
    if (!library)
      throw new ProtectedDesignError("Protected OrCAD design has no encrypted Library stream");
    const { keys, unusable } = configuredKeys();
    if (keys.length === 0 && unusable.length === 0) {
      throw new ProtectedDesignError(
        `Password-protected OrCAD design: set ${DSN_PASSWORD} or ${DSN_PASSWORD_FILE}`
      );
    }
    const header = {
      ...library,
      data: library.data.subarray(0, MARKER.length + LIBRARY_HEADER_BYTES),
    };
    const key = keys.find((candidate) => isLibraryHeader(decrypt(header, candidate)));
    if (!key) {
      const skipped = unusable.length
        ? `; not tried, as an OrCAD password is 1 to 255 printable ASCII characters: ${unusable.join(", ")}`
        : "";
      throw new ProtectedDesignError(
        `No password in ${DSN_PASSWORD} or ${DSN_PASSWORD_FILE} opens this OrCAD design${skipped}`
      );
    }
    for (const stream of encrypted) this.streams.set(stream.path, decrypt(stream, key));
  }

  listAllEntries(): OleDirectoryPath[] {
    return this.entries;
  }

  readStreamByPath(path: string): Buffer {
    const data = this.streams.get(path);
    if (!data) throw new Error(`Stream at path "${path}" not found in OLE file`);
    return data;
  }
}
