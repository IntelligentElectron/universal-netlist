/**
 * Hierarchy stream: the occurrence tree a view writes.
 *
 * The streams here are built byte by byte in the layout the parser documents,
 * so each test says which part of the layout it exercises.
 */

import { describe, expect, it } from "vitest";
import {
  buildOccurrenceRefdes,
  parseHierarchyStream,
  walkBlockOccurrences,
  walkPartOccurrences,
} from "./hierarchy-parser.js";

const u16 = (value: number): Buffer => {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
};

const u32 = (value: number): Buffer => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
};

const str = (value: string): Buffer =>
  Buffer.concat([u16(value.length), Buffer.from(value, "latin1"), Buffer.alloc(1)]);

/** A structure's framing: one short prefix carrying `pairs`, then the preamble. */
const framing = (type: number, pairs: [number, number][] = [], trailing?: Buffer): Buffer =>
  Buffer.concat([
    Buffer.from([type]),
    u16(pairs.length),
    ...pairs.flatMap(([name, value]) => [u32(name), u32(value)]),
    Buffer.from([0xff, 0xe4, 0x5c, 0x39]),
    u32(trailing?.length ?? 0),
    trailing ?? Buffer.alloc(0),
  ]);

const net = (dbId: number, name: string): Buffer =>
  Buffer.concat([framing(67), u32(dbId), str(name)]);

interface PinSpec {
  properties?: [number, number][];
}

interface OccurrenceSpec {
  occurrenceId: number;
  dbId: number;
  schematic?: string;
  reference?: string;
  pins?: PinSpec[];
  scope?: ScopeSpec;
  trailing?: Buffer;
}

interface ScopeSpec {
  nets?: [number, string][];
  occurrences?: OccurrenceSpec[];
}

/** A nested scope: net count, two empty auxiliary lists, occurrence count. */
const scope = (spec: ScopeSpec = {}): Buffer =>
  Buffer.concat([
    u16(spec.nets?.length ?? 0),
    ...(spec.nets ?? []).map(([dbId, name]) => net(dbId, name)),
    u16(0),
    u32(0),
    u16(spec.occurrences?.length ?? 0),
    ...(spec.occurrences ?? []).map(occurrence),
  ]);

function occurrence(spec: OccurrenceSpec): Buffer {
  const pins = spec.pins ?? [];
  return Buffer.concat([
    framing(66, [], spec.trailing),
    u32(spec.occurrenceId),
    u32(spec.dbId),
    Buffer.from([0x42]),
    u32(0),
    u32(0),
    str(spec.schematic ?? ""),
    str(spec.reference ?? ""),
    u32(0),
    u16(pins.length),
    ...pins.map((pin, ordinal) =>
      Buffer.concat([framing(68, pin.properties ?? []), u32(1000 + ordinal), u16(ordinal)])
    ),
    scope(spec.scope),
  ]);
}

interface TopLayout {
  wideAuxCount?: boolean;
  wideOccurrenceCount?: boolean;
  /** Trailing data of the top-level scope's preamble: the design's property bag. */
  propertyBag?: Buffer;
}

/**
 * A whole stream: header, root schematic name, then the top-level scope.
 *
 * The preamble before the occurrence count is written unconditionally, as a real
 * file writes it; `propertyBag` fills its trailing data.
 */
const stream = (schematic: string, spec: ScopeSpec, layout: TopLayout = {}): Buffer =>
  Buffer.concat([
    Buffer.alloc(9),
    str(schematic),
    Buffer.alloc(7),
    u16(0), // named entries
    u16(spec.nets?.length ?? 0),
    ...(spec.nets ?? []).map(([dbId, name]) => net(dbId, name)),
    u16(0),
    layout.wideAuxCount === false ? u16(0) : u32(0),
    Buffer.from([0xff, 0xe4, 0x5c, 0x39]),
    u32(layout.propertyBag?.length ?? 0),
    layout.propertyBag ?? Buffer.alloc(0),
    layout.wideOccurrenceCount
      ? u32(spec.occurrences?.length ?? 0)
      : u16(spec.occurrences?.length ?? 0),
    ...(spec.occurrences ?? []).map(occurrence),
  ]);

/** A reference-range bag, as Capture writes it when pages number their own parts. */
const REFERENCE_RANGE_BAG = Buffer.from(
  '\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x001 3 15 REFERENCE_RANGE 1 19 REFERENCE_RANGE_BAG 1 13 CDS_REF_RANGE 54 {"page":[{"1.TOP":{"global":{"*":[{"start":"1"}]}}}]}',
  "latin1"
);

describe("parseHierarchyStream", () => {
  it("reads the root schematic, its nets and its part occurrences", () => {
    const parsed = parseHierarchyStream(
      stream("Main", {
        nets: [
          [67, "GND"],
          [107, "N00776"],
        ],
        occurrences: [
          { occurrenceId: 41, dbId: 246, reference: "C2" },
          { occurrenceId: 58, dbId: 405, reference: "U1" },
        ],
      })
    );

    expect(parsed.schematic).toBe("Main");
    expect(parsed.scope.nets).toEqual([
      { dbId: 67, name: "GND" },
      { dbId: 107, name: "N00776" },
    ]);
    expect(parsed.scope.parts.map((p) => [p.occurrenceId, p.dbId, p.reference])).toEqual([
      [41, 246, "C2"],
      [58, 405, "U1"],
    ]);
    expect(parsed.scope.blocks).toEqual([]);
  });

  it("keeps an occurrence that annotates no reference, with an empty one", () => {
    const parsed = parseHierarchyStream(
      stream("Main", { occurrences: [{ occurrenceId: 1, dbId: 9 }] })
    );

    expect(parsed.scope.parts[0].reference).toBe("");
  });

  it("reads past the preamble's trailing data to the occurrence body", () => {
    // A record carrying a display-property block for the reference declares
    // its length in the preamble; the body sits that many bytes further on.
    const parsed = parseHierarchyStream(
      stream("Main", {
        occurrences: [
          { occurrenceId: 7, dbId: 99, reference: "R5", trailing: Buffer.alloc(39, 0xaa) },
        ],
      })
    );

    expect(parsed.scope.parts).toEqual([{ occurrenceId: 7, dbId: 99, reference: "R5", pins: [] }]);
  });

  it("opens a scope per block placement, with that placement's nets and parts", () => {
    const parsed = parseHierarchyStream(
      stream("Main", {
        nets: [[109, "N00874"]],
        occurrences: [
          {
            occurrenceId: 2,
            dbId: 17,
            schematic: "monostable",
            scope: {
              nets: [
                [10, "SIG_IN"],
                [170, "N00439"],
              ],
              occurrences: [{ occurrenceId: 153, dbId: 275, reference: "C6" }],
            },
          },
          {
            occurrenceId: 5,
            dbId: 39,
            schematic: "monostable",
            scope: {
              nets: [
                [10, "SIG_IN"],
                [170, "N00439"],
              ],
              occurrences: [{ occurrenceId: 208, dbId: 275, reference: "C9" }],
            },
          },
          { occurrenceId: 87, dbId: 540, reference: "D1" },
        ],
      })
    );

    expect(parsed.scope.parts.map((p) => p.reference)).toEqual(["D1"]);
    expect(parsed.scope.blocks.map((b) => [b.occurrenceId, b.dbId, b.schematic])).toEqual([
      [2, 17, "monostable"],
      [5, 39, "monostable"],
    ]);
    // One drawing, placed twice: the same instance annotates a refdes per placement.
    expect(parsed.scope.blocks.map((b) => b.scope.parts[0])).toMatchObject([
      { dbId: 275, reference: "C6" },
      { dbId: 275, reference: "C9" },
    ]);
    expect(parsed.scope.blocks[0].scope.nets.map((n) => n.name)).toEqual(["SIG_IN", "N00439"]);
  });

  it("nests a block placed inside a block", () => {
    const parsed = parseHierarchyStream(
      stream("TOP", {
        occurrences: [
          {
            occurrenceId: 1,
            dbId: 11,
            schematic: "outer",
            scope: {
              occurrences: [
                {
                  occurrenceId: 2,
                  dbId: 22,
                  schematic: "inner",
                  scope: { occurrences: [{ occurrenceId: 3, dbId: 33, reference: "U1" }] },
                },
              ],
            },
          },
        ],
      })
    );

    expect([...walkBlockOccurrences(parsed.scope)].map((b) => b.schematic)).toEqual([
      "outer",
      "inner",
    ]);
    expect([...walkPartOccurrences(parsed.scope)].map((p) => p.reference)).toEqual(["U1"]);
  });

  it("reads each pin's ordinal and the properties on its record", () => {
    const parsed = parseHierarchyStream(
      stream("Main", {
        occurrences: [
          {
            occurrenceId: 426,
            dbId: 2681,
            reference: "U4",
            pins: [{ properties: [[103, 101]] }, { properties: [[103, 105]] }, {}],
          },
        ],
      })
    );

    expect(parsed.scope.parts[0].pins).toEqual([
      { ordinal: 0, properties: [[103, 101]] },
      { ordinal: 1, properties: [[103, 105]] },
      { ordinal: 2, properties: [] },
    ]);
  });

  it.each([
    ["narrow auxiliary count", { wideAuxCount: false }],
    ["wide occurrence count", { wideOccurrenceCount: true }],
    ["property bag before the occurrence count", { propertyBag: REFERENCE_RANGE_BAG }],
    [
      "property bag and a narrow auxiliary count",
      { wideAuxCount: false, propertyBag: REFERENCE_RANGE_BAG },
    ],
    [
      "property bag and a wide occurrence count",
      { wideOccurrenceCount: true, propertyBag: REFERENCE_RANGE_BAG },
    ],
  ])("reads a top-level scope laid out with a %s", (_name, layout: TopLayout) => {
    const parsed = parseHierarchyStream(
      stream(
        "Main",
        { nets: [[1, "VCC"]], occurrences: [{ occurrenceId: 1, dbId: 2, reference: "R1" }] },
        layout
      )
    );

    expect(parsed.scope.nets[0].name).toBe("VCC");
    expect(parsed.scope.parts[0].reference).toBe("R1");
  });

  it("refuses a stream no layout reads to its last byte", () => {
    const whole = stream("Main", { occurrences: [{ occurrenceId: 1, dbId: 2, reference: "R1" }] });

    expect(() => parseHierarchyStream(whole.subarray(0, whole.length - 4))).toThrow(
      /did not parse/
    );
  });
});

describe("buildOccurrenceRefdes", () => {
  const parsed = parseHierarchyStream(
    stream("Main", {
      occurrences: [
        { occurrenceId: 1, dbId: 100, reference: "R13" },
        { occurrenceId: 2, dbId: 200 },
        { occurrenceId: 3, dbId: 300 },
        {
          occurrenceId: 4,
          dbId: 17,
          schematic: "block",
          scope: { occurrences: [{ occurrenceId: 5, dbId: 100, reference: "R113" }] },
        },
      ],
    })
  );

  it("reports the annotated reference, the inline one where none is annotated, and nothing otherwise", () => {
    const refdes = buildOccurrenceRefdes([parsed], new Map([[200, "C24"]]));

    expect([...refdes]).toEqual([
      [1, "R13"],
      [2, "C24"],
      [5, "R113"],
    ]);
  });
});
