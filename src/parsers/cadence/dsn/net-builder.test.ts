import { describe, expect, it } from "vitest";
import { buildNetConnectivity } from "./net-builder.js";
import type { PageData } from "./page-parser.js";
import type { PinMapData } from "./structure-types.js";
import type { PlacedInstance, Wire } from "./structures.js";

interface Connection {
  netName: string;
  netId: number;
  refdes: string;
  x: number;
}

const emptyPinMapData: PinMapData = {
  pinMaps: new Map(),
  cachePinMaps: new Map(),
  deviceUnitRefs: new Map(),
};

function makePage(name: string, connections: Connection[]): PageData {
  const netTable = new Map<number, string[]>();
  const wires: Wire[] = [];
  const placedInstances: PlacedInstance[] = [];

  connections.forEach((connection, index) => {
    const wireId = index + 1;
    netTable.set(wireId, [connection.netName]);
    wires.push({
      segmentId: wireId,
      id: wireId,
      startX: connection.x,
      startY: 0,
      endX: connection.x + 10,
      endY: 0,
      aliases: [],
    });
    placedInstances.push({
      pkgName: "GENERIC.Normal",
      dbId: connection.netId,
      reference: connection.refdes,
      sourcePackage: "GENERIC",
      partValueIdx: 0,
      prefixProperties: [],
      locX: connection.x,
      locY: 0,
      symbolDisplayProps: [],
      t0x10s: [
        {
          pinIndex: 1,
          pointX: connection.x,
          pointY: 0,
          netId: connection.netId,
          symbolDisplayProps: [],
        },
      ],
    });
  });

  return {
    name,
    netTable,
    wires,
    placedInstances,
    ports: [],
    globals: [],
    offPageConnectors: [],
  };
}

function build(pages: PageData[], canonicalNetNames: string[]) {
  return buildNetConnectivity(pages, new Set(canonicalNetNames), emptyPinMapData, new Map(), [])
    .nets;
}

describe("cross-page net disambiguation", () => {
  it("keeps a partially numeric sibling net separate", () => {
    const nets = build(
      [
        makePage("PAGE_A", [
          { netName: "SIGNAL", netId: 100, refdes: "R1", x: 0 },
          { netName: "SIGNAL_1V8", netId: 300, refdes: "U1", x: 100 },
        ]),
        makePage("PAGE_B", [{ netName: "SIGNAL", netId: 200, refdes: "R2", x: 0 }]),
      ],
      ["SIGNAL", "SIGNAL_1V8"]
    );

    expect(nets.SIGNAL).toEqual({ R1: ["1"], R2: ["1"] });
    expect(nets.SIGNAL_1V8).toEqual({ U1: ["1"] });
  });

  it("continues to recognize an entirely numeric hierarchy suffix", () => {
    const nets = build(
      [
        makePage("PAGE_A", [{ netName: "SIGNAL", netId: 100, refdes: "R1", x: 0 }]),
        makePage("PAGE_B", [{ netName: "SIGNAL", netId: 200, refdes: "R2", x: 0 }]),
      ],
      ["SIGNAL", "SIGNAL_150"]
    );

    expect(nets.SIGNAL).toEqual({ R1: ["1"] });
    expect(nets.SIGNAL_150).toEqual({ R2: ["1"] });
  });
});
