import { beforeEach, describe, expect, it, vi } from "vitest";
import vectors from "./sapphire-vectors.json" with { type: "json" };
const { streams } = vi.hoisted(() => ({ streams: new Map<string, Buffer>() }));
vi.mock("../../ole-reader/ole-reader.js", () => ({
  OleReader: class {
    listAllEntries() {
      return [...streams.keys()].map((path) => ({
        path,
        entry: { type: 2, name: path.split("/").at(-1) },
      }));
    }
    readStreamByPath(path: string) {
      const value = streams.get(path);
      if (!value) throw new Error("Missing stream");
      return value;
    }
    readStream(name: string) {
      return this.readStreamByPath(name);
    }
  },
}));
import { DsnReader } from "./dsn-reader.js";
const marker = Buffer.from("FILE_FMT_SYENCRYPT01");
const header = Buffer.from("OrCAD Windows Design           \0");
function protectedStreams() {
  streams.set(
    "Library",
    Buffer.concat([header.subarray(0, 22), marker, Buffer.from(vectors[0].cipher, "hex")])
  );
  streams.set("Pages/Page1", Buffer.concat([marker, Buffer.from(vectors[1].cipher, "hex")]));
  streams.set("Plain", Buffer.from("plain payload"));
}
beforeEach(() => streams.clear());
describe("protected DSN streams", () => {
  it("preserves unprotected streams without requiring a password", () => {
    streams.set("Library", header);
    expect(new DsnReader("synthetic").readStream("Library")).toEqual(header);
  });
  it("decrypts each stream with fresh state and preserves the Library prefix", () => {
    protectedStreams();
    const original = Buffer.from(streams.get("Library")!);
    const reader = new DsnReader("synthetic", "test-password");
    expect(reader.readStream("Library")).toEqual(header);
    expect(reader.readStreamByPath("Pages/Page1").toString()).toBe("synthetic page payload");
    expect(reader.readStream("Page1").toString()).toBe("synthetic page payload");
    expect(reader.readStream("Plain").toString()).toBe("plain payload");
    expect(streams.get("Library")).toEqual(original);
  });
  it.each([undefined, "incorrect", "", "é", "a".repeat(256)])(
    "rejects missing, incorrect, or unsupported passwords (%s)",
    (password) => {
      protectedStreams();
      expect(() => new DsnReader("synthetic", password)).toThrow(/password/i);
    }
  );
  it("rejects unsupported encryption even in a stream the parser might ignore", () => {
    protectedStreams();
    streams.set("Ignored", Buffer.from("FILE_FMT=SYENCRYPT02payload"));
    expect(() => new DsnReader("synthetic", "test-password")).toThrow("Unsupported");
  });
  it("rejects truncated markers", () => {
    streams.set("Page", Buffer.from("FILE_FMT_SY"));
    expect(() => new DsnReader("synthetic", "test-password")).toThrow("Truncated");
  });
  it("requires an encrypted Library to validate the password", () => {
    protectedStreams();
    streams.delete("Library");
    expect(() => new DsnReader("synthetic", "test-password")).toThrow("Library stream is missing");
  });
  it("rejects a damaged Library before exposing decrypted streams", () => {
    protectedStreams();
    streams.get("Library")![42] ^= 1;
    expect(() => new DsnReader("synthetic", "test-password")).toThrow("damaged");
  });
});
