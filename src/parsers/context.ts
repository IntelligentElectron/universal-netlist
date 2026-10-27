/**
 * What a parser reads through, and the settings it would otherwise take from
 * the environment.
 *
 * Every parser reads design files through a `FileReader`, so a host can serve
 * them from somewhere other than the local disk (cloud storage, an archive, an
 * in-memory upload). The default reader is Node's `fs`, which keeps the MCP
 * server and the CLI reading the disk as before.
 *
 * `KICAD_CLI_PATH`, `KICAD_CLI_TIMEOUT`, `UNIVERSAL_NETLIST_DSN_PASSWORD` and
 * `UNIVERSAL_NETLIST_DSN_PASSWORD_FILE` are read in one place,
 * `parserContextFromEnvironment`. A library host passes the same settings as
 * options instead.
 */

import { constants, readFileSync } from "node:fs";
import { access, open, readdir, readFile } from "node:fs/promises";

// =============================================================================
// File reader
// =============================================================================

/** One name in a directory listing. */
export interface DirEntry {
  readonly name: string;
  isFile(): boolean;
  isDirectory(): boolean;
}

/**
 * Where a parser reads design files from. Paths are absolute, in the host's
 * own form. A path that does not exist should fail with an error whose `code`
 * is `ENOENT`, and one the reader may not open with `EACCES`, as Node's do.
 */
export interface FileReader {
  /** A file's whole content. */
  readFile(path: string): Promise<Uint8Array>;
  /** Whether a readable file exists at the path. */
  exists(path: string): Promise<boolean>;
  /**
   * A directory's entries, without `.` and `..`. Only `list_designs` walks
   * directories, so a reader without it can answer every other tool.
   */
  listDir?(path: string): Promise<DirEntry[]>;
  /**
   * The first `length` bytes of a file, or fewer when it is shorter. Discovery
   * reads a document's magic number with it; without it the whole file is read.
   */
  readPrefix?(path: string, length: number): Promise<Uint8Array>;
}

/** The local disk, through Node's `fs`. */
export const nodeFileReader: FileReader = Object.freeze({
  readFile: (path: string) => readFile(path),
  exists: async (path: string) => {
    try {
      await access(path, constants.R_OK);
      return true;
    } catch {
      return false;
    }
  },
  listDir: (path: string) => readdir(path, { withFileTypes: true }),
  readPrefix: async (path: string, length: number) => {
    const handle = await open(path, "r");
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  },
});

/** A file's text, decoded as UTF-8 the way `readFile(path, "utf-8")` does. */
export const readText = async (files: FileReader, path: string): Promise<string> => {
  const bytes = await files.readFile(path);
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("utf-8");
};

/** A file's first bytes, through `readPrefix` when the reader has it. */
export const readPrefix = async (
  files: FileReader,
  path: string,
  length: number
): Promise<Uint8Array> =>
  files.readPrefix
    ? files.readPrefix(path, length)
    : (await files.readFile(path)).subarray(0, length);

/**
 * A reader that reads each file once: a repeated `readFile` of the same path
 * shares the first read, and `readPrefix` is answered from a whole read when the
 * reader has no `readPrefix` of its own. One design load reads its main file to
 * list variants and again to parse, and Altium discovery sniffs each `.SchDoc`
 * before the parse reads it, so a load wraps its reader in this.
 */
export const readOnce = (files: FileReader): FileReader => {
  const reads = new Map<string, Promise<Uint8Array>>();
  /** Paths whose read has succeeded. */
  const done = new Set<string>();
  const readFile = (path: string): Promise<Uint8Array> => {
    let read = reads.get(path);
    if (!read) {
      read = files.readFile(path);
      reads.set(path, read);
      // A failed read is not kept, so a retry reads again.
      read.then(
        () => done.add(path),
        () => reads.delete(path)
      );
    }
    return read;
  };
  return {
    readFile,
    exists: (path) => (done.has(path) ? Promise.resolve(true) : files.exists(path)),
    ...(files.listDir ? { listDir: (path: string) => files.listDir!(path) } : {}),
    readPrefix: async (path, length) =>
      files.readPrefix && !reads.has(path)
        ? files.readPrefix(path, length)
        : (await readFile(path)).subarray(0, length),
  };
};

/** A directory's entries, or an error saying this reader cannot list one. */
export const listDir = (files: FileReader, path: string): Promise<DirEntry[]> => {
  if (!files.listDir) {
    return Promise.reject(
      new Error("This file reader cannot list directories, so it cannot search for designs")
    );
  }
  return files.listDir(path);
};

// =============================================================================
// Parser context
// =============================================================================

/** One password to try on a protected OrCAD design, and where it came from. */
export interface DsnPassword {
  /** Where the password came from, named in messages instead of the password. */
  readonly source: string;
  readonly password: string;
}

/** The passwords a protected OrCAD design is opened with. */
export interface DsnPasswords {
  /**
   * The passwords to try, in order. Called only when a design is protected, so
   * a password file that cannot be read fails that design and nothing else.
   */
  list(): readonly DsnPassword[];
  /** Where a user configures them, as messages name it ("set …"). */
  readonly configuredBy: string;
}

/** How to find and run `kicad-cli` for a KiCad design with no saved `.net`. */
export interface KicadCliOptions {
  /** The binary to run. Omitted, the platform's install locations, then PATH. */
  readonly path?: string;
  /** Milliseconds an export may take. Default 120000. */
  readonly timeoutMs?: number;
}

/** Everything a parser reads through or is configured by. */
export interface ParserContext {
  readonly files: FileReader;
  /** `false` when `kicad-cli` must not run, as for files it cannot see. */
  readonly kicadCli: KicadCliOptions | false;
  readonly dsnPasswords: DsnPasswords;
}

export const KICAD_CLI_PATH = "KICAD_CLI_PATH";
export const KICAD_CLI_TIMEOUT = "KICAD_CLI_TIMEOUT";
export const DSN_PASSWORD = "UNIVERSAL_NETLIST_DSN_PASSWORD";
/** A file of passwords, one per line. */
export const DSN_PASSWORD_FILE = "UNIVERSAL_NETLIST_DSN_PASSWORD_FILE";

/** No passwords; a protected design names the option that supplies them. */
export const passwordList = (
  passwords: readonly string[] = [],
  configuredBy = "secrets.dsnPasswords"
): DsnPasswords => ({
  list: () =>
    passwords.map((password, index) => ({ source: `${configuredBy}[${index}]`, password })),
  configuredBy,
});

/**
 * The passwords the environment configures: the variable's, then each line of
 * the file's. Read each time a protected design opens, so a changed file
 * applies without a restart.
 */
export const dsnPasswordsFromEnvironment = (
  env: NodeJS.ProcessEnv = process.env
): DsnPasswords => ({
  list: () => {
    const passwords: DsnPassword[] = [];
    const password = env[DSN_PASSWORD];
    if (password) passwords.push({ source: DSN_PASSWORD, password });
    const file = env[DSN_PASSWORD_FILE];
    if (file) {
      let text: string;
      try {
        text = readFileSync(file, "utf-8").replace(/^\uFEFF/, "");
      } catch (error) {
        throw new Error(`Cannot read ${DSN_PASSWORD_FILE}: ${(error as Error).message}`);
      }
      text.split(/\r?\n/).forEach((line, index) => {
        if (line)
          passwords.push({ source: `${DSN_PASSWORD_FILE} line ${index + 1}`, password: line });
      });
    }
    return passwords;
  },
  configuredBy: `${DSN_PASSWORD} or ${DSN_PASSWORD_FILE}`,
});

/** The `kicad-cli` settings the environment configures. */
export const kicadCliFromEnvironment = (env: NodeJS.ProcessEnv = process.env): KicadCliOptions => {
  const timeout = Number(env[KICAD_CLI_TIMEOUT]);
  return {
    ...(env[KICAD_CLI_PATH] ? { path: env[KICAD_CLI_PATH] } : {}),
    ...(Number.isFinite(timeout) && timeout > 0 ? { timeoutMs: timeout } : {}),
  };
};

/**
 * The local disk and every setting the environment configures: what the MCP
 * server and the CLI run with, and what a parser uses when its caller passes
 * no context.
 */
export const parserContextFromEnvironment = (
  env: NodeJS.ProcessEnv = process.env
): ParserContext => ({
  files: nodeFileReader,
  kicadCli: kicadCliFromEnvironment(env),
  dsnPasswords: dsnPasswordsFromEnvironment(env),
});

/** The context a caller passed, or the environment's. */
export const contextOrDefault = (context?: ParserContext): ParserContext =>
  context ?? parserContextFromEnvironment();
