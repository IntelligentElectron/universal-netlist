import { describe, it, expect, vi, afterEach } from "vitest";
import type { ParsedNetlist } from "../../types.js";
import * as parsersModule from "../../parsers/index.js";
import {
  queryComponent,
  queryXnetByNetName,
  queryXnetByPinName,
  searchComponentsByRefdes,
} from "../index.js";
import { DUPLICATE_REFDES_ERROR } from "../../duplicate-refdes.js";

const DESIGN = "/mock/design.dsn";

// Q7: an N-FET on the button page and a P-FET on the clock page.
const NETLIST: ParsedNetlist = {
  nets: {
    BUTTON_GATE: { "Q7~1": ["1"], R9: ["1"] },
    BUTTON_IN: { "Q7~1": ["3"], U1: ["1"] },
    RESET_L: { "Q7~2": ["2"], U1: ["2"] },
    WAKE_H: { "Q7~2": ["1"], U1: ["3"] },
    GND: { "Q7~1": ["2"], "Q7~2": ["3"], R9: ["2"] },
  },
  components: {
    "Q7~1": {
      mpn: "NFET-1",
      pins: { "1": "BUTTON_GATE", "2": "GND", "3": "BUTTON_IN" },
    },
    "Q7~2": {
      mpn: "PFET-1",
      pins: { "1": "WAKE_H", "2": "RESET_L", "3": "GND" },
    },
    R9: { mpn: "4.7K", pins: { "1": "BUTTON_GATE", "2": "GND" } },
    U1: {
      mpn: "MCU",
      pins: { "1": "BUTTON_IN", "2": "RESET_L", "3": "WAKE_H" },
    },
  },
  duplicateRefdes: {
    Q7: [
      { key: "Q7~1", pages: ["11_BUTTONS"] },
      { key: "Q7~2", pages: ["07_CLOCKS"] },
    ],
  },
};

const mock = (): void => {
  vi.spyOn(parsersModule, "findHandler").mockReturnValue({
    name: "mock",
    extensions: [".dsn"],
    canHandle: () => true,
    discoverDesigns: vi.fn(),
    parse: vi.fn(),
  });
  vi.spyOn(parsersModule, "parseDesign").mockResolvedValue(structuredClone(NETLIST));
};

afterEach(() => vi.restoreAllMocks());

describe("a refdes the schematic gives to two different parts", () => {
  it("query_component returns both parts, each with the error and its own pins", async () => {
    mock();
    const result = await queryComponent(DESIGN, "Q7");
    expect(result).toMatchObject({
      refdes: "Q7",
      components: [
        {
          refdes: "Q7",
          error: DUPLICATE_REFDES_ERROR,
          mpn: "NFET-1",
          pins: { "1": "BUTTON_GATE" },
        },
        {
          refdes: "Q7",
          error: DUPLICATE_REFDES_ERROR,
          mpn: "PFET-1",
          pins: { "1": "WAKE_H" },
        },
      ],
    });
    expect(result).not.toHaveProperty("error");
  });

  it("search_components_by_refdes reports each part as its own entry", async () => {
    mock();
    const result = await searchComponentsByRefdes("^Q7$", DESIGN, false);
    const groups = Object.values((result as { results: Record<string, unknown[]> }).results)[0];
    expect(groups).toEqual([
      expect.objectContaining({ refdes: ["Q7"], mpn: "NFET-1", error: DUPLICATE_REFDES_ERROR }),
      expect.objectContaining({
        refdes: ["Q7"],
        mpn: "PFET-1",
        error: DUPLICATE_REFDES_ERROR,
      }),
    ]);
  });

  it("a trace shows only the part it reaches", async () => {
    mock();
    const result = await queryXnetByNetName(DESIGN, "BUTTON_GATE");
    const q = JSON.stringify(result);
    expect(q).toContain("NFET-1");
    expect(q).not.toContain("PFET-1");
    expect(q).not.toContain("~");
  });

  it("a pin on the refdes is ambiguous and names both parts' nets", async () => {
    mock();
    const result = await queryXnetByPinName(DESIGN, "Q7.2");
    expect((result as { error: string }).error).toContain("NFET-1 (pin 2 on GND)");
    expect((result as { error: string }).error).toContain("PFET-1 (pin 2 on RESET_L)");
  });

  it("query_component returns one record for a part that draws a section twice", async () => {
    vi.spyOn(parsersModule, "findHandler").mockReturnValue({
      name: "mock",
      extensions: [".dsn"],
      canHandle: () => true,
      discoverDesigns: vi.fn(),
      parse: vi.fn(),
    });
    vi.spyOn(parsersModule, "parseDesign").mockResolvedValue({
      nets: { DSI: { U13: ["A10"] } },
      components: { U13: { mpn: "SOC-1", pins: { A10: "DSI" } } },
      repeatedSections: { U13: [{ section: "F", pages: ["15_POWER", "18_DISPLAY"] }] },
    });

    const result = await queryComponent(DESIGN, "U13");

    expect(result).toMatchObject({
      refdes: "U13",
      error: "Section F is placed twice (pages 15_POWER, 18_DISPLAY)",
      pins: { A10: "DSI" },
    });
    expect(result).not.toHaveProperty("components");
  });

  it("query_component names the repeated section of one part of a duplicated refdes", async () => {
    vi.spyOn(parsersModule, "findHandler").mockReturnValue({
      name: "mock",
      extensions: [".dsn"],
      canHandle: () => true,
      discoverDesigns: vi.fn(),
      parse: vi.fn(),
    });
    vi.spyOn(parsersModule, "parseDesign").mockResolvedValue({
      ...structuredClone(NETLIST),
      repeatedSections: { "Q7~2": [{ pages: ["07_CLOCKS", "08_RESET"] }] },
    });

    const result = await queryComponent(DESIGN, "Q7");

    expect(result).toMatchObject({
      components: [
        { error: DUPLICATE_REFDES_ERROR },
        { error: `${DUPLICATE_REFDES_ERROR}; Placed twice (pages 07_CLOCKS, 08_RESET)` },
      ],
    });
  });
});
