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
