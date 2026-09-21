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

const pin = (pinIndex: number, x: number, y: number, netId: number): T0x10 => ({
  pinIndex,
  pointX: x,
  pointY: y,
  netId,
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
});

/** A symbol whose box is 20 units around `(x, y)`; `pairingId` indexes strLst. */
const symbol = (pairingId: number, dbId: number, x: number, y: number): GraphicInst => ({
  name: "SYMBOL",
  dbId,
  locX: x,
  locY: y,
  x1: x - 10,
  y1: y - 10,
  x2: x + 10,
  y2: y + 10,
  pairingId,
  symbolDisplayProps: [],
});

const block = (dbId: number, reference: string, ports: string[], pins: T0x10[]): DrawnInstance => ({
  dbId,
  reference,
  ports,
  pins,
  locX: 0,
  locY: 0,
});

const page = (spec: Partial<PageData> & { name: string }): PageData => ({
  netTable: new Map(),
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
  ports: [symbol(5, 900, 10, 10)],
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
 * pin sits on the `RST` port symbol with no wire.
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
  ports: [symbol(5, 900, 10, 10)],
});

const inner = page({
  name: "PAGE1",
  wires: [wire(950, 940, 10, 10, 30, 10)],
  placedInstances: [part(3, "U1", [pin(1, 30, 10, 950), pin(2, 10, 30, SENTINEL)])],
  ports: [symbol(7, 910, 10, 10), symbol(8, 911, 10, 30)],
});

const outer = page({
  name: "PAGE1",
  wires: [wire(900, 890, 10, 10, 50, 10), wire(901, 891, 10, 30, 50, 30)],
  drawnInstances: [block(22, "TILE1", ["CLK", "RST"], [pin(1, 50, 10, 900), pin(2, 50, 30, 901)])],
  ports: [symbol(7, 920, 10, 10), symbol(8, 921, 10, 30)],
});

const busTop = page({
  name: "TOP",
  wires: [
    wire(500, 490, 10, 10, 60, 10),
    wire(501, 491, 10, 30, 60, 30),
    wire(600, 590, 100, 50, 150, 50),
    wire(601, 591, 100, 80, 150, 80),
    wire(800, 790, 180, 200, 200, 200),
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
    part(1, "R1", [pin(1, 10, 10, 500)]),
    part(2, "R3", [pin(1, 10, 30, 501)]),
    part(4, "R2", [pin(1, 180, 200, 800), pin(2, 180, 230, 801)]),
  ],
  drawnInstances: [
    block(17, "MV1", ["D[1:0]"], [pin(1, 150, 50, 600)]),
    block(39, "MV2", ["D[1:0]"], [pin(1, 150, 80, 601)]),
    block(41, "MV3", ["D[1:0]"], [pin(1, 100, 80, 601)]),
    block(43, "MV4", ["D[1:0]"], [pin(1, 300, 300, 0)]),
    block(11, "SNOW1", ["CLK", "RST"], [pin(1, 200, 200, 800), pin(2, 200, 230, 801)]),
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
