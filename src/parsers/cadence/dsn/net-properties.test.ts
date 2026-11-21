import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { callTool } from "../../../tools/index.js";
import { parseDsnFile } from "../index.js";
import { resolveNetProperties } from "./dsn-parser.js";

const META_CARRIER = join(
  import.meta.dirname,
  "../../../../test/fixtures/cadence/parallella-meta-carrier/meta_carrier_sch_rev1.dsn"
);

describe("resolveNetProperties", () => {
  const strings = ["", "DIFFERENTIAL_PAIR", "USB", "VOLTAGE", "3.3", "Color"];
  const nets = { USB_DP: {}, "3V3": {} };

  it("keeps each property under the netlist net, matching the name without case", () => {
    expect(
      resolveNetProperties(
        [
          { net: "USB_DP", name: 1, value: 2 },
          { net: "3V3", name: 3, value: 4 },
        ],
        nets,
        strings
      )
    ).toEqual({ USB_DP: { DIFFERENTIAL_PAIR: "USB" }, "3V3": { VOLTAGE: "3.3" } });
  });

  it("leaves out an empty value, a drawing property, and a net the netlist does not have", () => {
    expect(
      resolveNetProperties(
        [
          { net: "USB_DP", name: 1, value: 0 },
          { net: "USB_DP", name: 5, value: 4 },
          { net: "USB_DP_U1", name: 1, value: 2 },
        ],
        nets,
        strings
      )
    ).toEqual({});
  });
});

describe("net properties of a Capture design", () => {
  it("reads every differential pair, two nets each, including nets inside blocks", () => {
    const properties = parseDsnFile(META_CARRIER).netProperties ?? {};
    expect(Object.keys(properties)).toHaveLength(116);
    const pairs = new Map<string, string[]>();
    for (const [net, p] of Object.entries(properties)) {
      pairs.set(p.DIFFERENTIAL_PAIR, [...(pairs.get(p.DIFFERENTIAL_PAIR) ?? []), net]);
    }
    expect([...pairs.values()].every((nets) => nets.length === 2)).toBe(true);
    // OSC_IN inside block CLOCK0 is the netlist's OSC_IN_CLOCK0.
    expect(properties.OSC_IN_CLOCK0).toEqual({ DIFFERENTIAL_PAIR: "OSC_IN_CLOCK" });
  }, 60_000);

  it("is returned by search_nets and query_xnet_by_net_name", async () => {
    const search = (await callTool("search_nets", {
      design: META_CARRIER,
      pattern: "^EA_LCLK_OUT_.1$",
    })) as { net_properties?: Record<string, Record<string, string>> };
    expect(search.net_properties).toEqual({
      EA_LCLK_OUT_N1: { DIFFERENTIAL_PAIR: "EA LCLK OUT1" },
      EA_LCLK_OUT_P1: { DIFFERENTIAL_PAIR: "EA LCLK OUT1" },
    });
    const xnet = (await callTool("query_xnet_by_net_name", {
      design: META_CARRIER,
      net_name: "OSC_IN_CLOCK0",
    })) as { net_properties?: Record<string, Record<string, string>> };
    expect(xnet.net_properties?.OSC_IN_CLOCK0).toEqual({ DIFFERENTIAL_PAIR: "OSC_IN_CLOCK" });
  }, 60_000);
});
