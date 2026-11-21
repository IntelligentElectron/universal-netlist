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
import {
  PIN_TYPES,
  type ComponentDetails,
  type NetConnections,
  type ParsedNetlist,
  type PinEntry,
  type PinType,
} from "../../types.js";
import { UNIVERSAL_NETLIST_SCHEMA_VERSION } from "../../universal-format.js";
import { isDefaultVariantLiteral } from "../variants.js";

export { UNIVERSAL_NETLIST_SCHEMA_VERSION } from "../../universal-format.js";

export interface UniversalNetlistSource {
  vendor: string;
  fileType: string;
  formatVersion?: string;
}

export type UniversalNetlistOrigin =
  { type: "native" } | { type: "vendor"; source: UniversalNetlistSource };

export interface UniversalNetlistMetadata {
  generatedAt: string;
  netlistHash: string;
  origin: UniversalNetlistOrigin;
  /**
   * The design variant whose build this document records. Omitted for the base
   * build of a design that declares no variants. Version 3 and later.
   */
  designVariant?: string;
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
  /** The design variant the netlist was built for; omit for the base build. */
  designVariant?: string;
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
const VERSION_4_TOP_LEVEL_KEYS = new Set([...TOP_LEVEL_KEYS, "netProperties"]);
const PIN_TYPE_SET: ReadonlySet<string> = new Set(PIN_TYPES);
const VERSION_1_METADATA_KEYS = new Set(["generatedAt", "netlistHash", "origin"]);
const VERSION_3_METADATA_KEYS = new Set([...VERSION_1_METADATA_KEYS, "designVariant"]);
const NATIVE_ORIGIN_KEYS = new Set(["type"]);
const VENDOR_ORIGIN_KEYS = new Set(["type", "source"]);
const SOURCE_KEYS = new Set(["vendor", "fileType", "formatVersion"]);

/** A component field a document carries as a plain string. */
type ComponentTextField =
  "mpn" | "internal_pn" | "manufacturer" | "description" | "comment" | "value";

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

/**
 * What one schema version carries beyond the envelope every version shares.
 *
 * Version 2 separates the part numbers (see above). Version 3 adds
 * `metadata.designVariant`, so a file exported from a design with named
 * variants says which build it is. It could not be added to version 2: that
 * reader refuses any metadata key it does not define, so a version 2 file
 * carrying it would be rejected by every build that already exists.
 *
 * Version 4 adds a pin's electrical `type` and `hidden` flag to the pin object,
 * and the top-level `netProperties`. Version 3 refuses a pin object with any key
 * but `name` and `net`, and any top-level key it does not define.
 */
interface VersionShape {
  readonly componentTextFields: readonly ComponentTextField[];
  readonly metadataKeys: ReadonlySet<string>;
  /** Whether a pin object may carry `type` and `hidden`, and omit `name`. */
  readonly pinDetails: boolean;
  /** Whether the document may carry `netProperties`. */
  readonly netProperties: boolean;
}

const VERSION_1: VersionShape = {
  componentTextFields: VERSION_1_COMPONENT_TEXT_FIELDS,
  metadataKeys: VERSION_1_METADATA_KEYS,
  pinDetails: false,
  netProperties: false,
};
const VERSION_2: VersionShape = {
  ...VERSION_1,
  componentTextFields: VERSION_2_COMPONENT_TEXT_FIELDS,
};
const VERSION_3: VersionShape = { ...VERSION_2, metadataKeys: VERSION_3_METADATA_KEYS };
const VERSION_4: VersionShape = { ...VERSION_3, pinDetails: true, netProperties: true };

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
    origin: UniversalNetlistOrigin,
    designVariant?: string
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

const hasNetProperties = (netlist: ParsedNetlist): boolean =>
  netlist.netProperties !== undefined && Object.keys(netlist.netProperties).length > 0;

/**
 * Hash the stable content of a Universal Netlist.
 *
 * `nets`, `components` and, when present, `netProperties` are canonicalized
 * and hashed together. The schema
 * envelope and all metadata are intentionally excluded, so metadata-only
 * changes do not alter the electrical netlist's identity.
 */
export const calculateUniversalNetlistHash = (netlist: ParsedNetlist): string => {
  const canonical = JSON.stringify(
    canonicalize({
      nets: netlist.nets,
      components: netlist.components,
      // Absent when empty, so a netlist with none hashes as it did before version 4.
      netProperties: hasNetProperties(netlist) ? netlist.netProperties : undefined,
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
 * Check a recorded design variant name. The base build is recorded by leaving
 * the field out, so `<Default>` is refused: it would read back as a declared
 * variant of that name. A design may declare a variant called `default`, and
 * that name is recorded like any other.
 */
const readDesignVariant = (raw: unknown, fail: Fail): string | undefined => {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || !raw.trim() || raw !== raw.trim()) {
    fail(
      "`metadata.designVariant` must be a non-empty string without leading or trailing whitespace"
    );
  }
  if (isDefaultVariantLiteral(raw)) {
    fail(
      `\`metadata.designVariant\` must name a declared variant, not '${raw}'; omit it for the base build`
    );
  }
  return raw;
};

const normalizeDesignVariant = (value: string | undefined): string | undefined =>
  readDesignVariant(value, (message) => {
    throw new Error(`Invalid Universal Netlist design variant: ${message}`);
  });

/**
 * Read a pin entry's net name. `""` is how the EDA parsers write a pin that is
 * connected to nothing; `loadNetlist` normalizes it to `NC` after parsing.
 */
const netOf = (entry: PinEntry): string => (typeof entry === "string" ? entry : entry.net);

const PIN_DETAIL_KEYS = new Set(["name", "net", "type", "hidden"]);

/**
 * Read a version 4 pin object: `net`, and at least one of `name`, `type` and
 * `hidden`. A pin with none of them is written as its net name alone.
 */
const readPinDetails = (entry: unknown, pin: string, fail: Fail): PinEntry => {
  if (!isObject(entry)) fail(`pin ${pin} must be a net name or an object`);
  rejectUnexpectedKeys(entry, PIN_DETAIL_KEYS, `pin ${pin}`, fail);
  if (typeof entry.net !== "string") fail(`pin ${pin} must have a string \`net\``);
  if (entry.name !== undefined && (typeof entry.name !== "string" || !entry.name)) {
    fail(`pin ${pin} field 'name' must be a non-empty string`);
  }
  if (entry.type !== undefined && !PIN_TYPE_SET.has(entry.type as string)) {
    fail(`pin ${pin} field 'type' must be one of ${PIN_TYPES.join(", ")}`);
  }
  if (entry.hidden !== undefined && entry.hidden !== true) {
    fail(`pin ${pin} field 'hidden' must be true when present`);
  }
  if (entry.name === undefined && entry.type === undefined && entry.hidden === undefined) {
    fail(`pin ${pin} is an object with only \`net\`; write its net name instead`);
  }
  return {
    ...(entry.name !== undefined && { name: entry.name as string }),
    net: entry.net,
    ...(entry.type !== undefined && { type: entry.type as PinType }),
    ...(entry.hidden === true && { hidden: true as const }),
  };
};

/** Read `netProperties`: string properties of declared nets, none of them empty. */
const readNetProperties = (
  raw: unknown,
  nets: NetConnections,
  fail: Fail
): Record<string, Record<string, string>> => {
  if (!isObject(raw)) fail("`netProperties` must be an object");
  const out: Record<string, Record<string, string>> = {};
  for (const [net, properties] of Object.entries(raw)) {
    if (!(net in nets)) fail(`\`netProperties\` names net '${net}', which is not declared`);
    if (!isObject(properties) || Object.keys(properties).length === 0) {
      fail(`\`netProperties\` of net '${net}' must be a non-empty object`);
    }
    for (const [name, value] of Object.entries(properties)) {
      if (!name || typeof value !== "string") {
        fail(`\`netProperties\` of net '${net}' must map property names to strings`);
      }
    }
    out[net] = { ...(properties as Record<string, string>) };
  }
  return out;
};

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
  ({ componentTextFields, metadataKeys, pinDetails, netProperties: allowsNetProperties }: VersionShape) =>
  (raw: Record<string, unknown>, fail: Fail): ParsedNetlist => {
    if (!isObject(raw.metadata)) fail("`metadata` must be an object");
    rejectUnexpectedKeys(raw.metadata, metadataKeys, "metadata", fail);
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
    readDesignVariant(raw.metadata.designVariant, fail);
    if (!isObject(raw.nets) || !isObject(raw.components)) {
      fail("`nets` and `components` must be objects");
    }
    const topLevelKeys = allowsNetProperties ? VERSION_4_TOP_LEVEL_KEYS : TOP_LEVEL_KEYS;
    for (const key of Object.keys(raw)) {
      if (!topLevelKeys.has(key)) {
        fail(
          `unexpected top-level key '${key}'; this schema version has only ` +
            [...topLevelKeys].map((k) => `\`${k}\``).join(", ")
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
        } else if (pinDetails) {
          pins[pin] = readPinDetails(entry, `${refdes}.${pin}`, fail);
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

    const netlist: ParsedNetlist = { nets, components };
    if (raw.netProperties !== undefined) {
      netlist.netProperties = readNetProperties(raw.netProperties, nets, fail);
    }
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
  { componentTextFields, pinDetails, netProperties }: VersionShape
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
    if (!pinDetails) projected.pins = withoutPinDetails(body.pins);
    components[refdes] = projected as ComponentDetails[string];
  }
  return {
    nets: netlist.nets,
    components,
    ...(netProperties && hasNetProperties(netlist) && { netProperties: netlist.netProperties }),
  };
};

/** A version before 4 carries a pin's name and net only. */
const withoutPinDetails = (pins: Record<string, PinEntry>): Record<string, PinEntry> =>
  Object.fromEntries(
    Object.entries(pins).map(([pin, entry]) => [
      pin,
      typeof entry === "string" || entry.name === undefined
        ? netOf(entry)
        : { name: entry.name, net: entry.net },
    ])
  );

const makeVersionCodec = (version: number, shape: VersionShape): UniversalNetlistSchemaCodec => ({
  read: makeVersionReader(shape),
  write: (netlist, generatedAt, origin, designVariant) => {
    // A version that cannot record the variant must not write a file that
    // looks like the base build when it is not.
    if (designVariant !== undefined && !shape.metadataKeys.has("designVariant")) {
      throw new Error(
        `Universal Netlist schema version ${version} cannot record design variant '${designVariant}'`
      );
    }
    const projected = projectComponents(netlist, shape);
    return {
      universalNetlistSchemaVersion: version,
      metadata: {
        generatedAt,
        netlistHash: calculateUniversalNetlistHash(projected),
        origin,
        ...(designVariant !== undefined ? { designVariant } : {}),
      },
      nets: projected.nets,
      components: projected.components,
      ...(projected.netProperties && { netProperties: projected.netProperties }),
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
  [1, makeVersionCodec(1, VERSION_1)],
  [2, makeVersionCodec(2, VERSION_2)],
  [3, makeVersionCodec(3, VERSION_3)],
  [4, makeVersionCodec(4, VERSION_4)],
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
    normalizeOrigin(options.origin),
    normalizeDesignVariant(options.designVariant)
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
      ...(document.metadata.designVariant !== undefined
        ? { designVariant: document.metadata.designVariant }
        : {}),
    },
    nets: netlist.nets,
    components: netlist.components,
    ...(netlist.netProperties && { netProperties: netlist.netProperties }),
  };
};

/** Parse JSON text as a Universal Netlist. `source` names the file in errors. */
export const parseUniversalNetlist = (text: string, source = "netlist"): ParsedNetlist => {
  const { nets, components } = parseUniversalNetlistDocument(text, source);
  return { nets, components };
};
