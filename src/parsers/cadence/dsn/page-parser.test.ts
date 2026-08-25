import { describe, expect, it } from "vitest";
import { parsePage } from "./page-parser.js";
import { StructureType } from "./structure-types.js";

const uint16 = (value: number): Buffer => {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
};

const int16 = (value: number): Buffer => {
  const buffer = Buffer.alloc(2);
  buffer.writeInt16LE(value);
  return buffer;
};

const uint32 = (value: number): Buffer => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
};

const stringLenZeroTerm = (value: string): Buffer =>
  Buffer.concat([
    uint16(Buffer.byteLength(value, "ascii")),
    Buffer.from(value, "ascii"),
    Buffer.alloc(1),
  ]);

const shortPrefix = (type: StructureType): Buffer => Buffer.from([type, 0x00, 0x00]);

const emptyBoundedStructure = (type: StructureType): Buffer => {
  const longPrefix = Buffer.alloc(9);
  longPrefix[0] = type;
  longPrefix.writeUInt32LE(3, 1); // Stop immediately after the following short prefix.
  return Buffer.concat([longPrefix, shortPrefix(type)]);
};

const port = (pairingId: number, dbId: number): Buffer =>
  Buffer.concat([
    shortPrefix(StructureType.Port),
    uint32(pairingId),
    uint32(0), // library string index
    stringLenZeroTerm("PORT"),
    uint32(dbId),
    int16(20), // locY
    int16(10), // locX
    int16(21), // y2
    int16(11), // x2
    int16(9), // x1
    int16(19), // y1
    Buffer.alloc(4), // color and unknown bytes
    uint16(0), // SymbolDisplayProp count
    Buffer.from([0x00]), // unknown flag
    Buffer.alloc(9), // Port-specific trailing bytes
  ]);

const placedInstance = (reference: string): Buffer =>
  Buffer.concat([
    shortPrefix(StructureType.PlacedInstance),
    Buffer.alloc(8),
    stringLenZeroTerm("RES.Normal"),
    uint32(1234),
    Buffer.alloc(8),
    int16(100),
    int16(200),
    Buffer.alloc(4),
    uint16(0), // SymbolDisplayProp count
    Buffer.alloc(1),
    stringLenZeroTerm(reference),
    uint32(0), // part value string index
    Buffer.alloc(10),
    uint16(0), // pin instance count
    stringLenZeroTerm("RES"),
    uint16(0), // section index
  ]);

const page = (instances: Buffer[], ports: Buffer[]): Buffer =>
  Buffer.concat([
    shortPrefix(StructureType.Page),
    stringLenZeroTerm("Synthetic"),
    stringLenZeroTerm("A"),
    Buffer.alloc(156), // PageSettings
    uint16(0), // TitleBlocks
    uint16(0), // T0x34
    uint16(0), // T0x35
    uint16(0), // net table
    uint16(0), // wires
    uint16(instances.length),
    ...instances,
    uint16(ports.length),
    ...ports,
    uint16(0), // Globals
    uint16(0), // OffPageConnectors
  ]);

describe("parsePage", () => {
  it("parses consecutive Port records without an outer five-byte trailer", () => {
    const parsed = parsePage(page([], [port(1001, 2001), port(1002, 2002)]));

    expect(parsed.ports).toHaveLength(2);
    expect(parsed.ports.map((item) => item.pairingId)).toEqual([1001, 1002]);
    expect(parsed.ports.map((item) => item.dbId)).toEqual([2001, 2002]);
  });

  it("skips DrawnInstance records in a mixed page instance array", () => {
    const drawn = emptyBoundedStructure(StructureType.DrawnInstance);
    const parsed = parsePage(page([drawn, placedInstance("R1")], []));

    expect(parsed.placedInstances).toHaveLength(1);
    expect(parsed.placedInstances[0].reference).toBe("R1");
  });
});
