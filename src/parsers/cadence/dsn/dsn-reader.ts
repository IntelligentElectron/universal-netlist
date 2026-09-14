import { OleReader } from "../../ole-reader/ole-reader.js";
import { decryptSapphireII } from "./sapphire.js";

const MARKER = Buffer.from("FILE_FMT_SYENCRYPT01", "ascii");
const LIBRARY_HEADER = Buffer.from("OrCAD Windows Design           \0", "ascii");

/** CFBF reader with protected OrCAD streams decoded only in memory. */
export class DsnReader extends OleReader {
  private readonly decrypted = new Map<string, Buffer>();

  constructor(filePath: string, password?: string) {
    super(filePath);
    const protectedStreams = new Map<string, { raw: Buffer; offset: number }>();
    for (const { path, entry } of this.listAllEntries()) {
      if (entry.type !== 2) continue;
      const raw = super.readStreamByPath(path);
      const offset = path === "Library" || path.endsWith("/Library") ? 22 : 0;
      const prefix = raw.subarray(offset, offset + 9).toString("latin1");
      if (prefix !== "FILE_FMT_" && prefix !== "FILE_FMT=") continue;
      if (raw.length < offset + MARKER.length) {
        throw new Error(`Truncated OrCAD encryption marker in stream '${path}'`);
      }
      if (!raw.subarray(offset, offset + MARKER.length).equals(MARKER)) {
        throw new Error(
          `Unsupported OrCAD encryption format in stream '${path}'; only SYENCRYPT01 is supported`
        );
      }
      protectedStreams.set(path, { raw, offset });
    }
    if (protectedStreams.size === 0) return;
    if (password === undefined) {
      throw new Error(
        "Password-protected OrCAD DSN: supply ParseDesignOptions.password or export-json --password-stdin"
      );
    }
    if (!/^[\x20-\x7e]{1,255}$/.test(password)) {
      throw new Error(
        "OrCAD DSN passwords must contain 1..255 printable ASCII characters; other encodings are not supported"
      );
    }
    const libraryPath = protectedStreams.has("Library")
      ? "Library"
      : [...protectedStreams.keys()].find((path) => path.endsWith("/Library"));
    if (!libraryPath) {
      throw new Error("Cannot validate the DSN password: encrypted Library stream is missing");
    }
    const key = Buffer.from(password, "ascii");
    try {
      const decrypt = ({ raw, offset }: { raw: Buffer; offset: number }): Buffer =>
        Buffer.concat([
          raw.subarray(0, offset),
          decryptSapphireII(raw.subarray(offset + MARKER.length), key),
        ]);
      const library = decrypt(protectedStreams.get(libraryPath)!);
      if (!library.subarray(0, LIBRARY_HEADER.length).equals(LIBRARY_HEADER)) {
        throw new Error("Incorrect OrCAD DSN password or damaged encrypted Library stream");
      }
      this.decrypted.set(libraryPath, library);
      // Preflight protection before the record parser's best-effort catches.
      for (const [path, stream] of protectedStreams) {
        if (path !== libraryPath) this.decrypted.set(path, decrypt(stream));
      }
    } finally {
      key.fill(0);
    }
  }

  override readStreamByPath(path: string): Buffer {
    return this.decrypted.get(path) ?? super.readStreamByPath(path);
  }

  override readStream(name: string): Buffer {
    const entry = this.listAllEntries().find(
      (item) => item.entry.type === 2 && item.entry.name === name
    );
    return entry ? this.readStreamByPath(entry.path) : super.readStream(name);
  }
}
