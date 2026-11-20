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
import type {
  ComponentDetails,
  NetConnections,
  ParsedNetlist,
  PinEntry,
  BusEntryConnection,
  BusMember,
  PinIdentity,
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
 */
interface VersionShape {
  readonly componentTextFields: readonly ComponentTextField[];
  readonly metadataKeys: ReadonlySet<string>;
  readonly topology?: boolean;
}

const VERSION_1: VersionShape = {
  componentTextFields: VERSION_1_COMPONENT_TEXT_FIELDS,
  metadataKeys: VERSION_1_METADATA_KEYS,
};
const VERSION_2: VersionShape = {
  ...VERSION_1,
  componentTextFields: VERSION_2_COMPONENT_TEXT_FIELDS,
};
const VERSION_3: VersionShape = { ...VERSION_2, metadataKeys: VERSION_3_METADATA_KEYS };
const VERSION_4: VersionShape = { ...VERSION_3, topology: true };

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
      ...(netlist.buses !== undefined ? { buses: netlist.buses } : {}),
      ...(netlist.busEntries !== undefined ? { busEntries: netlist.busEntries } : {}),
      ...(netlist.busMembers !== undefined ? { busMembers: netlist.busMembers } : {}),
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
  ({ componentTextFields, metadataKeys, topology }: VersionShape) =>
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
    for (const key of Object.keys(raw)) {
      if (
        !TOP_LEVEL_KEYS.has(key) &&
        !(topology && ["buses", "busEntries", "busMembers"].includes(key))
      ) {
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

    const netlist: ParsedNetlist = { nets, components };
    if (topology) readTopology(raw, netlist, fail);
    const expectedHash = calculateUniversalNetlistHash(netlist);
    if (raw.metadata.netlistHash !== expectedHash) {
      fail("`metadata.netlistHash` does not match the canonical nets and components");
    }

    return netlist;
  };

/** Validate and retain schema 4 topology, with independent inverse bus/pin maps. */
function readTopology(raw: Record<string, unknown>, netlist: ParsedNetlist, fail: Fail): void {
  const readPins = (value: unknown, where: string): Record<string, PinEntry> => {
    if (!isObject(value)) fail(`${where} must be a pin map`);
    const pins: Record<string, PinEntry> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (!key) fail(`${where} has an empty terminal key`);
      if (typeof entry === "string") pins[key] = entry;
      else if (
        isObject(entry) &&
        typeof entry.name === "string" &&
        typeof entry.net === "string" &&
        Object.keys(entry).length === 2
      ) {
        pins[key] = { name: entry.name, net: entry.net };
      } else fail(`${where}.${key} must be a net name or {name, net}`);
    }
    return pins;
  };
  for (const [refdes, value] of Object.entries(
    raw.components as Record<string, Record<string, unknown>>
  )) {
    const component = netlist.components[refdes];
    if (value.busPins !== undefined) {
      component.busPins = readPins(value.busPins, `${refdes}.busPins`);
      for (const key of Object.keys(component.busPins))
        if (key in component.pins) fail(`${refdes}.${key} is both scalar and bus`);
    }
    if (value.pinIdentities !== undefined) {
      if (!isObject(value.pinIdentities)) fail(`${refdes}.pinIdentities must be an object`);
      const identities: Record<string, PinIdentity> = {};
      for (const [key, identity] of Object.entries(value.pinIdentities)) {
        if (!(key in component.pins) && !(key in (component.busPins ?? {})))
          fail(`${refdes}.${key} identity names no terminal`);
        if (
          !isObject(identity) ||
          !Number.isSafeInteger(identity.instanceId) ||
          (identity.instanceId as number) < 0 ||
          !Number.isSafeInteger(identity.index) ||
          (identity.index as number) < 0 ||
          (identity.number !== undefined &&
            (typeof identity.number !== "string" || !identity.number.trim()))
        ) {
          fail(`${refdes}.${key} has an invalid source identity`);
        }
        rejectUnexpectedKeys(
          identity,
          new Set(["instanceId", "index", "number"]),
          "pin identity",
          fail
        );
        if (key !== `@${identity.instanceId}:${identity.index}`)
          fail(`${refdes}.${key} does not match its source identity`);
        identities[key] = {
          instanceId: identity.instanceId as number,
          index: identity.index as number,
          ...(identity.number !== undefined ? { number: identity.number as string } : {}),
        };
      }
      component.pinIdentities = identities;
    }
  }
  const hasPins = Object.values(netlist.components).some((c) => c.busPins !== undefined);
  if (raw.buses !== undefined || hasPins) {
    if (!isObject(raw.buses)) fail("busPins require a buses object");
    const buses: NetConnections = {};
    for (const [name, members] of Object.entries(raw.buses)) {
      if (!name || !isObject(members)) fail("buses must map nonempty names to member objects");
      const out: Record<string, string[]> = {};
      for (const [refdes, pins] of Object.entries(members)) {
        if (
          !Array.isArray(pins) ||
          !pins.length ||
          pins.some((p) => typeof p !== "string" || !p) ||
          new Set(pins).size !== pins.length
        )
          fail(`bus '${name}' has invalid terminal keys`);
        for (const key of pins as string[]) {
          const entry = netlist.components[refdes]?.busPins?.[key];
          if (entry === undefined || netOf(entry) !== name)
            fail(`bus '${name}' member ${refdes}.${key} has no inverse bus pin`);
        }
        out[refdes] = [...(pins as string[])];
      }
      buses[name] = out;
    }
    for (const [refdes, component] of Object.entries(netlist.components)) {
      for (const [key, entry] of Object.entries(component.busPins ?? {})) {
        const name = netOf(entry);
        if (name === "") continue;
        if (!buses[name]?.[refdes]?.includes(key))
          fail(`${refdes}.${key} has no inverse bus membership`);
      }
    }
    netlist.buses = buses;
  }
  const point = (v: unknown): v is [number, number] =>
    Array.isArray(v) && v.length === 2 && v.every(Number.isFinite);
  if (raw.busEntries !== undefined) {
    if (!Array.isArray(raw.busEntries)) fail("busEntries must be an array");
    netlist.busEntries = raw.busEntries.map((e): BusEntryConnection => {
      if (!isObject(e) || typeof e.page !== "string" || !point(e.start) || !point(e.end))
        fail("bus entry requires page and finite coordinate pairs");
      rejectUnexpectedKeys(e, new Set(["page", "start", "end", "bus", "net"]), "bus entry", fail);
      if ((e.bus === undefined) !== (e.net === undefined))
        fail("a bus entry must resolve both endpoints or neither");
      if (e.bus !== undefined && (typeof e.bus !== "string" || !netlist.buses?.[e.bus]))
        fail("bus entry references unknown bus");
      if (e.net !== undefined && (typeof e.net !== "string" || !netlist.nets[e.net]))
        fail("bus entry references unknown scalar net");
      return {
        page: e.page,
        start: [...e.start],
        end: [...e.end],
        ...(e.bus !== undefined ? { bus: e.bus as string, net: e.net as string } : {}),
      };
    });
  }
  if (raw.busMembers !== undefined) {
    if (!Array.isArray(raw.busMembers)) fail("busMembers must be an array");
    netlist.busMembers = raw.busMembers.map((m): BusMember => {
      if (
        !isObject(m) ||
        typeof m.page !== "string" ||
        typeof m.bus !== "string" ||
        !netlist.buses?.[m.bus] ||
        !Number.isSafeInteger(m.netId) ||
        (m.netId as number) < 0 ||
        (m.net !== undefined && (typeof m.net !== "string" || !netlist.nets[m.net]))
      )
        fail("invalid native bus membership");
      rejectUnexpectedKeys(m, new Set(["page", "bus", "netId", "net"]), "bus member", fail);
      return {
        page: m.page,
        bus: m.bus,
        netId: m.netId as number,
        ...(m.net !== undefined ? { net: m.net as string } : {}),
      };
    });
  }
}

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
  componentTextFields: readonly ComponentTextField[],
  topology = false
): ParsedNetlist => {
  const carried = new Set<string>([
    ...componentTextFields,
    "pins",
    "dns",
    ...(topology ? ["busPins", "pinIdentities"] : []),
  ]);
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
  return {
    nets: netlist.nets,
    components,
    ...(topology && netlist.buses !== undefined ? { buses: netlist.buses } : {}),
    ...(topology && netlist.busEntries !== undefined ? { busEntries: netlist.busEntries } : {}),
    ...(topology && netlist.busMembers !== undefined ? { busMembers: netlist.busMembers } : {}),
  };
};

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
    if (
      !shape.topology &&
      (netlist.buses ||
        netlist.busEntries ||
        netlist.busMembers ||
        Object.values(netlist.components).some((c) => c.busPins || c.pinIdentities))
    ) {
      throw new Error(
        `Universal Netlist schema version ${version} cannot preserve bus topology or source pin identities`
      );
    }
    const projected = projectComponents(netlist, shape.componentTextFields, shape.topology);
    return {
      universalNetlistSchemaVersion: version,
      metadata: {
        generatedAt,
        netlistHash: calculateUniversalNetlistHash(projected),
        origin,
        ...(designVariant !== undefined ? { designVariant } : {}),
      },
      ...projected,
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
    ...netlist,
  };
};

/** Parse JSON text as a Universal Netlist. `source` names the file in errors. */
export const parseUniversalNetlist = (text: string, source = "netlist"): ParsedNetlist => {
  const {
    universalNetlistSchemaVersion: _v,
    metadata: _m,
    ...netlist
  } = parseUniversalNetlistDocument(text, source);
  return netlist;
};
