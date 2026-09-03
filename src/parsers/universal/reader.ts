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

export interface UniversalNetlistSource {
  vendor: string;
  fileType: string;
  formatVersion?: string;
}

export type UniversalNetlistOrigin =
  | { type: "native" }
  | { type: "vendor"; source: UniversalNetlistSource };

export interface UniversalNetlistMetadata {
  generatedAt: string;
  netlistHash: string;
  origin: UniversalNetlistOrigin;
}

/** The metadata and netlist payload written to every `.netlist.json` file. */
export interface UniversalNetlistDocument extends ParsedNetlist {
  universalNetlistSchemaVersion: number;
  metadata: UniversalNetlistMetadata;
}

/** Options for producing a deterministic document when a caller needs one. */
export interface UniversalNetlistSerializationOptions {
  generatedAt?: Date | string;
  origin?: UniversalNetlistOrigin;
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

const TOP_LEVEL_KEYS = new Set(["universalNetlistSchemaVersion", "metadata", "nets", "components"]);
const METADATA_KEYS = new Set(["generatedAt", "netlistHash", "origin"]);
const NATIVE_ORIGIN_KEYS = new Set(["type"]);
const VENDOR_ORIGIN_KEYS = new Set(["type", "source"]);
const SOURCE_KEYS = new Set(["vendor", "fileType", "formatVersion"]);

/** A component field a document carries as a plain string. */
type ComponentTextField =
  | "mpn"
  | "internal_pn"
  | "manufacturer"
  | "description"
  | "comment"
  | "value";

const VERSION_1_COMPONENT_TEXT_FIELDS: readonly ComponentTextField[] = [
  "mpn",
  "description",
  "comment",
  "value",
];

/**
 * Version 2 separates the part numbers a design records into their own fields.
 *
 * In version 1 `mpn` held whichever part number a parser found first, which
 * could be the manufacturer's or the design owner's. Version 2 gives `mpn` one
 * meaning, the manufacturer's number, and adds `internal_pn` for the design
 * owner's and `manufacturer` for the name that makes an MPN a key at all.
 *
 * The fields could not be added to version 1. That reader drops component
 * fields the schema does not define and then checks `netlistHash` against what
 * is left, so a version 1 file carrying them would be rejected by every build
 * that already exists, this one included.
 */
const VERSION_2_COMPONENT_TEXT_FIELDS: readonly ComponentTextField[] = [
  ...VERSION_1_COMPONENT_TEXT_FIELDS,
  "internal_pn",
  "manufacturer",
];

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
  write(
    netlist: ParsedNetlist,
    generatedAt: string,
    origin: UniversalNetlistOrigin
  ): UniversalNetlistDocument;
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
 * `nets` and `components` are canonicalized and hashed together. The schema
 * envelope and all metadata are intentionally excluded, so metadata-only
 * changes do not alter the electrical netlist's identity.
 */
export const calculateUniversalNetlistHash = (netlist: ParsedNetlist): string => {
  const canonical = JSON.stringify(
    canonicalize({
      nets: netlist.nets,
      components: netlist.components,
    })
  );
  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
};

const isCanonicalGeneratedAt = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
};

const normalizeGeneratedAt = (value: Date | string = new Date()): string => {
  const generatedAt =
    value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : value;
  if (!isCanonicalGeneratedAt(generatedAt)) {
    throw new Error(
      "Universal Netlist generation time must be a canonical ISO 8601 UTC timestamp, for example 2026-09-01T12:34:56.789Z"
    );
  }
  return generatedAt;
};

const rejectUnexpectedKeys = (
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  description: string,
  fail: Fail
): void => {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`unexpected ${description} key '${key}'`);
  }
};

const readOrigin = (raw: unknown, fail: Fail): UniversalNetlistOrigin => {
  if (!isObject(raw)) fail("`metadata.origin` must be an object");
  if (raw.type === "native") {
    rejectUnexpectedKeys(raw, NATIVE_ORIGIN_KEYS, "native origin", fail);
    return { type: "native" };
  }
  if (raw.type !== "vendor") {
    fail("`metadata.origin.type` must be either `native` or `vendor`");
  }
  rejectUnexpectedKeys(raw, VENDOR_ORIGIN_KEYS, "vendor origin", fail);
  if (!isObject(raw.source)) fail("vendor `metadata.origin` must have a `source` object");
  rejectUnexpectedKeys(raw.source, SOURCE_KEYS, "source", fail);
  if (typeof raw.source.vendor !== "string" || !raw.source.vendor.trim()) {
    fail("`metadata.origin.source.vendor` must be a non-empty string");
  }
  if (
    typeof raw.source.fileType !== "string" ||
    !/^\.[a-z0-9][a-z0-9_+-]*$/.test(raw.source.fileType)
  ) {
    fail(
      "`metadata.origin.source.fileType` must be a canonical lowercase file extension beginning with `.`"
    );
  }
  if (
    raw.source.formatVersion !== undefined &&
    (typeof raw.source.formatVersion !== "string" || !raw.source.formatVersion.trim())
  ) {
    fail("`metadata.origin.source.formatVersion` must be a non-empty string when present");
  }
  return {
    type: "vendor",
    source: {
      vendor: raw.source.vendor,
      fileType: raw.source.fileType,
      ...(typeof raw.source.formatVersion === "string"
        ? { formatVersion: raw.source.formatVersion }
        : {}),
    },
  };
};

const normalizeOrigin = (
  value: UniversalNetlistOrigin = { type: "native" }
): UniversalNetlistOrigin =>
  readOrigin(value, (message) => {
    throw new Error(`Invalid Universal Netlist origin: ${message}`);
  });

/**
 * Read a pin entry's net name. `""` is how the EDA parsers write a pin that is
 * connected to nothing; `loadNetlist` normalizes it to `NC` after parsing.
 */
const netOf = (entry: PinEntry): string => (typeof entry === "string" ? entry : entry.net);

/**
 * Build the reader for one schema version.
 *
 * Every version validates the same envelope and the same net and pin
 * structure; they differ only in which component fields they carry, so the
 * field list is the parameter. Fields the version does not define on a
 * component are dropped, and because `netlistHash` is checked against what
 * survives that drop, a document carrying a field from a later version is
 * rejected here rather than silently losing it.
 *
 * `source` names the file in error messages. The schema marker and payload keys
 * are the only top-level keys allowed. A net member written as one pin number
 * string is read as a one-element array, which is the form every tool works on.
 */
const makeVersionReader =
  (componentTextFields: readonly ComponentTextField[]) =>
  (raw: Record<string, unknown>, fail: Fail): ParsedNetlist => {
    if (!isObject(raw.metadata)) fail("`metadata` must be an object");
    rejectUnexpectedKeys(raw.metadata, METADATA_KEYS, "metadata", fail);
    if (!isCanonicalGeneratedAt(raw.metadata.generatedAt)) {
      fail(
        "`metadata.generatedAt` must be a canonical ISO 8601 UTC timestamp, for example 2026-09-01T12:34:56.789Z"
      );
    }
    if (
      typeof raw.metadata.netlistHash !== "string" ||
      !/^sha256:[0-9a-f]{64}$/.test(raw.metadata.netlistHash)
    ) {
      fail("`metadata.netlistHash` must be `sha256:` followed by 64 lowercase hexadecimal digits");
    }
    readOrigin(raw.metadata.origin, fail);
    if (!isObject(raw.nets) || !isObject(raw.components)) {
      fail("`nets` and `components` must be objects");
    }
    for (const key of Object.keys(raw)) {
      if (!TOP_LEVEL_KEYS.has(key)) {
        fail(
          `unexpected top-level key '${key}'; a Universal Netlist has only ` +
            "`universalNetlistSchemaVersion`, `metadata`, `nets`, and `components`"
        );
      }
    }

    // Components: shape of every entry, and the pin map each one declares.
    const components: ComponentDetails = {};
    for (const [refdes, body] of Object.entries(raw.components)) {
      if (!refdes) fail("a component has an empty reference designator");
      if (!isObject(body)) fail(`component '${refdes}' must be an object`);
      if (!isObject(body.pins)) fail(`component '${refdes}' has no \`pins\` object`);
      for (const field of componentTextFields) {
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
      for (const field of componentTextFields) {
        if (typeof body[field] === "string") component[field] = body[field];
      }
      if (body.dns === true) component.dns = true;
      components[refdes] = component;
    }

    // Nets: shape of every member list.
    const nets: NetConnections = {};
    for (const [net, members] of Object.entries(raw.nets)) {
      if (!net) fail("a net has an empty name");
      if (!isObject(members))
        fail(`net '${net}' must be an object mapping refdes to pin number(s)`);
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
    const expectedHash = calculateUniversalNetlistHash(netlist);
    if (raw.metadata.netlistHash !== expectedHash) {
      fail("`metadata.netlistHash` does not match the canonical nets and components");
    }

    return netlist;
  };

/**
 * Drop the component fields a schema version does not define.
 *
 * The hash is taken over the projection, not over the internal netlist, so a
 * version can never sign a hash covering a field its own reader would discard.
 * Without this, writing a netlist carrying a newer field through an older codec
 * produces a document that build cannot read back.
 */
const projectComponents = (
  netlist: ParsedNetlist,
  componentTextFields: readonly ComponentTextField[]
): ParsedNetlist => {
  const carried = new Set<string>([...componentTextFields, "pins", "dns"]);
  const components: ComponentDetails = {};
  for (const [refdes, body] of Object.entries(netlist.components)) {
    // Copied in the component's own key order. Order carries no meaning to any
    // reader, but it is what a golden file's diff is made of, so a projection
    // that normalized it would rewrite every line of every golden.
    const projected: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      if (!carried.has(key) || value === undefined) continue;
      if (key === "dns" && value !== true) continue;
      projected[key] = value;
    }
    if (!("pins" in projected)) projected.pins = body.pins;
    components[refdes] = projected as ComponentDetails[string];
  }
  return { nets: netlist.nets, components };
};

const makeVersionCodec = (
  version: number,
  componentTextFields: readonly ComponentTextField[]
): UniversalNetlistSchemaCodec => ({
  read: makeVersionReader(componentTextFields),
  write: (netlist, generatedAt, origin) => {
    const projected = projectComponents(netlist, componentTextFields);
    return {
      universalNetlistSchemaVersion: version,
      metadata: {
        generatedAt,
        netlistHash: calculateUniversalNetlistHash(projected),
        origin,
      },
      nets: projected.nets,
      components: projected.components,
    };
  },
});

/**
 * Every on-disk schema version this build can read and write.
 *
 * Never replace an older entry when introducing a newer schema. Add its codec
 * here, then advance `UNIVERSAL_NETLIST_SCHEMA_VERSION` so new exports use it.
 */
const SCHEMA_CODECS: ReadonlyMap<number, UniversalNetlistSchemaCodec> = new Map([
  [1, makeVersionCodec(1, VERSION_1_COMPONENT_TEXT_FIELDS)],
  [2, makeVersionCodec(2, VERSION_2_COMPONENT_TEXT_FIELDS)],
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
  currentCodec().write(
    netlist,
    normalizeGeneratedAt(options.generatedAt),
    normalizeOrigin(options.origin)
  );

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

/** Parse JSON text and retain both the validated payload and its provenance metadata. */
export const parseUniversalNetlistDocument = (
  text: string,
  source = "netlist"
): UniversalNetlistDocument => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new UniversalNetlistError(`${source}: not valid JSON (${detail})`);
  }
  const netlist = validateUniversalNetlist(raw, source);
  const document = raw as UniversalNetlistDocument;
  return {
    universalNetlistSchemaVersion: document.universalNetlistSchemaVersion,
    metadata: {
      generatedAt: document.metadata.generatedAt,
      netlistHash: document.metadata.netlistHash,
      origin: document.metadata.origin,
    },
    nets: netlist.nets,
    components: netlist.components,
  };
};

/** Parse JSON text as a Universal Netlist. `source` names the file in errors. */
export const parseUniversalNetlist = (text: string, source = "netlist"): ParsedNetlist => {
  const { nets, components } = parseUniversalNetlistDocument(text, source);
  return { nets, components };
};
