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
const LIBRARY_HEADER = Buffer.from("OrCAD Windows Design           \0", "latin1");
/** The Library stream's leading header bytes stay in clear, ahead of the marker. */
const LIBRARY_CLEAR_BYTES = 22;
const PASSWORD_FORM = /^[\x20-\x7e]{1,255}$/;

interface EncryptedStream {
  path: string;
  data: Buffer;
  /** Where the marker starts. */
  at: number;
}

const isLibrary = (path: string): boolean => path.split("/").pop() === "Library";

/** Where a stream's encryption marker starts, if the stream is encrypted. */
const markerAt = (path: string, data: Buffer): number | undefined => {
  const at = isLibrary(path) ? LIBRARY_CLEAR_BYTES : 0;
  const tag = data.toString("latin1", at, at + 9);
  if (tag !== "FILE_FMT_" && tag !== "FILE_FMT=") return undefined;
  if (!data.subarray(at, at + MARKER.length).equals(MARKER)) {
    throw new Error(`Stream '${path}' is encrypted in a format other than SYENCRYPT01`);
  }
  return at;
};

/** The configured passwords as keys: the variable's, then each line of the file's. */
const configuredKeys = (): Buffer[] => {
  const passwords: Array<{ source: string; password: string }> = [];
  const password = process.env[DSN_PASSWORD];
  if (password) passwords.push({ source: DSN_PASSWORD, password });
  const file = process.env[DSN_PASSWORD_FILE];
  if (file) {
    let text: string;
    try {
      text = readFileSync(file, "utf-8");
    } catch (error) {
      throw new Error(`Cannot read ${DSN_PASSWORD_FILE}: ${(error as Error).message}`);
    }
    text.split(/\r?\n/).forEach((line, index) => {
      if (line) passwords.push({ source: `${DSN_PASSWORD_FILE} line ${index + 1}`, password: line });
    });
  }
  return passwords.map(({ source, password }) => {
    if (!PASSWORD_FORM.test(password)) {
      throw new Error(`${source}: an OrCAD password is 1 to 255 printable ASCII characters`);
    }
    return Buffer.from(password, "latin1");
  });
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

    // The Library header is the one plaintext every protected design shares.
    const library = encrypted.find((stream) => isLibrary(stream.path));
    if (!library) throw new Error("Protected OrCAD design has no encrypted Library stream");
    const keys = configuredKeys();
    if (keys.length === 0) {
      throw new Error(`Password-protected OrCAD design: set ${DSN_PASSWORD} or ${DSN_PASSWORD_FILE}`);
    }
    const header = { ...library, data: library.data.subarray(0, MARKER.length + LIBRARY_HEADER.length) };
    const key = keys.find((candidate) =>
      decrypt(header, candidate).subarray(0, LIBRARY_HEADER.length).equals(LIBRARY_HEADER)
    );
    if (!key) {
      throw new Error(`No password in ${DSN_PASSWORD} or ${DSN_PASSWORD_FILE} opens this OrCAD design`);
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
