import { describe, expect, it } from "vitest";
import { resolvePinKeys } from "./pin-resolver.js";
import { assembleNets } from "./net-assembly.js";
import { buildPageCoordMap } from "./page-groups.js";
import { mergeRepeatedSections, separateDuplicateRefdes } from "./duplicate-refdes.js";
import type { ComponentDetails, NetConnections } from "../../../types.js";
import { buildNetConnectivity } from "./net-builder.js";
import { toUniversalNetlistDocument, validateUniversalNetlist } from "../../universal/reader.js";
import type { PlacedInstance, Wire, T0x10 } from "./structures.js";
import type { PageData } from "./page-parser.js";
import type { PinMapData } from "./structure-types.js";

import { readTable } from "../../../../test/helpers/decision-table.js";
import path from "node:path";
const cells = (name: string) =>
  readTable(path.resolve(__dirname, "../../../../docs/decision-tables/dsn-bus-topology"), name);
const pin = (index = 1, kind?: "scalar" | "bus"): T0x10 => ({
  kind,
  pinIndex: index,
  pointX: 0,
  pointY: 0,
  netId: 0xffffffff,
  symbolDisplayProps: [],
});
const part = (pins: T0x10[]): PlacedInstance => ({
  pkgName: "X.Normal",
  sourcePackage: "X",
  dbId: 100,
  reference: "U1",
  partValueIdx: 0,
  prefixProperties: [],
  locX: 0,
  locY: 0,
  symbolDisplayProps: [],
  sectionIndex: 0,
  t0x10s: pins,
});
const wire = (id: number, x: number, kind?: "scalar" | "bus"): Wire => ({
  kind,
  id,
  segmentId: id,
  startX: x,
  startY: 0,
  endX: x,
  endY: 10,
  aliases: [],
});
const page = (data: Partial<PageData>): PageData => ({
  name: "Synthetic",
  netTable: new Map(),
  wires: [],
  placedInstances: [],
  drawnInstances: [],
  ports: [],
  globals: [],
  offPageConnectors: [],
  ...data,
});
const pmd = (labels: (string | null)[] = ["1"]): PinMapData => ({
  pinMaps: new Map([["X", labels]]),
  pinIgnores: new Map(),
  cachePinIgnores: new Map(),
  cachePinMaps: new Map(),
  deviceUnitRefs: new Map(),
});

describe("DSN topology decision tables", () => {
  for (const c of cells("pin-identity"))
    it(`identity ${c.kind}/${c.label}/${c.ignored}`, () => {
      const pins = [pin(1, c.kind as "scalar" | "bus"), pin(2)];
      const labels =
        c.label === "unique"
          ? ["7", "8"]
          : c.label === "duplicate"
            ? ["7", "7"]
            : c.label === "reserved"
              ? ["@100:2", ""]
              : c.label === "blank"
                ? ["", "8"]
                : [null, "8"];
      const maps = pmd(labels);
      maps.pinIgnores.set("X", [c.ignored === "yes", false]);
      const key = resolvePinKeys(part(pins), maps).get(1);
      expect(key).toBe(
        c.outcome === "omit" ? undefined : c.outcome === "physical" ? "7" : "@100:1"
      );
      if (c.label === "reserved" && c.ignored === "no")
        expect(new Set(resolvePinKeys(part(pins), maps).values()).size).toBe(2);
    });

  for (const c of cells("typed-connectivity"))
    it(`connectivity ${c.pin}/${c.wire}`, () => {
      const kind = (v: string) => (v === "legacy" ? undefined : (v as "scalar" | "bus"));
      const result = buildNetConnectivity(
        [
          page({
            placedInstances: [part([pin(1, kind(c.pin))])],
            wires: [wire(5, 0, kind(c.wire))],
          }),
        ],
        new Set(),
        pmd(),
        new Map(),
        []
      );
      const net = (c.pin === "bus" ? result.busComponentPins : result.componentPins)
        .get("U1")
        ?.get(c.pin === "bus" ? "@100:1" : "1");
      expect(net).toBe(c.outcome === "connected" ? "N00005" : "NC");
    });

  for (const c of cells("entry-orientation"))
    it(`entry ${c.start}/${c.end}`, () => {
      const wires: Wire[] = [];
      [c.start, c.end].forEach((state, i) => {
        if (state === "scalar" || state === "both") wires.push(wire(1 + i, i * 20, "scalar"));
        if (state === "bus" || state === "both") wires.push(wire(11 + i, i * 20, "bus"));
      });
      const result = buildNetConnectivity(
        [page({ wires, busEntries: [{ startX: 0, startY: 0, endX: 20, endY: 0 }] })],
        new Set(),
        pmd(),
        new Map(),
        []
      );
      const entry = result.busEntries[0];
      expect(entry).toMatchObject({ start: [0, 0], end: [20, 0] });
      expect(entry.net).toBe(
        c.outcome === "unresolved" ? undefined : c.outcome === "forward" ? "N00001" : "N00002"
      );
      expect(entry.bus).toBe(
        c.outcome === "unresolved" ? undefined : c.outcome === "forward" ? "N00012" : "N00011"
      );
      expect(Object.keys(result.nets)).not.toContain(entry.bus);
    });

  for (const c of cells("schema-topology"))
    it(`schema ${c.version}/${c.topology}`, () => {
      const document = toUniversalNetlistDocument({
        nets: {},
        components: {},
        ...(c.topology === "present" ? { buses: { BUS: {} } } : {}),
      });
      document.universalNetlistSchemaVersion = Number(c.version);
      if (c.outcome === "reject") expect(() => validateUniversalNetlist(document)).toThrow();
      else
        expect(validateUniversalNetlist(document).buses).toEqual(
          c.topology === "present" ? { BUS: {} } : undefined
        );
    });
});

it("retains native membership even when no bus wire is drawn", () => {
  const result = buildNetConnectivity(
    [page({ netTable: new Map([[10, ["DATA"]]]), busMembers: new Map([[10, [1, 2]]]) })],
    new Set(),
    pmd(),
    new Map(),
    []
  );
  expect(result.buses).toEqual({ DATA: {} });
  expect(result.busMembers).toEqual([
    { page: "Synthetic", bus: "DATA", netId: 1 },
    { page: "Synthetic", bus: "DATA", netId: 2 },
  ]);
});

it("does not short crossing conductors to resolve an ambiguous entry", () => {
  const wires: Wire[] = [
    { ...wire(1, 0, "scalar"), startY: 10, endX: 20, endY: 10 },
    { ...wire(2, 10, "scalar"), endY: 20 },
    wire(11, 30, "bus"),
  ];
  const parts = [
    part([{ ...pin(), pointX: 0, pointY: 10 }]),
    { ...part([{ ...pin(), pointX: 10, pointY: 0 }]), reference: "U2", dbId: 200 },
  ];
  const result = buildNetConnectivity(
    [
      page({
        wires,
        placedInstances: parts,
        busEntries: [{ startX: 10, startY: 10, endX: 30, endY: 0 }],
      }),
    ],
    new Set(),
    pmd(),
    new Map(),
    []
  );
  expect(result.nets.N00001).toEqual({ U1: ["1"] });
  expect(result.nets.N00002).toEqual({ U2: ["1"] });
  expect(result.busEntries[0].net).toBeUndefined();
});

describe("terminal and entry preservation tables", () => {
  for (const c of cells("terminal-preservation"))
    it(`terminal ${c.id}/${c.geometry}/${c.count}`, () => {
      const result = assembleNets(
        Array.from({ length: c.count === "one" ? 1 : 2 }, (_, i) => ({
          refdes: `U${i + 1}`,
          pinNumber: "1",
          netId: { zero: 0, sentinel: 0xffffffff, normal: 10 }[c.id]!,
          pageIdx: 0,
          coord: "0,0",
          ...(c.geometry === "wire" ? { coordNet: "SIGNAL" } : {}),
        })),
        new Set()
      );
      const expected = { NC: "NC", wire: "SIGNAL", native: "N10", overlap: "N0_0,0" }[c.outcome];
      expect(result.componentPins.get("U1")?.get("1")).toBe(expected);
      if (c.count === "two") expect(result.componentPins.get("U2")?.get("1")).toBe(expected);
    });
  for (const c of cells("entry-contact"))
    it(`entry contacts ${c.kind}/${c.contacts}`, () => {
      const kind = c.kind as "scalar" | "bus";
      const wires: Wire[] =
        c.contacts === "none" ? [] : [{ ...wire(1, 0, kind), startY: 10, endX: 20, endY: 10 }];
      if (c.contacts === "linked" || c.contacts === "crossing")
        wires.push({ ...wire(c.contacts === "linked" ? 1 : 2, 10, kind), endY: 20 });
      const map = buildPageCoordMap(
        page({ wires, busEntries: [{ startX: 10, startY: 10, endX: 30, endY: 30 }] }),
        new Set(),
        new Map(),
        kind === "bus"
      );
      const resolved = map.coordToNet.has("10,10") && !map.ambiguousEntryPoints?.has("10,10");
      expect(resolved).toBe(c.outcome === "resolved");
      if (c.contacts === "crossing")
        expect(map.coordToNet.get("0,10")).not.toBe(map.coordToNet.get("10,0"));
    });
  for (const c of cells("repeated-section"))
    it(`repeated ${c.kind}/${c.wiring}`, () => {
      const pages = [
        page({ name: "A", placedInstances: [part([])] }),
        page({ name: "B", placedInstances: [part([])] }),
      ];
      const result = separateDuplicateRefdes(pages, []);
      const field = c.kind === "bus" ? "busPins" : "pins";
      const components: ComponentDetails = {
        "U1~1": { pins: {}, [field]: { "1": "A" } },
        "U1~2": {
          pins: {},
          [field]: { "1": c.wiring === "agree" ? "A" : c.wiring === "conflict" ? "B" : "NC" },
        },
      };
      const graph: NetConnections = { A: { "U1~1": ["1"] } };
      const second = c.wiring === "agree" ? "A" : c.wiring === "conflict" ? "B" : "NC";
      (graph[second] ??= {})["U1~2"] = ["1"];
      mergeRepeatedSections(
        result,
        c.kind === "bus" ? {} : graph,
        components,
        new Map(),
        c.kind === "bus" ? graph : {}
      );
      expect(Object.keys(components)).toHaveLength(c.outcome === "merge" ? 1 : 2);
      if (c.outcome === "merge") {
        expect(components.U1[field]).toEqual({ "1": "A" });
        expect(graph.A).toEqual({ U1: ["1"] });
        expect(graph.NC).toBeUndefined();
      }
    });
});
