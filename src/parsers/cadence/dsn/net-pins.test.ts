import { describe, expect, it } from "vitest";
import { bindThroughPorts, pinToPinNames, type PinInfo } from "./net-pins.js";
import type { PageCoordMap, WireGroup } from "./page-groups.js";
import type { PageData } from "./page-parser.js";
import type { Placement } from "./hierarchy-expander.js";

const SPAN = 2 ** 32;

const placement = (netIdOffset: number, ports: Placement["ports"]): Placement => ({
  path: [],
  suffix: "",
  netIdOffset,
  ports,
  canonicalNetNames: new Set(),
});

const coordMap = (groups: [string, WireGroup][], byBase: [string, WireGroup][]): PageCoordMap => ({
  coordToNet: new Map(groups.map(([k, g]) => [k, g.name])),
  groups: new Map(groups),
  byBase: new Map(byBase),
  busMemberOf: () => undefined,
  pinsOnSymbol: new Map(),
});

describe("bindThroughPorts", () => {
  it("keeps a block pin's wire id in the parent's range when the parent member has no wire", () => {
    // Parent: itself placement 1, its block pin on the bus X_D[1:0] (wire 590,
    // already shifted by the expander); X_D1 is named only by a connector.
    const bus: WireGroup = { name: "X_D[1:0]", base: "X_D[1:0]", rep: "150,50", netId: 590 };
    const member: WireGroup = { name: "X_D1", base: "X_D1", rep: "sym", netId: undefined };
    // Child: placement 2, its pin on the group that is member 1 of port D[1:0].
    const child: WireGroup = {
      name: "D1",
      base: "D1",
      rep: "10,40",
      netId: 691,
      port: { port: "D[1:0]", index: 1 },
    };
    const pages = [
      { placement: placement(SPAN, new Map()) },
      {
        placement: placement(
          2 * SPAN,
          new Map([["D[1:0]", { pageIdx: 0, coord: "150,50", netId: 590 + SPAN }]])
        ),
      },
    ] as unknown as PageData[];
    const maps = [
      coordMap([["150,50", bus]], [["X_D1", member]]),
      coordMap([["10,40", child]], []),
    ];
    const pin: PinInfo = {
      refdes: "C1",
      pinNumber: "1",
      netId: 691 + 2 * SPAN,
      pageIdx: 1,
      coord: "10,40",
    };

    const bound = bindThroughPorts(pin, pages, maps, new Map());

    expect(bound).toMatchObject({ pageIdx: 0, coordNet: "X_D1", netId: 590 + SPAN });
  });
});

describe("pinToPinNames", () => {
  const SENTINEL = 0xffffffff;
  const pin = (pinIndex: number, x: number, wireId = SENTINEL) => ({
    pinIndex,
    pointX: x,
    pointY: 0,
    wireId,
    netId: 7,
    symbolDisplayProps: [],
  });
  const part = (dbId: number, pins: ReturnType<typeof pin>[]) => ({ dbId, t0x10s: pins });
  const names = (parts: ReturnType<typeof part>[]) =>
    pinToPinNames({ placedInstances: parts } as unknown as PageData);

  it("names a node after the pin with the smallest part db_id: N, the id, then pin index − 1", () => {
    // ROHM D8/R14: R14 (db_id 355290) pin 1 meets D8 (355472) pin 2; the export says N3552900.
    expect(names([part(355472, [pin(2, 10)]), part(355290, [pin(1, 10)])]).get("10,0")).toBe(
      "N3552900"
    );
  });

  it("pads the db_id to five digits and breaks a tie on one part by pin index", () => {
    // HEARINGDEVICE R1 (db_id 1503) pin 2 meets J1: the export says N015031.
    expect(names([part(4263, [pin(1, 10)]), part(1503, [pin(2, 10)])]).get("10,0")).toBe("N015031");
    expect(names([part(9, [pin(5, 10), pin(3, 10)])]).get("10,0")).toBe("N000092");
  });

  it("names no point where fewer than two sentinel pins meet", () => {
    expect(names([part(1, [pin(1, 10), pin(2, 20, 0)]), part(2, [pin(1, 20, 55)])]).size).toBe(0);
  });
});
