import { describe, expect, it } from "vitest";
import { createNetlistService } from "./index.js";
import { serializeUniversalNetlist } from "../parsers/universal/reader.js";
import type { ParsedNetlist } from "../types.js";

const netlist: ParsedNetlist = {
  nets: { LANE_A: { J1: ["1"] }, LANE_B: { J1: ["2"] } },
  components: {
    J1: { pins: { "1": "LANE_A", "2": "LANE_B" } },
    U1: {
      pins: {},
      busPins: {
        "@100:1": { name: "ETH1", net: "BUS_A" },
        "@100:2": { name: "ETH2", net: "BUS_B" },
      },
      pinIdentities: {
        "@100:1": { instanceId: 100, index: 1, number: "OUT4" },
        "@100:2": { instanceId: 100, index: 2, number: "OUT4" },
      },
    },
  },
  buses: { BUS_A: { U1: ["@100:1"] }, BUS_B: { U1: ["@100:2"] } },
  busEntries: [
    { page: "PAGE", start: [0, 0], end: [10, 10], bus: "BUS_A", net: "LANE_A" },
    { page: "PAGE", start: [0, 20], end: [10, 30] },
  ],
  busMembers: [{ page: "PAGE", bus: "BUS_A", netId: 1, net: "LANE_A" }],
};
const design = "/memory/synthetic.netlist.json";
const bytes = new TextEncoder().encode(serializeUniversalNetlist(netlist));
const service = createNetlistService({
  files: { readFile: async () => bytes, exists: async (p) => p === design },
});

describe("query topology after schema 4 reload", () => {
  it("returns separate bus terminals, source labels, entry geometry, and native members", async () => {
    const result = await service.queryComponent({ design, refdes: "U1" });
    expect(result).toMatchObject({
      busPins: netlist.components.U1.busPins,
      pinIdentities: netlist.components.U1.pinIdentities,
      buses: {
        BUS_A: {
          terminals: { U1: ["@100:1"] },
          entries: [netlist.busEntries![0]],
          members: netlist.busMembers,
        },
        BUS_B: { terminals: { U1: ["@100:2"] }, entries: [], members: [] },
      },
    });
  });
  it("rejects bus traversal by terminal and by net while preserving scalar lane isolation", async () => {
    expect(await service.queryXnetByPinName({ design, pin_name: "U1.@100:1" })).toHaveProperty(
      "error",
      expect.stringContaining("bus terminal")
    );
    expect(await service.queryXnetByNetName({ design, net_name: "BUS_A" })).toHaveProperty(
      "error",
      expect.stringContaining("bus")
    );
    expect(await service.queryXnetByPinName({ design, pin_name: "J1.1" })).toMatchObject({
      visited_nets: ["LANE_A"],
    });
  });
  it("reports unresolved-entry and scalar-analysis limits", async () => {
    const result = await service.runErc({ design });
    expect(result).toHaveProperty(
      "notes",
      expect.arrayContaining([
        expect.stringContaining("do not infer"),
        expect.stringContaining("1 bus entries"),
      ])
    );
  });
});
