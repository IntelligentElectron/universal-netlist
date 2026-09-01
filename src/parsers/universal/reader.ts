/**
 * Universal Netlist reader.
 *
 * Reads a file that is already in the Universal Netlist shape
 * (docs/schemas/universal-netlist.md) and validates it before any tool sees it.
 * The EDA parsers build a consistent netlist by construction. This reader is
 * handed a file that anyone may have written or edited, so it checks that
 * `nets` and `components` are exact inverses of each other and that every
 * reference resolves, and it refuses the file on the first mismatch, naming it.
 */

import { createHash } from "node:crypto";
import type { ComponentDetails, NetConnections, ParsedNetlist, PinEntry } from "../../types.js";
import { UNIVERSAL_NETLIST_SCHEMA_VERSION } from "../../universal-format.js";

export { UNIVERSAL_NETLIST_SCHEMA_VERSION } from "../../universal-format.js";

/** The metadata and netlist payload written to every `.netlist.json` file. */
export interface UniversalNetlistDocument extends ParsedNetlist {
  universalNetlistSchemaVersion: number;
  universalNetlistHash: string;
  universalNetlistExportedAt: string;
}

/** Options for producing a deterministic document when a caller needs one. */
export interface UniversalNetlistSerializationOptions {
  exportedAt?: Date | string;
}

/** A file that is not a valid Universal Netlist. The message names the defect. */
export class UniversalNetlistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UniversalNetlistError";
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const VERSION_1_TOP_LEVEL_KEYS = new Set([
  "universalNetlistSchemaVersion",
  "universalNetlistHash",
  "universalNetlistExportedAt",
  "nets",
  "components",
]);
const COMPONENT_TEXT_FIELDS = ["mpn", "description", "comment", "value"] as const;
type Fail = (message: string) => never;

/**
 * One version's complete compatibility boundary.
 *
 * Readers normalize historical documents into the current internal
 * `ParsedNetlist`; writers serialize that internal model into one on-disk
 * version. Adding a schema means adding a codec, while older codecs stay
 * registered so their files remain readable.
 */
interface UniversalNetlistSchemaCodec {
  read(raw: Record<string, unknown>, fail: Fail): ParsedNetlist;
  write(netlist: ParsedNetlist, exportedAt: string): UniversalNetlistDocument;
}

/** Recursively order object keys for a reproducible JSON representation. */
const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isObject(value)) return value;

  const ordered: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] !== undefined) ordered[key] = canonicalize(value[key]);
  }
  return ordered;
};

/**
 * Hash the stable content of a Universal Netlist.
 *
 * The schema version and complete payload are covered. The hash itself and
 * export timestamp are metadata and intentionally excluded, so re-exporting
 * unchanged content at a different time produces the same digest.
 */
export const calculateUniversalNetlistHash = (
  netlist: ParsedNetlist,
  schemaVersion: number = UNIVERSAL_NETLIST_SCHEMA_VERSION
): string => {
  const canonical = JSON.stringify(
    canonicalize({
      universalNetlistSchemaVersion: schemaVersion,
      nets: netlist.nets,
      components: netlist.components,
    })
  );
  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
};

const isCanonicalExportedAt = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
};

const normalizeExportedAt = (value: Date | string = new Date()): string => {
  const exportedAt =
    value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : value;
  if (!isCanonicalExportedAt(exportedAt)) {
    throw new Error(
      "Universal Netlist export time must be a canonical ISO 8601 UTC timestamp, for example 2026-09-01T12:34:56.789Z"
    );
  }
  return exportedAt;
};

/**
 * Read a pin entry's net name. `""` is how the EDA parsers write a pin that is
 * connected to nothing; `loadNetlist` normalizes it to `NC` after parsing.
 */
const netOf = (entry: PinEntry): string => (typeof entry === "string" ? entry : entry.net);

/**
 * Validate a version 1 document and normalize it into the internal netlist.
 *
 * `source` names the file in error messages. Fields the schema does not define
 * on a component are dropped; the schema marker and payload keys are the only
 * top-level keys allowed.
 * A net member written as one pin number string is read as a one-element array,
 * which is the form every tool works on.
 */
const readVersion1 = (raw: Record<string, unknown>, fail: Fail): ParsedNetlist => {
  if (!isCanonicalExportedAt(raw.universalNetlistExportedAt)) {
    fail(
      "`universalNetlistExportedAt` must be a canonical ISO 8601 UTC timestamp, for example 2026-09-01T12:34:56.789Z"
    );
  }
  if (
    typeof raw.universalNetlistHash !== "string" ||
    !/^sha256:[0-9a-f]{64}$/.test(raw.universalNetlistHash)
  ) {
    fail("`universalNetlistHash` must be `sha256:` followed by 64 lowercase hexadecimal digits");
  }
  if (!isObject(raw.nets) || !isObject(raw.components)) {
    fail("`nets` and `components` must be objects");
  }
  for (const key of Object.keys(raw)) {
    if (!VERSION_1_TOP_LEVEL_KEYS.has(key)) {
      fail(
        `unexpected top-level key '${key}'; a Universal Netlist has only ` +
          "`universalNetlistSchemaVersion`, `universalNetlistHash`, " +
          "`universalNetlistExportedAt`, `nets`, and `components`"
      );
    }
  }

  // Components: shape of every entry, and the pin map each one declares.
  const components: ComponentDetails = {};
  for (const [refdes, body] of Object.entries(raw.components)) {
    if (!refdes) fail("a component has an empty reference designator");
    if (!isObject(body)) fail(`component '${refdes}' must be an object`);
    if (!isObject(body.pins)) fail(`component '${refdes}' has no \`pins\` object`);
    for (const field of COMPONENT_TEXT_FIELDS) {
      if (body[field] !== undefined && typeof body[field] !== "string") {
        fail(`component '${refdes}' field '${field}' must be a string`);
      }
    }
    if (body.dns !== undefined && typeof body.dns !== "boolean") {
      fail(`component '${refdes}' field 'dns' must be a boolean`);
    }

    const pins: Record<string, PinEntry> = {};
    for (const [pin, entry] of Object.entries(body.pins)) {
      if (!pin) fail(`component '${refdes}' has a pin with an empty number`);
      if (typeof entry === "string") {
        pins[pin] = entry;
      } else if (
        isObject(entry) &&
        typeof entry.name === "string" &&
        typeof entry.net === "string" &&
        Object.keys(entry).length === 2
      ) {
        pins[pin] = { name: entry.name, net: entry.net };
      } else {
        fail(
          `pin ${refdes}.${pin} must be a net name or an object with exactly \`name\` and \`net\``
        );
      }
    }

    const component: ComponentDetails[string] = { pins };
    for (const field of COMPONENT_TEXT_FIELDS) {
      if (typeof body[field] === "string") component[field] = body[field];
    }
    if (body.dns === true) component.dns = true;
    components[refdes] = component;
  }

  // Nets: shape of every member list.
  const nets: NetConnections = {};
  for (const [net, members] of Object.entries(raw.nets)) {
    if (!net) fail("a net has an empty name");
    if (!isObject(members)) fail(`net '${net}' must be an object mapping refdes to pin number(s)`);
    const out: Record<string, string[]> = {};
    for (const [refdes, value] of Object.entries(members)) {
      if (!refdes) fail(`net '${net}' lists a member with an empty reference designator`);
      const list =
        typeof value === "string"
          ? [value]
          : Array.isArray(value) && value.every((p) => typeof p === "string")
            ? (value as string[])
            : fail(
                `net '${net}' member '${refdes}' must be a pin number or an array of pin numbers`
              );
      if (list.length === 0) fail(`net '${net}' lists ${refdes} with no pins`);
      if (list.some((p) => !p)) fail(`net '${net}' lists ${refdes} with an empty pin number`);
      const seen = new Set<string>();
      for (const pin of list) {
        if (seen.has(pin)) fail(`net '${net}' lists ${refdes}.${pin} twice`);
        seen.add(pin);
      }
      out[refdes] = [...list];
    }
    nets[net] = out;
  }

  // nets -> components: every listed pin exists and points back at this net.
  for (const [net, members] of Object.entries(nets)) {
    for (const [refdes, value] of Object.entries(members)) {
      const component = components[refdes];
      if (!component)
        fail(`net '${net}' lists ${refdes}, but no component '${refdes}' is declared`);
      for (const pin of value) {
        const entry = component.pins[pin];
        if (entry === undefined) {
          fail(`net '${net}' lists ${refdes}.${pin}, but ${refdes} declares no pin '${pin}'`);
        }
        const actual = netOf(entry);
        if (actual !== net) {
          const where = actual === "" ? "is unconnected" : `is on '${actual}'`;
          fail(`net '${net}' lists ${refdes}.${pin}, but ${refdes}.${pin} ${where}`);
        }
      }
    }
  }

  // components -> nets: every connected pin is listed under its net.
  for (const [refdes, component] of Object.entries(components)) {
    for (const [pin, entry] of Object.entries(component.pins)) {
      const net = netOf(entry);
      if (net === "") continue; // an unconnected pin belongs to no net
      const members = nets[net];
      if (!members) fail(`${refdes}.${pin} is on '${net}', but no net '${net}' is declared`);
      if (!(members[refdes] ?? []).includes(pin)) {
        fail(`${refdes}.${pin} is on '${net}', but net '${net}' does not list it`);
      }
    }
  }

  const netlist = { nets, components };
  const expectedHash = calculateUniversalNetlistHash(netlist, 1);
  if (raw.universalNetlistHash !== expectedHash) {
    fail("`universalNetlistHash` does not match the schema version, nets, and components");
  }

  return netlist;
};

const VERSION_1_CODEC: UniversalNetlistSchemaCodec = {
  read: readVersion1,
  write: (netlist, exportedAt) => ({
    universalNetlistSchemaVersion: 1,
    universalNetlistHash: calculateUniversalNetlistHash(netlist, 1),
    universalNetlistExportedAt: exportedAt,
    nets: netlist.nets,
    components: netlist.components,
  }),
};

/**
 * Every on-disk schema version this build can read and write.
 *
 * Never replace an older entry when introducing a newer schema. Add its codec
 * here, then advance `UNIVERSAL_NETLIST_SCHEMA_VERSION` so new exports use it.
 */
const SCHEMA_CODECS: ReadonlyMap<number, UniversalNetlistSchemaCodec> = new Map([
  [1, VERSION_1_CODEC],
]);

/** Versions accepted by this build, in ascending order. */
export const SUPPORTED_UNIVERSAL_NETLIST_SCHEMA_VERSIONS: readonly number[] = Object.freeze(
  [...SCHEMA_CODECS.keys()].sort((a, b) => a - b)
);

const currentCodec = (): UniversalNetlistSchemaCodec => {
  const codec = SCHEMA_CODECS.get(UNIVERSAL_NETLIST_SCHEMA_VERSION);
  if (!codec) {
    throw new Error(
      `No Universal Netlist codec is registered for current schema version ${UNIVERSAL_NETLIST_SCHEMA_VERSION}`
    );
  }
  return codec;
};

/** Add the current on-disk schema envelope to an internal parsed netlist. */
export const toUniversalNetlistDocument = (
  netlist: ParsedNetlist,
  options: UniversalNetlistSerializationOptions = {}
): UniversalNetlistDocument =>
  currentCodec().write(netlist, normalizeExportedAt(options.exportedAt));

/** Serialize an internal netlist using the current on-disk schema version. */
export const serializeUniversalNetlist = (
  netlist: ParsedNetlist,
  options: UniversalNetlistSerializationOptions = {}
): string => JSON.stringify(toUniversalNetlistDocument(netlist, options), null, 2) + "\n";

/**
 * Dispatch a parsed document to its version-specific reader.
 *
 * A future build can make a newer schema current without dropping old files:
 * registered historical readers continue normalizing them to `ParsedNetlist`.
 */
export const validateUniversalNetlist = (raw: unknown, source = "netlist"): ParsedNetlist => {
  const fail: Fail = (message) => {
    throw new UniversalNetlistError(`${source}: ${message}`);
  };

  if (!isObject(raw) || !("universalNetlistSchemaVersion" in raw)) {
    fail("not a Universal Netlist: missing `universalNetlistSchemaVersion`");
  }
  if (!Number.isInteger(raw.universalNetlistSchemaVersion)) {
    fail("`universalNetlistSchemaVersion` must be an integer");
  }

  const version = raw.universalNetlistSchemaVersion as number;
  const codec = SCHEMA_CODECS.get(version);
  if (!codec) {
    fail(
      `unsupported Universal Netlist schema version ${version}; supported: ` +
        SUPPORTED_UNIVERSAL_NETLIST_SCHEMA_VERSIONS.join(", ")
    );
  }
  return codec.read(raw, fail);
};

/** Parse JSON text as a Universal Netlist. `source` names the file in errors. */
export const parseUniversalNetlist = (text: string, source = "netlist"): ParsedNetlist => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new UniversalNetlistError(`${source}: not valid JSON (${detail})`);
  }
  return validateUniversalNetlist(raw, source);
};
