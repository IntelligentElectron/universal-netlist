/**
 * Replays the golden ground-net table in docs/decision-tables/ground-nets
 * against queryXnetByNetName, one test per cell.
 */
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cellName, readTable } from "../../../test/helpers/decision-table.js";
import * as parsersModule from "../../parsers/index.js";
import type { AggregatedCircuitResult, ComponentDetails, NetConnections } from "../../types.js";

const TABLES = path.resolve(__dirname, "../../../docs/decision-tables/ground-nets");
const NAMES: Record<string, string> = {
  ground: "GND1",
  separated_ground: "GND_SW",
  power: "VCC_3V3",
  signal: "SIG",
};

/** START -R1- net -R2- BEYOND, with the cell's pin and size on the net. */
const netlistFor = (row: Record<string, string>) => {
  const net = NAMES[row.name];
  const nets: NetConnections = {
    START: { R1: ["1"], U0: ["1"] },
    [net]: { R1: ["2"], R2: ["1"] },
    BEYOND: { R2: ["2"], U9: ["1"] },
  };
  const components: ComponentDetails = {
    U0: { pins: { "1": "START" } },
    R1: { pins: { "1": "START", "2": net } },
    R2: { pins: { "1": net, "2": "BEYOND" } },
    U9: { pins: { "1": "BEYOND" } },
  };
  if (row.pin !== "none") {
    nets[net].U1 = ["1"];
    components.U1 = { pins: { "1": { name: row.pin === "ground_pin" ? "GND" : "VDD", net } } };
  }
  if (row.size === "over_40") {
    for (let i = 0; i < 41; i++) {
      nets[net][`U${100 + i}`] = ["1"];
      components[`U${100 + i}`] = { pins: { "1": net } };
    }
  }
  return { net, nets, components };
};

describe("golden table: ground-nets classify", () => {
  let queryXnetByNetName: typeof import("../index.js").queryXnetByNetName;

  beforeAll(async () => {
    vi.spyOn(parsersModule, "findHandler").mockReturnValue({
      name: "mock",
      extensions: [".dsn"],
      canHandle: () => true,
      discoverDesigns: vi.fn(),
      parse: vi.fn(),
    });
    ({ queryXnetByNetName } = await import("../index.js"));
  });
  afterAll(() => vi.restoreAllMocks());

  const dims = ["role", "name", "pin", "size"];
  for (const row of readTable(TABLES, "classify")) {
    it(cellName(row, dims), async () => {
      const { net, nets, components } = netlistFor(row);
      vi.spyOn(parsersModule, "parseDesign").mockResolvedValue({ nets, components });
      const design = `/mock/${cellName(row, dims).replace(/\W+/g, "_")}.dsn`;
      const result = await queryXnetByNetName(design, row.role === "start" ? net : "START");

      if (row.outcome === "refused as a ground") {
        expect((result as { error: string }).error).toContain("is a ground net");
        return;
      }
      const trace = result as AggregatedCircuitResult;
      expect(trace.visited_nets).toContain(net);
      const crossed = trace.visited_nets.includes("BEYOND");
      const noted = (trace.notes ?? []).some((n) => n.includes("is named like a ground"));
      if (row.outcome === "trace stops here") expect(crossed).toBe(false);
      else expect(crossed).toBe(true);
      expect(noted).toBe(row.outcome === "traced, with a ground-name note");
    });
  }
});
