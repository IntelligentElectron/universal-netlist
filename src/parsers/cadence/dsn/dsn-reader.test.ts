/**
 * Password-protected OrCAD designs, built by encrypting a real design's streams the way
 * OrCAD stores them and checking every read against the unprotected design.
 */
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { fixturePath, hasFixtures } from "../../../../test/utils.js";
import { protectStream } from "../../../../test/helpers/orcad-protect.js";

const { protection } = vi.hoisted(() => ({
  protection: {} as { transform?: (path: string, data: Buffer) => Buffer },
}));

vi.mock("../../ole-reader/ole-reader.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../ole-reader/ole-reader.js")>();
  class OleReader extends actual.OleReader {
    override readStreamByPath(path: string): Buffer {
      const data = super.readStreamByPath(path);
      return protection.transform ? protection.transform(path, data) : data;
    }
  }
  return { ...actual, OleReader };
});

import { DSN_PASSWORD, DSN_PASSWORD_FILE } from "./dsn-reader.js";
import { parseDsnFile } from "./dsn-parser.js";
import { readVariantDnsFromFile } from "./variant-store.js";

const DSN = fixturePath(
  "cadence",
  "LAUNCHXL-CC1310",
  "doc",
  "hardware",
  "cc1310",
  "launchpad",
  "design_files",
  "Cadence",
  "LAUNCHXL-CC1310.DSN"
);
const PASSWORD = "synthetic password";

const protect = (password = PASSWORD, only?: (path: string) => boolean): void => {
  protection.transform = (path, data) =>
    only && !only(path) ? data : protectStream(path, data, password);
};

describe.skipIf(!hasFixtures)("password-protected OrCAD designs", () => {
  let directory: string;
  let plain: ReturnType<typeof parseDsnFile>;
  let plainVariant: ReturnType<typeof parseDsnFile>;
  let plainDns: Set<string>;

  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), "dsn-passwords-"));
    plain = parseDsnFile(DSN);
    plainVariant = parseDsnFile(DSN, { variant: "Standard" });
    plainDns = readVariantDnsFromFile(DSN);
  });
  afterEach(() => {
    protection.transform = undefined;
    vi.unstubAllEnvs();
  });
  afterAll(() => rmSync(directory, { recursive: true, force: true }));

  const passwordFile = (...lines: string[]): string => {
    const file = join(directory, `passwords-${lines.length}.txt`);
    writeFileSync(file, lines.join("\n"));
    return file;
  };

  it("reads an unprotected design with no password configured", () => {
    vi.stubEnv(DSN_PASSWORD, "");
    vi.stubEnv(DSN_PASSWORD_FILE, "");
    expect(parseDsnFile(DSN)).toEqual(plain);
  });

  it("reads a protected design, its variants and Do Not Stuff set as the unprotected one", () => {
    expect(plainDns.size).toBeGreaterThan(0);
    protect();
    vi.stubEnv(DSN_PASSWORD, PASSWORD);
    expect(parseDsnFile(DSN)).toEqual(plain);
    expect(parseDsnFile(DSN, { variant: "Standard" })).toEqual(plainVariant);
    expect(readVariantDnsFromFile(DSN)).toEqual(plainDns);
  });

  it("tries each password in the password file", () => {
    protect();
    vi.stubEnv(DSN_PASSWORD_FILE, passwordFile("wrong one", "", PASSWORD));
    expect(parseDsnFile(DSN)).toEqual(plain);
  });

  it("asks for a password a protected design needs", () => {
    protect();
    vi.stubEnv(DSN_PASSWORD, "");
    vi.stubEnv(DSN_PASSWORD_FILE, "");
    expect(() => parseDsnFile(DSN)).toThrow(`set ${DSN_PASSWORD} or ${DSN_PASSWORD_FILE}`);
  });

  it("reports that no configured password opens the design, without echoing one", () => {
    protect();
    vi.stubEnv(DSN_PASSWORD, "not the password");
    expect(() => parseDsnFile(DSN)).toThrow(/No password/);
    expect(() => parseDsnFile(DSN)).not.toThrow(/not the password/);
  });

  it("names the line of a password OrCAD cannot hold", () => {
    protect();
    vi.stubEnv(DSN_PASSWORD_FILE, passwordFile(PASSWORD, "pässword"));
    expect(() => parseDsnFile(DSN)).toThrow(`${DSN_PASSWORD_FILE} line 2`);
  });

  it("names the variable of a password file it cannot read", () => {
    protect();
    vi.stubEnv(DSN_PASSWORD_FILE, join(directory, "missing.txt"));
    expect(() => parseDsnFile(DSN)).toThrow(`Cannot read ${DSN_PASSWORD_FILE}`);
  });

  it("refuses a stream encrypted in another format", () => {
    protection.transform = (path, data) =>
      path.endsWith("/Hierarchy")
        ? Buffer.concat([Buffer.from("FILE_FMT=SYENCRYPT02"), data])
        : data;
    expect(() => parseDsnFile(DSN)).toThrow("other than SYENCRYPT01");
  });

  it("needs the Library encrypted to check a password against", () => {
    protect(PASSWORD, (path) => path.split("/").pop() !== "Library");
    vi.stubEnv(DSN_PASSWORD, PASSWORD);
    expect(() => parseDsnFile(DSN)).toThrow("no encrypted Library stream");
  });
});
