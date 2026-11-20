import { describe, expect, it } from "vitest";
import {
  calculateUniversalNetlistHash,
  serializeUniversalNetlist,
  toUniversalNetlistDocument,
  validateUniversalNetlist,
} from "./reader.js";
import type { ParsedNetlist } from "../../types.js";

const topology = (): ParsedNetlist => ({
  nets: { D0: { J1: ["1"] }, D1: { J1: ["2"] } },
  components: {
    J1: { pins: { "1": "D0", "2": "D1" } },
    U1: {
      pins: {},
      busPins: { "@10:1": "BUS_A", "@10:2": "BUS_B" },
      pinIdentities: {
        "@10:1": { instanceId: 10, index: 1, number: "OUT4" },
        "@10:2": { instanceId: 10, index: 2, number: "OUT4" },
      },
    },
  },
  buses: { BUS_A: { U1: ["@10:1"] }, BUS_B: { U1: ["@10:2"] } },
  busEntries: [
    { page: "PAGE", start: [0, 0], end: [10, 10], bus: "BUS_A", net: "D0" },
    { page: "PAGE", start: [0, 20], end: [10, 30] },
  ],
  busMembers: [
    { page: "PAGE", bus: "BUS_A", netId: 1, net: "D0" },
    { page: "PAGE", bus: "BUS_A", netId: 2 },
  ],
});

describe("schema 4 topology", () => {
  it("round trips all topology and source identity fields without merging duplicate physical labels", () => {
    const n = topology();
    expect(validateUniversalNetlist(JSON.parse(serializeUniversalNetlist(n)))).toEqual(n);
  });
  for (const field of ["buses", "busEntries", "busMembers"] as const)
    it(`hashes ${field}`, () => {
      const n = topology(),
        before = calculateUniversalNetlistHash(n);
      delete n[field];
      expect(calculateUniversalNetlistHash(n)).not.toBe(before);
    });
  it("detects valid-shaped topology tampering", () => {
    const document = toUniversalNetlistDocument(topology());
    document.busEntries![0].start[0] = 999;
    expect(() => validateUniversalNetlist(document)).toThrow("netlistHash");
  });
  const mutations: [string, (n: ParsedNetlist) => void][] = [
    [
      "missing inverse bus pin",
      (n) => {
        n.buses!.BUS_A.U1 = ["@10:2"];
      },
    ],
    [
      "missing inverse membership",
      (n) => {
        delete n.buses!.BUS_A.U1;
      },
    ],
    [
      "duplicate membership",
      (n) => {
        n.buses!.BUS_A.U1 = ["@10:1", "@10:1"];
      },
    ],
    [
      "conflicting scalar key",
      (n) => {
        n.components.U1.busPins!["1"] = "BUS_A";
        n.components.U1.pins["1"] = "";
      },
    ],
    [
      "unknown bus entry target",
      (n) => {
        n.busEntries![0].bus = "MISSING";
      },
    ],
    [
      "one-sided entry",
      (n) => {
        delete n.busEntries![0].net;
      },
    ],
    [
      "non-finite geometry",
      (n) => {
        n.busEntries![0].start[0] = Infinity;
      },
    ],
    [
      "unknown native scalar member",
      (n) => {
        n.busMembers![0].net = "MISSING";
      },
    ],
    [
      "invalid source identity",
      (n) => {
        n.components.U1.pinIdentities!["@10:1"].index = 2;
      },
    ],
    [
      "blank physical number",
      (n) => {
        n.components.U1.pinIdentities!["@10:1"].number = " ";
      },
    ],
  ];
  for (const [name, mutate] of mutations)
    it(`rejects ${name} even with a matching hash`, () => {
      const n = topology();
      mutate(n);
      expect(() => validateUniversalNetlist(toUniversalNetlistDocument(n))).toThrow();
    });
});
