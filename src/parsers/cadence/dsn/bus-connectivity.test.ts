import { describe, expect, it } from "vitest";
import { BinaryReader } from "./binary-reader.js";
import { parseT0x10, parseWire } from "./structures.js";
import { parsePage } from "./page-parser.js";
import { buildDeviceIndexMap } from "./pin-resolver.js";
import { buildNetConnectivity } from "./net-builder.js";
import { buildComponents } from "./component-builder.js";
import { getPinNet, type ParsedNetlist } from "../../../types.js";
import { validateUniversalNetlist, toUniversalNetlistDocument } from "../../universal/reader.js";
import { getRefdesPrefix, traverseCircuitFromNet } from "../../../circuit-traversal.js";

// Entirely synthetic binary records: no private schematic data in this fixture.
const u16 = (n: number): Buffer => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};
const i32 = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeInt32LE(n);
  return b;
};
const str = (s: string): Buffer => Buffer.concat([u16(s.length), Buffer.from(s), Buffer.alloc(1)]);
const prefix = (type: number): Buffer => Buffer.from([type, 0, 0]);
const pin = (type: number, index: number, x: number, y: number, netId = -1): Buffer => {
  const body = Buffer.concat([u16(index), u16(x), u16(y), i32(netId), i32(0), u16(0)]);
  // Two long prefixes + short prefix + empty preamble: same framing as the
  // observed scalar/bus placed-pin records, with identical 16-byte bodies.
  const preamble = Buffer.from([0xff, 0xe4, 0x5c, 0x39, 0, 0, 0, 0]);
  const header = Buffer.alloc(18);
  header[0] = header[9] = type;
  header.writeUInt32LE(9 + 3 + 8 + body.length, 1);
  header.writeUInt32LE(3 + 8 + body.length, 10);
  return Buffer.concat([header, prefix(type), preamble, body]);
};
const instance = (ref: string, db: number, pkg: string, pins: Buffer[]): Buffer =>
  Buffer.concat([
    prefix(0x0d),
    Buffer.alloc(8),
    str(`${pkg}.Normal`),
    i32(db),
    Buffer.alloc(8),
    u16(0),
    u16(0),
    Buffer.alloc(4),
    u16(0),
    Buffer.alloc(1),
    str(ref),
    i32(0),
    Buffer.alloc(10),
    u16(pins.length),
    ...pins,
    str(pkg),
    u16(0),
  ]);
const wire = (type: number, id: number, x1: number, y1: number, x2: number, y2: number): Buffer =>
  Buffer.concat([
    prefix(type),
    i32(id),
    i32(id),
    i32(0),
    i32(x1),
    i32(y1),
    i32(x2),
    i32(y2),
    Buffer.alloc(1),
    u16(0),
    u16(0),
    Buffer.alloc(8),
  ]);
const entry = (y: number): Buffer =>
  Buffer.concat([prefix(0x1d), i32(0), i32(100), i32(y), i32(90), i32(y + 10), Buffer.alloc(8)]);
const fixture = (): ParsedNetlist => {
  const wires = [
    ...[10, 20, 30, 40].map((y, i) => wire(0x14, i + 1, 100, y, 140, y)),
    wire(0x15, 11, 90, 0, 90, 60),
    wire(0x15, 12, 10, 80, 40, 80),
    wire(0x15, 13, 10, 100, 40, 100),
    // Coincident endpoints must not mix scalar and bus graphs.
    wire(0x14, 14, 10, 80, 0, 80),
  ];
  const instances = [
    instance("U1", 100, "HUB", [
      pin(0x10, 1, 0, 80),
      pin(0x10, 2, 0, 100, 0),
      pin(0x11, 3, 90, 0),
      pin(0x11, 4, 10, 80),
      pin(0x11, 5, 10, 100),
    ]),
    instance(
      "-USB1",
      200,
      "USB",
      [10, 20, 30, 40].map((y, i) => pin(0x10, i + 1, 140, y))
    ),
    instance("U2", 300, "PORT", [pin(0x11, 1, 40, 80)]),
    instance("U3", 400, "PORT", [pin(0x11, 1, 40, 100)]),
    instance("S1", 500, "SWITCH", [pin(0x10, 1, 100, 10), pin(0x10, 2, 100, 20)]),
  ];
  const table = [
    [1, "VBUS"],
    [2, "D-"],
    [3, "D+"],
    [4, "GND"],
    [11, "USB_BUS"],
    [12, "ETH_A"],
    [13, "ETH_B"],
    [14, "CONTROL"],
  ] as const;
  const page = parsePage(
    Buffer.concat([
      prefix(0x0a),
      str("Synthetic"),
      str("A"),
      Buffer.alloc(156),
      u16(0), // title blocks
      u16(0), // schematic nets
      u16(1), // native NetBus: its member list is outside the framed region
      Buffer.from([0x35]),
      i32(23),
      i32(0),
      i32(11),
      str(""),
      Buffer.alloc(16),
      u16(4),
      ...[1, 2, 3, 4].map(i32),
      u16(table.length),
      ...table.flatMap(([id, name]) => [str(name), i32(id)]),
      u16(wires.length),
      ...wires,
      u16(instances.length),
      ...instances,
      u16(0),
      u16(0),
      u16(0),
      u16(0), // ports, globals, OPCs, ERCs
      u16(4),
      ...[10, 20, 30, 40].map(entry),
    ])
  );
  expect(page.placedInstances).toHaveLength(5);
  expect(page.wires.filter((w) => w.kind === "bus")).toHaveLength(3);
  expect(page.busEntries).toHaveLength(4);
  const pmd = {
    pinMaps: new Map([
      ["HUB", ["1", "2", "IN", "OUT4", "OUT4"]],
      ["USB", ["1", "2", "3", "4"]],
      ["PORT", ["1"]],
      ["SWITCH", ["", ""]],
    ]),
    cachePinMaps: new Map(),
    deviceUnitRefs: new Map(),
    pinIgnores: new Map(),
    cachePinIgnores: new Map(),
  };
  const cached = new Map([
    ["HUB.Normal", { pinNames: ["VCC", "GND", "USB", "ETH1", "ETH2"] }],
    ["SWITCH.Normal", { pinNames: ["IN", "OUT"] }],
  ]);
  const devices = buildDeviceIndexMap([page]);
  const { nets, componentPins, buses, busComponentPins, busEntries, busMembers } =
    buildNetConnectivity([page], new Set(), pmd, devices, []);
  const components = buildComponents(
    [page],
    componentPins,
    [],
    cached,
    pmd,
    devices,
    busComponentPins
  );
  return { nets, components, buses, busEntries, busMembers };
};

describe("placed scalar/bus pins and typed connectivity", () => {
  it("consumes consecutive 0x10/0x11 records without losing type or alignment", () => {
    const reader = new BinaryReader(Buffer.concat([pin(0x10, 1, 10, 20), pin(0x11, 2, 30, 40)]));
    const scalar = parseT0x10(reader);
    const bus = parseT0x10(reader);
    expect(scalar).toMatchObject({ kind: "scalar", pinIndex: 1, pointX: 10, pointY: 20 });
    expect(bus).toMatchObject({ kind: "bus", pinIndex: 2, pointX: 30, pointY: 40 });
    expect(reader.remaining()).toBe(0);
  });

  it("rejects unrelated types instead of accepting arbitrary placed-pin or wire records", () => {
    expect(() => parseT0x10(new BinaryReader(pin(0x12, 1, 0, 0)))).toThrow(
      "Expected structure type"
    );
    expect(() => parseWire(new BinaryReader(wire(0x12, 1, 0, 0, 10, 0)))).toThrow(
      "Expected scalar or bus wire"
    );
  });

  it("preserves leading-hyphen refdes and distinct Ethernet links with a repeated physical label", () => {
    const n = fixture();
    expect(Object.keys(n.components)).toHaveLength(5);
    expect(getRefdesPrefix("-USB1")).toBe("USB");
    expect(n.components.U1.busPins).toEqual({
      "@100:3": { name: "USB", net: "USB_BUS" },
      "@100:4": { name: "ETH1", net: "ETH_A" },
      "@100:5": { name: "ETH2", net: "ETH_B" },
    });
    expect(n.buses?.ETH_A).toEqual({ U1: ["@100:4"], U2: ["@300:1"] });
    expect(n.buses?.ETH_B).toEqual({ U1: ["@100:5"], U3: ["@400:1"] });
    expect(n.components.U1.pinIdentities?.["@100:4"].number).toBe("OUT4");
    expect(n.components.U1.pinIdentities?.["@100:5"].number).toBe("OUT4");
  });

  it("associates four scalar USB conductors with their bus without shorting lanes or coincident wire types", () => {
    const n = fixture();
    expect([1, 2, 3, 4].map((i) => getPinNet(n.components["-USB1"].pins[i]))).toEqual([
      "VBUS",
      "D-",
      "D+",
      "GND",
    ]);
    expect(n.busEntries?.map((e) => [e.net, e.bus])).toEqual([
      ["VBUS", "USB_BUS"],
      ["D-", "USB_BUS"],
      ["D+", "USB_BUS"],
      ["GND", "USB_BUS"],
    ]);
    expect(n.busMembers).toEqual(
      ["VBUS", "D-", "D+", "GND"].map((net, i) => ({
        page: "Synthetic",
        bus: "USB_BUS",
        netId: i + 1,
        net,
      }))
    );
    expect(n.nets.ETH_A).toBeUndefined();
    expect(n.nets.CONTROL).toEqual({ U1: ["1"] });
    expect(traverseCircuitFromNet("D+", n.nets, n.components).visited_nets).toEqual(["D+"]);
  });

  it("retains both unnumbered switch terminals using explicit symbol identities", () => {
    const n = fixture();
    expect(n.components.S1.pins).toEqual({
      "@500:1": { name: "IN", net: "VBUS" },
      "@500:2": { name: "OUT", net: "D-" },
    });
    expect(n.components.S1.pinIdentities?.["@500:1"].number).toBeUndefined();
    expect(validateUniversalNetlist(toUniversalNetlistDocument(n))).toEqual(n);
  });
});
