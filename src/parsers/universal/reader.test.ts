import { describe, it, expect } from "vitest";
import {
  calculateUniversalNetlistHash,
  parseUniversalNetlist,
  serializeUniversalNetlist,
  toUniversalNetlistDocument,
  validateUniversalNetlist,
  SUPPORTED_UNIVERSAL_NETLIST_SCHEMA_VERSIONS,
  UNIVERSAL_NETLIST_SCHEMA_VERSION,
  UniversalNetlistError,
} from "./reader.js";

const GENERATED_AT = "2026-09-01T12:34:56.789Z";

const payload = () => ({
  nets: {
    VCC: { U1: ["1"], C1: ["1"] },
    GND: { U1: ["2", "3"], C1: ["2"] },
  },
  components: {
    U1: {
      mpn: "PART-1",
      description: "IC",
      pins: {
        "1": { name: "VIN", net: "VCC" },
        "2": "GND",
        "3": { name: "EP", net: "GND" },
        "4": "",
      },
    },
    C1: { value: "1uF", dns: true, pins: { "1": "VCC", "2": "GND" } },
  },
});

const valid = () => toUniversalNetlistDocument(payload(), { generatedAt: GENERATED_AT });

const rejects = (raw: unknown, fragment: string): void => {
  expect(() => validateUniversalNetlist(raw, "f.json")).toThrowError(UniversalNetlistError);
  expect(() => validateUniversalNetlist(raw, "f.json")).toThrowError(fragment);
};

describe("validateUniversalNetlist", () => {
  it("accepts a consistent netlist and keeps its fields", () => {
    const netlist = validateUniversalNetlist(valid());
    expect(netlist.nets).toEqual({
      VCC: { U1: ["1"], C1: ["1"] },
      GND: { U1: ["2", "3"], C1: ["2"] },
    });
    expect(netlist.components.U1).toEqual({
      mpn: "PART-1",
      description: "IC",
      pins: {
        "1": { name: "VIN", net: "VCC" },
        "2": "GND",
        "3": { name: "EP", net: "GND" },
        "4": "",
      },
    });
    expect(netlist.components.C1).toEqual({
      value: "1uF",
      dns: true,
      pins: { "1": "VCC", "2": "GND" },
    });
  });

  it("reads a single pin number string as a one-element array", () => {
    const raw = valid();
    raw.nets.VCC = { U1: "1" as unknown as string[], C1: "1" as unknown as string[] };
    expect(validateUniversalNetlist(raw).nets.VCC).toEqual({ U1: ["1"], C1: ["1"] });
  });

  it("drops component fields the schema does not define and an explicit dns: false", () => {
    const raw = valid();
    (raw.components.C1 as Record<string, unknown>).footprint = "0402";
    (raw.components.C1 as Record<string, unknown>).dns = false;
    raw.metadata.netlistHash = calculateUniversalNetlistHash({
      nets: raw.nets,
      components: {
        ...raw.components,
        C1: { value: "1uF", pins: { "1": "VCC", "2": "GND" } },
      },
    });
    expect(validateUniversalNetlist(raw).components.C1).toEqual({
      value: "1uF",
      pins: { "1": "VCC", "2": "GND" },
    });
  });

  it("rejects a value that is not a netlist at all", () => {
    rejects(null, "not a Universal Netlist");
    rejects([], "not a Universal Netlist");
    rejects({ nets: {}, components: {} }, "missing `universalNetlistSchemaVersion`");
  });

  it("rejects invalid and unsupported schema versions before reading the payload", () => {
    rejects(
      { universalNetlistSchemaVersion: "1", nets: {}, components: {} },
      "`universalNetlistSchemaVersion` must be an integer"
    );
    rejects(
      { universalNetlistSchemaVersion: 2, nets: {}, components: {} },
      `unsupported Universal Netlist schema version 2; supported: ${SUPPORTED_UNIVERSAL_NETLIST_SCHEMA_VERSIONS.join(", ")}`
    );
  });

  it("keeps the current writer registered as a supported reader", () => {
    expect(SUPPORTED_UNIVERSAL_NETLIST_SCHEMA_VERSIONS).toContain(UNIVERSAL_NETLIST_SCHEMA_VERSION);
  });

  it("requires nets and components objects after accepting the marker", () => {
    rejects({ ...valid(), nets: "x" }, "`nets` and `components` must be objects");
  });

  it("requires a canonical UTC generation timestamp", () => {
    rejects(
      { ...valid(), metadata: { ...valid().metadata, generatedAt: undefined } },
      "`metadata.generatedAt` must be a canonical ISO 8601 UTC timestamp"
    );
    rejects(
      {
        ...valid(),
        metadata: { ...valid().metadata, generatedAt: "2026-09-01T12:34:56.789+00:00" },
      },
      "`metadata.generatedAt` must be a canonical ISO 8601 UTC timestamp"
    );
    rejects(
      { ...valid(), metadata: { ...valid().metadata, generatedAt: "not-a-date" } },
      "`metadata.generatedAt` must be a canonical ISO 8601 UTC timestamp"
    );
  });

  it("requires and verifies the SHA-256 content hash", () => {
    const missing = { ...valid(), metadata: { ...valid().metadata, netlistHash: undefined } };
    rejects(missing, "`metadata.netlistHash` must be `sha256:`");

    rejects(
      { ...valid(), metadata: { ...valid().metadata, netlistHash: "sha256:nope" } },
      "`metadata.netlistHash` must be `sha256:`"
    );

    const changed = valid();
    changed.components.C1.value = "2uF";
    rejects(changed, "`metadata.netlistHash` does not match");
  });

  it("hashes canonical content independently of object key order", () => {
    const raw = valid();
    raw.nets = { GND: raw.nets.GND, VCC: raw.nets.VCC };
    raw.components = { C1: raw.components.C1, U1: raw.components.U1 };
    expect(() => validateUniversalNetlist(raw)).not.toThrow();
  });

  it("hashes nets and components together but excludes all metadata", () => {
    const raw = valid();
    raw.metadata.generatedAt = "2027-01-02T03:04:05.678Z";
    raw.metadata.origin = {
      type: "vendor",
      source: { vendor: "KiCad", fileType: ".kicad_pro", formatVersion: "20231120" },
    };
    expect(() => validateUniversalNetlist(raw)).not.toThrow();

    raw.components.C1.value = "2uF";
    expect(() => validateUniversalNetlist(raw)).toThrowError("`metadata.netlistHash` does not match");
  });

  it("rejects unexpected top-level and metadata keys", () => {
    rejects({ ...valid(), meta: {} }, "unexpected top-level key 'meta'");
    const raw = valid();
    (raw.metadata as unknown as Record<string, unknown>).modifiedAt = GENERATED_AT;
    rejects(raw, "unexpected metadata key 'modifiedAt'");
  });

  it("accepts native and vendor origins and validates their exact shapes", () => {
    expect(valid().metadata.origin).toEqual({ type: "native" });
    const vendor = toUniversalNetlistDocument(payload(), {
      generatedAt: GENERATED_AT,
      origin: {
        type: "vendor",
        source: { vendor: "Cadence", fileType: ".dsn", formatVersion: "3.3" },
      },
    });
    expect(() => validateUniversalNetlist(vendor)).not.toThrow();

    rejects(
      { ...valid(), metadata: { ...valid().metadata, origin: { type: "vendor" } } },
      "vendor `metadata.origin` must have a `source` object"
    );
    rejects(
      {
        ...valid(),
        metadata: {
          ...valid().metadata,
          origin: { type: "vendor", source: { vendor: "Cadence", fileType: "DSN" } },
        },
      },
      "must be a canonical lowercase file extension"
    );
  });

  it("rejects a component without a pins object", () => {
    const raw = valid();
    (raw.components as Record<string, unknown>).R9 = { value: "1k" };
    rejects(raw, "component 'R9' has no `pins` object");
  });

  it("rejects non-string text fields and a non-boolean dns", () => {
    const a = valid();
    (a.components.U1 as Record<string, unknown>).mpn = 42;
    rejects(a, "component 'U1' field 'mpn' must be a string");
    const b = valid();
    (b.components.C1 as Record<string, unknown>).dns = "yes";
    rejects(b, "component 'C1' field 'dns' must be a boolean");
  });

  it("rejects a malformed pin entry", () => {
    const raw = valid();
    (raw.components.U1.pins as Record<string, unknown>)["2"] = { name: "GND" };
    rejects(raw, "pin U1.2 must be a net name or an object with exactly `name` and `net`");
    const extra = valid();
    (extra.components.U1.pins as Record<string, unknown>)["2"] = {
      name: "GND",
      net: "GND",
      type: "power",
    };
    rejects(extra, "pin U1.2 must be a net name");
  });

  it("rejects a net member that is not a pin list", () => {
    const raw = valid();
    (raw.nets.VCC as Record<string, unknown>).U1 = 1;
    rejects(raw, "net 'VCC' member 'U1' must be a pin number or an array of pin numbers");
    const empty = valid();
    (empty.nets.VCC as Record<string, unknown>).U1 = [];
    rejects(empty, "net 'VCC' lists U1 with no pins");
  });

  it("rejects a pin listed twice under one net", () => {
    const raw = valid();
    raw.nets.GND.U1 = ["2", "2"];
    rejects(raw, "net 'GND' lists U1.2 twice");
  });

  it("rejects a net that lists an undeclared component", () => {
    const raw = valid();
    (raw.nets.VCC as Record<string, unknown>).R1 = ["1"];
    rejects(raw, "net 'VCC' lists R1, but no component 'R1' is declared");
  });

  it("rejects a net that lists a pin the component does not declare", () => {
    const raw = valid();
    raw.nets.VCC.U1 = ["1", "7"];
    rejects(raw, "net 'VCC' lists U1.7, but U1 declares no pin '7'");
  });

  it("rejects a net that lists a pin the component puts on another net", () => {
    const raw = valid();
    raw.nets.VCC.C1 = ["1", "2"];
    rejects(raw, "net 'VCC' lists C1.2, but C1.2 is on 'GND'");
  });

  it("rejects a net that lists a pin the component leaves unconnected", () => {
    const raw = valid();
    raw.nets.VCC.U1 = ["1", "4"];
    rejects(raw, "net 'VCC' lists U1.4, but U1.4 is unconnected");
  });

  it("rejects a component pin on a net that is not declared", () => {
    const raw = valid();
    raw.components.C1.pins["2"] = "AGND";
    delete (raw.nets.GND as Record<string, string[]>).C1;
    rejects(raw, "C1.2 is on 'AGND', but no net 'AGND' is declared");
  });

  it("rejects a component pin its net does not list", () => {
    const raw = valid();
    raw.nets.GND.U1 = ["2"];
    rejects(raw, "U1.3 is on 'GND', but net 'GND' does not list it");
  });

  it("accepts an unconnected pin (empty net) that no net lists", () => {
    expect(() => validateUniversalNetlist(valid())).not.toThrow();
  });
});

describe("parseUniversalNetlist", () => {
  it("names the file in a JSON syntax error", () => {
    expect(() => parseUniversalNetlist("{ nope", "x.json")).toThrowError(
      /^x\.json: not valid JSON/
    );
  });

  it("parses valid text", () => {
    expect(parseUniversalNetlist(JSON.stringify(valid())).components.C1.dns).toBe(true);
  });

  it("serializes versioned, hashed, UTC-dated metadata before the payload", () => {
    const parsed = validateUniversalNetlist(valid());
    const document = JSON.parse(serializeUniversalNetlist(parsed, { generatedAt: GENERATED_AT }));
    expect(Object.keys(document)).toEqual([
      "universalNetlistSchemaVersion",
      "metadata",
      "nets",
      "components",
    ]);
    expect(document.universalNetlistSchemaVersion).toBe(UNIVERSAL_NETLIST_SCHEMA_VERSION);
    expect(document.metadata).toEqual({
      generatedAt: GENERATED_AT,
      netlistHash: calculateUniversalNetlistHash(parsed),
      origin: { type: "native" },
    });
  });

  it("uses the current UTC time by default", () => {
    const before = Date.now();
    const document = JSON.parse(serializeUniversalNetlist(payload()));
    const after = Date.now();
    const generatedAt = Date.parse(document.metadata.generatedAt);
    expect(generatedAt).toBeGreaterThanOrEqual(before);
    expect(generatedAt).toBeLessThanOrEqual(after);
    expect(document.metadata.generatedAt).toMatch(/Z$/);
  });
});
