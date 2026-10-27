import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { listComponents } from "./list-components.js";
import {
  searchComponentsByRefdes,
  searchComponentsByMpn,
  searchComponentsByDescription,
} from "./search-components.js";
import { queryXnetByNetName, queryXnetByPinName } from "./query-xnet.js";
import { MPN_MISSING_NOTE } from "../component-grouping.js";
import type { ParsedNetlist } from "../../types.js";
import * as parsersModule from "../../parsers/index.js";

/**
 * Every component tool states the missing-MPN note once per result, with the
 * refdes it applies to, and never on a group (issue #249).
 */
describe("component tools - one note per result", () => {
  const DESIGN = "/mock/component-notes.dsn";
  const netlist: ParsedNetlist = {
    nets: {
      SIG: { R1: ["1"], R2: ["1"], R10: ["1"], C1: ["1"] },
      GND: { R1: ["2"], R2: ["2"], R10: ["2"], C1: ["2"] },
    },
    components: {
      R1: { mpn: "RC0402", description: "Resistor", pins: { "1": "SIG", "2": "GND" } },
      R2: { internal_pn: "INT-7", description: "Resistor 1k", pins: { "1": "SIG", "2": "GND" } },
      R10: { description: "Resistor 10k", pins: { "1": "SIG", "2": "GND" } },
      C1: { mpn: "  ", description: "Capacitor", pins: { "1": "SIG", "2": "GND" } },
    },
  };

  beforeEach(() => {
    vi.spyOn(parsersModule, "findHandler").mockReturnValue({
      name: "mock",
      extensions: [".dsn"],
      canHandle: () => true,
      discoverDesigns: vi.fn(),
      parse: vi.fn(),
    });
    vi.spyOn(parsersModule, "parseDesign").mockResolvedValue(netlist);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const cases: Array<[string, () => Promise<unknown>, string[]]> = [
    ["list_components", () => listComponents(DESIGN, "R"), ["R2", "R10"]],
    [
      "search_components_by_refdes",
      () => searchComponentsByRefdes("^[RC]\\d$", DESIGN),
      ["C1", "R2"],
    ],
    ["search_components_by_mpn", () => searchComponentsByMpn("INT", DESIGN), ["R2"]],
    [
      "search_components_by_description",
      () => searchComponentsByDescription("^Res", DESIGN),
      ["R2", "R10"],
    ],
    ["query_xnet_by_net_name", () => queryXnetByNetName(DESIGN, "SIG"), ["C1", "R2", "R10"]],
    ["query_xnet_by_pin_name", () => queryXnetByPinName(DESIGN, "R1.1"), ["C1", "R2", "R10"]],
  ];

  for (const [tool, run, refdes] of cases) {
    it(`${tool} names the parts without an MPN once`, async () => {
      const result = await run();
      const text = JSON.stringify(result);

      expect(result).toMatchObject({ component_notes: [{ note: MPN_MISSING_NOTE, refdes }] });
      expect(text.split(MPN_MISSING_NOTE)).toHaveLength(2);
      expect(text).not.toContain('"notes"');
    });
  }

  it("leaves component_notes out when every listed part has an MPN", async () => {
    const result = await searchComponentsByMpn("RC0402", DESIGN);
    expect(result).not.toHaveProperty("component_notes");
  });

  it("leaves component_notes out of an empty result", async () => {
    const result = await searchComponentsByRefdes("^U", DESIGN);
    expect(result).toMatchObject({ notes: ["No components matched refdes pattern '^U'"] });
    expect(result).not.toHaveProperty("component_notes");
  });
});
