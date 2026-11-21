/**
 * Net building over expanded placements: a block drawn once and placed twice
 * reports two sets of local nets, its ports join the parent's nets, and a
 * power net stays one net.
 */

import { describe, expect, it } from "vitest";
import { buildNetConnectivity } from "./net-builder.js";
import { expandHierarchy } from "./hierarchy-expander.js";
import type { HierarchyStream } from "./hierarchy-parser.js";
import type { PageData } from "./page-parser.js";
import type { PinMapData } from "./structure-types.js";
import type { DrawnInstance, GraphicInst, PlacedInstance, T0x10, Wire } from "./structures.js";

const SENTINEL = 0xffffffff;

const pin = (pinIndex: number, x: number, y: number, wireId: number): T0x10 => ({
  pinIndex,
  pointX: x,
  pointY: y,
  wireId,
  netId: 0,
  symbolDisplayProps: [],
});

const part = (dbId: number, reference: string, pins: T0x10[]): PlacedInstance => ({
  pkgName: "X.Normal",
  dbId,
  reference,
  sourcePackage: "X",
  partValueIdx: 0,
  prefixProperties: [],
  locX: 0,
  locY: 0,
  symbolDisplayProps: [],
  t0x10s: pins,
  sectionIndex: 0,
  box: { x1: 0, y1: 0, x2: 0, y2: 0 },
  rotation: 0,
  mirrored: false,
});

const wire = (
  id: number,
  segmentId: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): Wire => ({
  id,
  segmentId,
  startX: x1,
  startY: y1,
  endX: x2,
  endY: y2,
  aliases: [],
  bus: false,
  junctions: 0,
});

/**
 * A symbol whose box is 20 units around `(x, y)`; `pairingId` indexes strLst,
 * and `wireId` is its trailer's wire, the `db_id` (segment id) of the wire it touches.
 */
const symbol = (
  pairingId: number,
  dbId: number,
  x: number,
  y: number,
  wireId = 0
): GraphicInst => ({
  name: "SYMBOL",
  dbId,
  locX: x,
  locY: y,
  x1: x - 10,
  y1: y - 10,
  x2: x + 10,
  y2: y + 10,
  pairingId,
  rotation: 0,
  mirrored: false,
  symbolDisplayProps: [],
  wireId,
});

const block = (dbId: number, reference: string, ports: string[], pins: T0x10[]): DrawnInstance => ({
  dbId,
  reference,
  ports,
  pins,
  locX: 0,
  locY: 0,
  box: { x1: 0, y1: 0, x2: 0, y2: 0 },
});

const page = (spec: Partial<PageData> & { name: string }): PageData => ({
  netTable: new Map(),
  sizeName: "A",
  widthInches: 11,
  heightInches: 8.5,
  busEntries: [],
  graphics: [],
  wires: [],
  placedInstances: [],
  drawnInstances: [],
  ports: [],
  globals: [],
  offPageConnectors: [],
  ...spec,
});

const pmd: PinMapData = {
  pinMaps: new Map(),
  cachePinMaps: new Map(),
  deviceUnitRefs: new Map(),
  pinIgnores: new Map(),
  cachePinIgnores: new Map(),
};

// strLst: 5 names the hierarchical port, 6 the power symbol.
const strLst = ["", "", "", "", "", "SIG_IN", "VCC"];

/**
 * Top level: R1 on a wire to block MV1's SIG_IN pin, R3 on a wire to block
 * MV2's. The child: its SIG_IN port on a wire to C1.1; C1.2 on a local wire to
 * R2.1; R2.2 on the VCC symbol with no wire.
 */
const top = page({
  name: "TOP",
  wires: [wire(799, 776, 100, 100, 450, 360), wire(874, 870, 600, 360, 620, 360)],
  placedInstances: [part(1, "R1", [pin(1, 100, 100, 799)]), part(2, "R3", [pin(1, 600, 360, 874)])],
  drawnInstances: [
    block(17, "MV1", ["SIG_IN"], [pin(1, 450, 360, 799)]),
    block(39, "MV2", ["SIG_IN"], [pin(1, 620, 360, 874)]),
  ],
});

const child = page({
  name: "PAGE1",
  netTable: new Map([
    [3997, ["SIG_IN"]],
    [4001, ["LOCAL"]],
  ]),
  wires: [wire(3997, 3990, 10, 10, 50, 10), wire(4001, 4000, 50, 40, 80, 40)],
  placedInstances: [
    part(275, "C1", [pin(1, 50, 10, 3997), pin(2, 50, 40, 4001)]),
    part(276, "R2", [pin(1, 80, 40, 4001), pin(2, 80, 70, SENTINEL)]),
  ],
  ports: [symbol(5, 900, 10, 10, 3990)],
  globals: [symbol(6, 901, 80, 70)],
});

const placement = (occurrenceId: number, dbId: number, c: string, r: string) => ({
  occurrenceId,
  dbId,
  schematic: "child",
  reference: "",
  scope: {
    nets: [
      { dbId: 10, name: "SIG_IN" },
      { dbId: 11, name: "LOCAL" },
      { dbId: 12, name: "VCC" },
    ],
    parts: [
      { occurrenceId: occurrenceId * 10, dbId: 275, reference: c, pins: [] },
      { occurrenceId: occurrenceId * 10 + 1, dbId: 276, reference: r, pins: [] },
    ],
    blocks: [],
  },
});

const root: HierarchyStream = {
  schematic: "top",
  scope: {
    nets: [
      { dbId: 1, name: "N00776" },
      { dbId: 2, name: "N00870" },
    ],
    parts: [
      { occurrenceId: 1, dbId: 1, reference: "R1", pins: [] },
      { occurrenceId: 2, dbId: 2, reference: "R3", pins: [] },
    ],
    blocks: [placement(3, 17, "C6", "R9"), placement(4, 39, "C106", "R109")],
  },
};

describe("buildNetConnectivity over expanded placements", () => {
  const expanded = expandHierarchy(
    [root],
    new Map([
      ["top", [top]],
      ["child", [child]],
    ]),
    strLst
  );
  const { nets } = buildNetConnectivity(
    expanded.pages,
    expanded.canonicalNetNames,
    pmd,
    new Map(),
    strLst
  );

  it("joins each placement's port to the net on the parent page at the block's pin", () => {
    expect(nets.N00776).toEqual({ R1: ["1"], C6: ["1"] });
    expect(nets.N00870).toEqual({ R3: ["1"], C106: ["1"] });
  });

  it("reports a local net once per placement, suffixed with the instance name", () => {
    expect(nets.LOCAL_MV1).toEqual({ C6: ["2"], R9: ["1"] });
    expect(nets.LOCAL_MV2).toEqual({ C106: ["2"], R109: ["1"] });
    expect(nets.LOCAL).toBeUndefined();
  });

  it("keeps a power net one net across placements", () => {
    expect(nets.VCC).toEqual({ R9: ["2"], R109: ["2"] });
  });

  it("reports nothing under the port's own name", () => {
    expect(Object.keys(nets).filter((n) => n.startsWith("SIG_IN"))).toEqual([]);
  });
});

/**
 * Buses and nesting. Top level: R1 and R3 on scalar wires named as members of
 * the bus `X_D[1:0]`, which is wired to MV1's bus port `D[1:0]`; MV2 and MV3
 * share the bus `Y_D[1:0]`, which no scalar wire on the top level breaks
 * out; MV4's bus pin is not wired at all. R2 is wired to SNOW1's ports `CLK`
 * and `RST`; SNOW1 draws TILE1 inside it, and TILE1 draws U1, whose second
 * pin sits on the `RST` port symbol with no wire. Top-level pins key by the
 * wire's segment id, as in the files; the TOPCLK wire's segment id equals the X_D1
 * wire's SchematicNet id, so a bus member keyed by the wrong id space lands on TOPCLK.
 */
const busChild = page({
  name: "PAGE1",
  wires: [
    wire(700, 690, 10, 10, 40, 10),
    wire(701, 691, 10, 40, 40, 40),
    wire(702, 692, 10, 60, 40, 60),
  ],
  netTable: new Map([
    [700, ["D[1:0]"]],
    [701, ["D1"]],
    [702, ["D0"]],
  ]),
  placedInstances: [part(275, "C1", [pin(1, 40, 40, 701), pin(2, 40, 60, 702)])],
  ports: [symbol(5, 900, 10, 10, 690)],
});

const inner = page({
  name: "PAGE1",
  wires: [wire(950, 940, 10, 10, 30, 10)],
  placedInstances: [part(3, "U1", [pin(1, 30, 10, 950), pin(2, 10, 30, SENTINEL)])],
  ports: [symbol(7, 910, 10, 10, 940), symbol(8, 911, 10, 30)],
});

const outer = page({
  name: "PAGE1",
  wires: [wire(900, 890, 10, 10, 50, 10), wire(901, 891, 10, 30, 50, 30)],
  drawnInstances: [block(22, "TILE1", ["CLK", "RST"], [pin(1, 50, 10, 900), pin(2, 50, 30, 901)])],
  ports: [symbol(7, 920, 10, 10, 890), symbol(8, 921, 10, 30, 891)],
});

const busTop = page({
  name: "TOP",
  wires: [
    wire(500, 490, 10, 10, 60, 10),
    wire(501, 491, 10, 30, 60, 30),
    wire(600, 590, 100, 50, 150, 50),
    wire(601, 591, 100, 80, 150, 80),
    wire(800, 500, 180, 200, 200, 200),
    wire(801, 791, 180, 230, 200, 230),
  ],
  netTable: new Map([
    [500, ["X_D1"]],
    [501, ["X_D0"]],
    [600, ["X_D[1:0]"]],
    [601, ["Y_D[1:0]"]],
    [800, ["TOPCLK"]],
    [801, ["TOPRST"]],
  ]),
  placedInstances: [
    part(1, "R1", [pin(1, 10, 10, 490)]),
    part(2, "R3", [pin(1, 10, 30, 491)]),
    part(4, "R2", [pin(1, 180, 200, 500), pin(2, 180, 230, 791)]),
  ],
  drawnInstances: [
    block(17, "MV1", ["D[1:0]"], [pin(1, 150, 50, 590)]),
    block(39, "MV2", ["D[1:0]"], [pin(1, 150, 80, 591)]),
    block(41, "MV3", ["D[1:0]"], [pin(1, 100, 80, 591)]),
    block(43, "MV4", ["D[1:0]"], [pin(1, 300, 300, 0)]),
    block(11, "SNOW1", ["CLK", "RST"], [pin(1, 200, 200, 500), pin(2, 200, 230, 791)]),
  ],
});

const busPlacement = (occurrenceId: number, dbId: number, c: string) => ({
  occurrenceId,
  dbId,
  schematic: "buschild",
  reference: "",
  scope: {
    nets: [
      { dbId: 10, name: "D[1:0]" },
      { dbId: 11, name: "D1" },
      { dbId: 12, name: "D0" },
    ],
    parts: [{ occurrenceId: occurrenceId * 10, dbId: 275, reference: c, pins: [] }],
    blocks: [],
  },
});

const busRoot: HierarchyStream = {
  schematic: "bustop",
  scope: {
    nets: ["X_D1", "X_D0", "Y_D1", "Y_D0", "TOPCLK", "TOPRST"].map((name, i) => ({
      dbId: i,
      name,
    })),
    parts: [
      { occurrenceId: 1, dbId: 1, reference: "R1", pins: [] },
      { occurrenceId: 2, dbId: 2, reference: "R3", pins: [] },
      { occurrenceId: 3, dbId: 4, reference: "R2", pins: [] },
    ],
    blocks: [
      busPlacement(4, 17, "C6"),
      busPlacement(5, 39, "C106"),
      busPlacement(6, 41, "C206"),
      busPlacement(7, 43, "C306"),
      {
        occurrenceId: 8,
        dbId: 11,
        schematic: "outer",
        reference: "",
        scope: {
          nets: [{ dbId: 20, name: "CLK" }],
          parts: [],
          blocks: [
            {
              occurrenceId: 9,
              dbId: 22,
              schematic: "inner",
              reference: "",
              scope: {
                nets: [{ dbId: 30, name: "CLK" }],
                parts: [{ occurrenceId: 90, dbId: 3, reference: "U16", pins: [] }],
                blocks: [],
              },
            },
          ],
        },
      },
    ],
  },
};

// strLst: 5 names the bus port, 7 and 8 the two scalar ports.
const busStrLst = ["", "", "", "", "", "D[1:0]", "", "CLK", "RST"];

describe("buildNetConnectivity over bus ports and nested placements", () => {
  const expanded = expandHierarchy(
    [busRoot],
    new Map([
      ["bustop", [busTop]],
      ["buschild", [busChild]],
      ["outer", [outer]],
      ["inner", [inner]],
    ]),
    busStrLst
  );
  const { nets } = buildNetConnectivity(
    expanded.pages,
    expanded.canonicalNetNames,
    pmd,
    new Map(),
    busStrLst
  );

  it("joins each member of a bus port to the parent's member at the same position", () => {
    expect(nets.X_D1).toEqual({ R1: ["1"], C6: ["1"] });
    expect(nets.X_D0).toEqual({ R3: ["1"], C6: ["2"] });
    expect(Object.keys(nets).filter((n) => /^D[01]_MV1$/.test(n))).toEqual([]);
  });

  it("joins two placements through a parent bus that no wire on the parent breaks out", () => {
    expect(nets.Y_D1).toEqual({ C106: ["1"], C206: ["1"] });
    expect(nets.Y_D0).toEqual({ C106: ["2"], C206: ["2"] });
  });

  it("keeps a bus port's members local when the block pin is not wired", () => {
    expect(nets.D1_MV4).toEqual({ C306: ["1"] });
    expect(nets.D0_MV4).toEqual({ C306: ["2"] });
  });

  it("follows a port through a placement nested in a placement", () => {
    expect(nets.TOPCLK).toEqual({ R2: ["1"], U16: ["1"] });
  });

  it("follows a pin that sits on a port symbol with no wire", () => {
    expect(nets.TOPRST).toEqual({ R2: ["2"], U16: ["2"] });
  });
});

/** A pin that no wire reaches, carrying only its SchematicNet id at +0x0A (§7.4). */
const hiddenPin = (pinIndex: number, x: number, y: number, netId: number): T0x10 => ({
  ...pin(pinIndex, x, y, 0),
  netId,
});

describe("pins joined only by their net id, in a block placed twice", () => {
  // U1.1 and U2.1 meet pin to pin (net id 5000, no wire); U2.2 is a hidden pin
  // on the net the LOCAL wire carries (net id 4001).
  const drawing = page({
    name: "PAGE1",
    netTable: new Map([[4001, ["LOCAL"]]]),
    wires: [wire(4001, 4000, 50, 40, 80, 40)],
    placedInstances: [
      part(275, "U1", [hiddenPin(1, 200, 200, 5000), pin(2, 50, 40, 4000)]),
      part(276, "U2", [hiddenPin(1, 200, 200, 5000), hiddenPin(2, 300, 300, 4001)]),
    ],
  });
  const occurrence = (occurrenceId: number, dbId: number, u1: string, u2: string) => ({
    ...placement(occurrenceId, dbId, u1, u2),
    scope: {
      nets: [{ dbId: 11, name: "LOCAL" }],
      parts: [
        { occurrenceId: occurrenceId * 10, dbId: 275, reference: u1, pins: [] },
        { occurrenceId: occurrenceId * 10 + 1, dbId: 276, reference: u2, pins: [] },
      ],
      blocks: [],
    },
  });
  const tree: HierarchyStream = {
    ...root,
    scope: {
      ...root.scope,
      blocks: [occurrence(3, 17, "U11", "U12"), occurrence(4, 39, "U21", "U22")],
    },
  };
  const expanded = expandHierarchy(
    [tree],
    new Map([
      ["top", [top]],
      ["child", [drawing]],
    ]),
    strLst
  );
  const { nets } = buildNetConnectivity(
    expanded.pages,
    expanded.canonicalNetNames,
    pmd,
    new Map(),
    strLst
  );

  it("gives each placement its own pin-to-pin net, named from the file's id", () => {
    expect(nets.N5000_MV1).toEqual({ U11: ["1"], U12: ["1"] });
    expect(nets.N5000_MV2).toEqual({ U21: ["1"], U22: ["1"] });
  });

  it("puts a hidden pin on the net a wire with its net id carries", () => {
    expect(nets.LOCAL_MV1).toEqual({ U11: ["2"], U12: ["2"] });
    expect(nets.LOCAL_MV2).toEqual({ U21: ["2"], U22: ["2"] });
  });
});

describe("connectors join the wire their trailer names", () => {
  // strLst 6 is VCC. D1.1 ends the LED wire at (100,0). R5.1 sits on a VCC
  // Global whose box also covers that wire end but whose trailer names no wire,
  // as on SmartGarden's CC1310LAUNCHPAD R32. A second VCC Global names the far
  // rail wire although its box is nowhere near it.
  const sheet = page({
    name: "PAGE1",
    netTable: new Map([
      [61, ["LED_NET"]],
      [62, ["RAIL"]],
    ]),
    wires: [wire(61, 51, 0, 0, 100, 0), wire(62, 52, 0, 500, 100, 500)],
    placedInstances: [
      part(1, "D1", [pin(1, 100, 0, 51)]),
      part(2, "R5", [pin(1, 105, 5, SENTINEL)]),
      part(3, "R6", [pin(1, 0, 500, 52)]),
    ],
    globals: [symbol(6, 901, 105, 5), symbol(6, 902, 900, 900, 52)],
  });
  const { nets } = buildNetConnectivity([sheet], new Set(), pmd, new Map(), strLst);

  it("keeps a connector whose trailer names no wire off the wire its box covers", () => {
    expect(nets.LED_NET).toEqual({ D1: ["1"] });
  });

  it("joins a connector to its trailer's wire wherever its box lies", () => {
    // R5 reaches the rail through the two VCC Globals; the rail keeps its wire name.
    expect(nets.RAIL).toEqual({ R5: ["1"], R6: ["1"] });
  });
});

describe("buildNetConnectivity over PACK_SHORT pins", () => {
  // Q1's package marks S2 and S3 Pin Ignore; PACK_SHORT (S1,S2,S3) ties them
  // to S1, which is wired to R1. Q2 has the same flags and no PACK_SHORT.
  const ignoring: PinMapData = {
    ...pmd,
    pinMaps: new Map([["X", ["1", "2", "3"]]]),
    pinIgnores: new Map([["X", [false, true, true]]]),
  };
  const shorted = page({
    name: "PAGE1",
    wires: [wire(10, 1, 0, 0, 50, 0)],
    placedInstances: [
      part(1, "R1", [pin(1, 0, 0, 1)]),
      {
        ...part(2, "Q1", [pin(1, 50, 0, 1), pin(2, 60, 0, 0), pin(3, 70, 0, 0)]),
        packShort: [[1, 2, 3]],
      },
      part(3, "Q2", [pin(1, 200, 0, 0), pin(2, 210, 0, 0), pin(3, 220, 0, 0)]),
    ],
  });
  const { nets } = buildNetConnectivity([shorted], new Set(), ignoring, new Map(), []);
  const netOf = (ref: string, p: string) =>
    Object.keys(nets).find((n) => nets[n][ref]?.includes(p));

  it("puts an ignored pin that PACK_SHORT names on its group's placed pin's net", () => {
    expect(netOf("Q1", "2")).toBe(netOf("R1", "1"));
    expect(netOf("Q1", "3")).toBe(netOf("R1", "1"));
  });

  it("still leaves out an ignored pin that no PACK_SHORT names", () => {
    expect(netOf("Q2", "2")).toBeUndefined();
    expect(netOf("Q2", "3")).toBeUndefined();
  });
});
/**
 * A port net can span several pages of a block while the port symbol is drawn
 * on only one of them. The other pages name the same net in their net tables,
 * and that name is what connects them to the port: the port's own name, or any
 * other name its net carries. Reported in #274 by @freerly2026.
 */
describe.each([
  ["the port's own name", "SIG_IN"],
  ["another name of the port's net", "SIG_LOCAL"],
])("a port net named on a page that does not draw the port symbol, by %s", (_, net) => {
  const portTop = page({
    name: "PORT_TOP",
    wires: [wire(801, 776, 100, 100, 450, 360)],
    placedInstances: [part(11, "R1", [pin(1, 100, 100, 801)])],
    drawnInstances: [block(71, "MV1", ["SIG_IN"], [pin(1, 450, 360, 801)])],
  });
  const portPage = page({
    name: "PORT_PAGE",
    netTable: new Map([[5001, [net]]]),
    wires: [wire(5001, 5000, 10, 10, 50, 10)],
    placedInstances: [part(281, "C1", [pin(1, 50, 10, 5001)])],
    ports: [symbol(5, 910, 10, 10, 5000)],
  });
  const powerPage = page({
    name: "POWER_PAGE",
    netTable: new Map([[5002, [net]]]),
    wires: [wire(5002, 5000, 10, 10, 50, 10)],
    placedInstances: [part(282, "C2", [pin(1, 50, 10, 5002)])],
  });
  const portRoot: HierarchyStream = {
    schematic: "porttop",
    scope: {
      nets: [{ dbId: 1, name: "N00776" }],
      parts: [{ occurrenceId: 1, dbId: 11, reference: "R1", pins: [] }],
      blocks: [
        {
          occurrenceId: 71,
          dbId: 71,
          schematic: "portchild",
          reference: "",
          scope: {
            nets: [{ dbId: 10, name: "SIG_IN" }],
            parts: [
              { occurrenceId: 710, dbId: 281, reference: "C6", pins: [] },
              { occurrenceId: 711, dbId: 282, reference: "C106", pins: [] },
            ],
            blocks: [],
          },
        },
      ],
    },
  };
  const expanded = expandHierarchy(
    [portRoot],
    new Map([
      ["porttop", [portTop]],
      ["portchild", [portPage, powerPage]],
    ]),
    strLst
  );
  const { nets } = buildNetConnectivity(
    expanded.pages,
    expanded.canonicalNetNames,
    pmd,
    new Map(),
    strLst
  );

  it("joins the named net on every page of the placement to the parent", () => {
    expect(nets.N00776).toEqual({ R1: ["1"], C6: ["1"], C106: ["1"] });
  });

  it("leaves no suffixed copy of the port net", () => {
    expect(Object.keys(nets).filter((n) => n.startsWith(net))).toEqual([]);
  });
});
