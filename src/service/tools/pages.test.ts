import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { callTool } from "../../tools/index.js";
import type { PageView } from "../../pages/page-view.js";
import { findPage } from "./pages.js";

const FIXTURES = join(import.meta.dirname, "../../../test/fixtures/cadence");
const MULTIO = join(FIXTURES, "multio/MULTIO.DSN");
const META_CARRIER = join(FIXTURES, "parallella-meta-carrier/meta_carrier_sch_rev1.dsn");
const HB1A = join(FIXTURES, "parallella-aafm/HB1A-AAFM.DSN");
const LAUNCHXL = join(
  FIXTURES,
  "LAUNCHXL-CC1310/doc/hardware/cc1310/launchpad/design_files/Cadence/LAUNCHXL-CC1310.DSN"
);

type Pages = { pages: { page: string; parts: number }[] };

describe("list_pages and get_page", () => {
  it("lists every page of a design with its title-block fields", async () => {
    const result = (await callTool("list_pages", { design: MULTIO })) as Pages;
    expect(result.pages.map((p) => p.page.trim())).toEqual(["P1: PI", "P2: I/O"]);
    expect(result.pages[0]).toMatchObject({ title: "MULTIO-PI", page_number: 1, parts: 33 });
  }, 60_000);

  it("names every pin's net as the netlist does", async () => {
    const { pages } = (await callTool("list_pages", { design: MULTIO })) as Pages;
    let checked = 0;
    for (const { page } of pages) {
      const view = (await callTool("get_page", { design: MULTIO, page })) as PageView;
      for (const part of view.parts) {
        const component = (await callTool("query_component", {
          design: MULTIO,
          refdes: part.refdes,
          max_results: 10_000,
        })) as { pins: Record<string, string | { net: string }> };
        for (const pin of part.pins) {
          const entry = component.pins[pin.number];
          expect(pin.net, `${part.refdes}.${pin.number}`).toBe(
            typeof entry === "string" ? entry : entry?.net
          );
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  }, 60_000);

  it("gives each section of a part on one page only the pins it draws", async () => {
    const view = (await callTool("get_page", {
      design: META_CARRIER,
      page: "02-META-CONNECTORS",
    })) as PageView;
    const sections = view.parts.filter((part) => part.refdes === "J2");
    expect(sections.length).toBeGreaterThan(1);
    const numbers = sections.flatMap((part) => part.pins.map((pin) => pin.number));
    expect(new Set(numbers).size).toBe(numbers.length);
  }, 60_000);

  it("shows the pins of parts inside a placed block, ports included", async () => {
    const view = (await callTool("get_page", {
      design: META_CARRIER,
      page: "LINK4 (block LINK4-W)",
    })) as PageView;
    expect(view.parts.filter((part) => part.pins.length === 0)).toEqual([]);
    const r143 = view.parts.find((part) => part.refdes === "R143");
    expect(r143?.pins.map((pin) => [pin.number, pin.net])).toEqual([
      ["1", "WE_FRAME_IN_N0"],
      ["2", "Q0_VDDIO"],
    ]);
  }, 60_000);

  it("reports only nets that list_nets reports, on every page of a hierarchical design", async () => {
    const { nets } = (await callTool("list_nets", {
      design: META_CARRIER,
      max_results: 100_000,
    })) as { nets: string[] };
    const known = new Set(nets);
    const { pages } = (await callTool("list_pages", { design: META_CARRIER })) as Pages;
    const unknown: string[] = [];
    let checked = 0;
    for (const { page } of pages) {
      const view = (await callTool("get_page", { design: META_CARRIER, page })) as PageView;
      const objects = [
        ...view.wires,
        ...view.ports,
        ...view.globals,
        ...view.off_page_connectors,
        ...view.parts.flatMap((part) => part.pins),
      ];
      for (const { net } of objects) {
        if (net === undefined) continue;
        checked++;
        if (!known.has(net)) unknown.push(`${page}: ${net}`);
      }
    }
    expect(unknown).toEqual([]);
    expect(checked).toBeGreaterThan(1000);
  }, 120_000);

  it("gives a Global that touches only pins the net of those pins", async () => {
    const view = (await callTool("get_page", { design: LAUNCHXL, page: "4_XDS110" })) as PageView;
    const gnd = view.globals.find((g) => g.x === 7100 && g.y === 2900);
    expect(gnd).toMatchObject({ name: "GND", net: "GND" });
  }, 60_000);

  it("joins closely spaced ports to the pins at their connection points", async () => {
    // Each port's box also covers its neighbour's pin; only its connection point is exact.
    const view = (await callTool("get_page", {
      design: HB1A,
      page: "Link Ports EAST/WEST (block QUAD ANEMONE/DSP LL)",
    })) as PageView;
    const portNet = (name: string) => view.ports.find((p) => p.name === name)?.net;
    const u7 = view.parts.find((part) => part.refdes === "U7");
    const pinNet = (n: string) => u7?.pins.find((pin) => pin.number === n)?.net;
    expect(portNet("RXI_WE_LCLK_P")).toBe(pinNet("M1"));
    expect(portNet("RXI_WE_LCLK_N")).toBe(pinNet("N1"));
    expect(pinNet("M1")).not.toBe(pinNet("N1"));
  }, 60_000);

  it("refuses a design that is neither a .DSN nor a KiCad design", async () => {
    const result = (await callTool("list_pages", { design: "board.netlist.json" })) as {
      error?: string;
    };
    expect(result.error).toMatch(/Cadence \.DSN, KiCad and Altium \.PrjPcb designs only/);
  }, 60_000);
});

describe("KiCad pages", () => {
  const MIXER = join(FIXTURES, "../kicad/multichannel-mixer/multichannel_mixer.kicad_pro");
  const CYNTHION = join(FIXTURES, "../kicad/cynthion-usb-fpga/cynthion.kicad_pro");

  it("lists one page per sheet instance, in page-number order", async () => {
    const { pages } = (await callTool("list_pages", { design: MIXER })) as Pages;
    expect(pages.map((p) => p.page)).toEqual([
      "multichannel_mixer.kicad_sch",
      "CH1",
      "CH2",
      "CH3",
      "CH4",
    ]);
  }, 60_000);

  it("places parts, pins, ports and globals in mils, on the netlist's nets", async () => {
    const view = (await callTool("get_page", { design: MIXER, page: "CH1" })) as PageView;
    expect(view.size).toEqual({ name: "A4", width_mil: 11693, height_mil: 8268 });
    expect(view.parts.find((p) => p.refdes === "R8")).toMatchObject({
      x: 6350,
      y: 4150,
      rotation: 180,
      mirrored: false,
      box: [6050, 4120, 6350, 4180],
      pins: [
        { number: "1", type: "passive", x: 6350, y: 4150, net: "Net-(R8-Pad1)" },
        { number: "2", type: "passive", x: 6050, y: 4150, net: "Net-(IC2A-OUT)" },
      ],
    });
    expect(view.ports).toEqual([
      { name: "OUT", type: "output", x: 10650, y: 3100, net: "/CH1/OUT" },
    ]);
    expect(view.globals).toContainEqual({ name: "GND", x: 5200, y: 4050, net: "GND" });
    // Every connected pin meets a wire end or another item at its point.
    const points = new Set(view.wires.flatMap((w) => [`${w.x1},${w.y1}`, `${w.x2},${w.y2}`]));
    for (const c of [...view.globals, ...view.ports]) points.add(`${c.x},${c.y}`);
    const pins = view.parts.flatMap((p) => p.pins).filter((pin) => pin.net && pin.net !== "NC");
    expect(pins.length).toBeGreaterThan(50);
    for (const pin of pins) expect(points.has(`${pin.x},${pin.y}`), pin.number).toBe(true);
  }, 60_000);

  it("names every pin's net as query_component does when the netlist is a saved export", async () => {
    // yddraig ships yddraig.net, whose names differ from the schematic reader's on this page.
    const YDDRAIG = join(FIXTURES, "../kicad/yddraig-68k/yddraig.kicad_pro");
    const view = (await callTool("get_page", {
      design: YDDRAIG,
      page: "Decode and Logic",
    })) as PageView;
    const u404 = view.parts.find((p) => p.refdes === "U404");
    expect(u404?.pins.find((pin) => pin.number === "23")?.net).toBe(
      "/Decode and Logic/~{CS_EXTDATA1}"
    );
    let checked = 0;
    for (const part of view.parts) {
      const component = (await callTool("query_component", {
        design: YDDRAIG,
        refdes: part.refdes,
      })) as {
        pins: Record<string, { net: string }>;
      };
      for (const pin of part.pins) {
        const want = component.pins[pin.number]?.net;
        if (want === undefined) continue;
        expect(pin.net, `${part.refdes}.${pin.number}`).toBe(want);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  }, 120_000);

  it("names a root titled with an unresolved variable by its file, and searches its notes", async () => {
    const { pages } = (await callTool("list_pages", { design: CYNTHION })) as Pages;
    expect(pages[0]?.page).toBe("cynthion.kicad_sch");
    const found = (await callTool("search_notes", { design: MIXER, pattern: "demo board" })) as {
      text_notes: { page: string; x: number; y: number }[];
    };
    expect(found.text_notes).toEqual([
      expect.objectContaining({ page: "multichannel_mixer.kicad_sch", x: 5020, y: 780 }),
    ]);
  }, 60_000);
});

describe("text notes", () => {
  type Notes = {
    text_notes: { page: string; text: string; x: number; y: number }[];
    next_offset?: number;
  };

  it("gives get_page the page's notes, with line breaks as \\n", async () => {
    const view = (await callTool("get_page", { design: HB1A, page: "AAFM Top" })) as PageView;
    expect(view.text_notes).toContainEqual({
      text: "FMC_CPLD_[3:0] used as\n4-bit bidir bus",
      x: 3500,
      y: 4900,
    });
    expect(view.text_notes.every((note) => note.text.trim() && !note.text.includes("\r"))).toBe(
      true
    );
  }, 60_000);

  it("finds a note on any page by a case-insensitive pattern, and pages the matches", async () => {
    const found = (await callTool("search_notes", { design: HB1A, pattern: "BIDIR BUS" })) as Notes;
    expect(found.text_notes.map((note) => note.page)).toEqual([
      "AAFM Top",
      "MAX II CPLD (block CPLD)",
    ]);
    expect(found.text_notes[0]).toEqual({
      page: "AAFM Top",
      text: "FMC_CPLD_[3:0] used as\n4-bit bidir bus",
      x: 3500,
      y: 4900,
    });
    const all = (await callTool("search_notes", {
      design: HB1A,
      pattern: ".",
      max_results: 10,
    })) as Notes;
    expect(all.text_notes).toHaveLength(10);
    expect(all.next_offset).toBe(10);
  }, 60_000);

  it("refuses a bad pattern and a design that is neither a .DSN nor KiCad", async () => {
    expect(await callTool("search_notes", { design: HB1A, pattern: "(" })).toEqual({
      error: "Invalid regex pattern '('",
    });
    expect(await callTool("search_notes", { design: "board.SchLib", pattern: "x" })).toMatchObject({
      error: expect.stringContaining("Cadence .DSN, KiCad and Altium .PrjPcb designs only"),
    });
  });
});

describe("ERC markers and port types", () => {
  const SDR = join(FIXTURES, "opencellular-sdr/OC_CONNECT1_SDR_REV_C_V1P1.DSN");

  it("gives get_page Capture's saved ERC markers and each port's direction", async () => {
    const page = (await callTool("get_page", {
      design: SDR,
      page: "PAGE 29 : POWER_SWITCH",
    })) as PageView;
    expect(page.erc_markers).toHaveLength(5);
    expect(page.erc_markers[0]).toEqual({
      message: "ERROR(ORCAP-1628): Possible pin type conflict",
      detail: "U252,OUT Output Connected to Output",
      location: "",
      x: 10250,
      y: 8200,
    });
    const clock = (await callTool("get_page", {
      design: HB1A,
      page: "Clock Generator (block CLOCK)",
    })) as PageView;
    expect(clock.ports).toContainEqual({
      name: "UL_CCLK_P",
      type: "output",
      x: 13900,
      y: 1000,
      net: "UL_CCLK_P",
    });
  }, 60_000);

  it("reports the markers in run_erc by level, keyed by page", async () => {
    const erc = (await callTool("run_erc", {
      design: SDR,
      include_rules: ["capture.erc_error", "capture.erc_warning"],
    })) as { errors?: Record<string, Record<string, unknown[]>>; warnings?: unknown };
    expect(Object.keys(erc.errors?.["capture.erc_error"] ?? {})).toEqual([
      "PAGE 29 : POWER_SWITCH",
    ]);
    expect(erc.errors?.["capture.erc_error"]["PAGE 29 : POWER_SWITCH"]).toHaveLength(5);
    expect(erc.warnings).toBeUndefined();
  }, 60_000);

  it("pages run_erc's markers one by one, trimmed", async () => {
    const erc = (await callTool("run_erc", {
      design: META_CARRIER,
      include_rules: ["capture.erc_warning"],
      max_results: 2,
    })) as {
      warnings: Record<string, Record<string, { detail: string }[]>>;
      totals: Record<string, number>;
      next_offset?: number;
    };
    const pages = Object.values(erc.warnings["capture.erc_warning"]);
    expect(pages.flat()).toHaveLength(2);
    expect(pages.flat()[0].detail).toBe("SO_DATA_OUT_N13");
    expect(erc.next_offset).toBe(2);
    expect(erc.totals["capture.erc_warning"]).toBeGreaterThan(2);
  }, 60_000);
});

describe("findPage", () => {
  const view = (page: string, name: string, schematic = "S") =>
    ({ page, name, schematic }) as PageView;
  const pages = [
    view("POWER ", "POWER "),
    view("TILE (block A)", "TILE", "T"),
    view("TILE (block B)", "TILE", "T"),
  ];

  it("matches a name with spaces at either end", () => {
    expect(findPage(pages, "power")).toBe(pages[0]);
  });

  it("asks for the placement when a reused page's name is ambiguous", () => {
    expect(findPage(pages, "TILE")).toEqual({ error: expect.stringContaining("'TILE (block A)'") });
    expect(findPage(pages, "tile (block b)")).toBe(pages[2]);
  });

  it("reports a page that does not exist", () => {
    expect(findPage(pages, "NOPE")).toEqual({ error: expect.stringContaining("list_pages") });
  });
});

describe("Altium pages", () => {
  const BMS = join(FIXTURES, "../altium/solarcar-bms/bms_mainboard-1_1.PrjPcb");

  it("lists one page per sheet, and one per channel of a repeated sheet", async () => {
    const { pages } = (await callTool("list_pages", { design: BMS })) as Pages;
    const names = pages.map((p) => p.page);
    expect(names).toContain("adc_mcp3913.SchDoc");
    expect(names).toContain("analog_sensor_input.SchDoc (sensor0)");
    expect(names).toContain("analog_sensor_input.SchDoc (sensor1)");
    // Each channel page carries that channel's designators and nets.
    const sensor1 = (await callTool("get_page", {
      design: BMS,
      page: "analog_sensor_input.SchDoc (sensor1)",
    })) as PageView;
    expect(sensor1.parts.find((p) => p.refdes === "C149B")?.pins[0]?.net).toBe("AIN1_1");
  }, 60_000);

  it("places parts and pins in mils with y down, on the nets query_component gives", async () => {
    const view = (await callTool("get_page", {
      design: BMS,
      page: "adc_mcp3913.SchDoc",
    })) as PageView;
    expect(view.size).toEqual({ name: "A", width_mil: 9500, height_mil: 7500 });
    const u3 = view.parts.find((p) => p.refdes === "U3");
    expect(u3).toMatchObject({ x: 3300, y: 3500, mirrored: true, box: [2300, 3500, 3300, 5100] });
    let checked = 0;
    for (const part of view.parts) {
      const component = (await callTool("query_component", {
        design: BMS,
        refdes: part.refdes,
        design_variant: "0",
      })) as {
        pins?: Record<string, { net: string }>;
      };
      for (const pin of part.pins) {
        const want = component.pins?.[pin.number]?.net;
        if (want === undefined) continue;
        expect(pin.net, `${part.refdes}.${pin.number}`).toBe(want);
        expect(pin.x >= 0 && pin.x <= 9500 && pin.y >= 0 && pin.y <= 7500).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(50);
    expect(view.text_notes[0]).toEqual({
      text: "6-input differential 24-bit ADC",
      x: 200,
      y: 6100,
    });
  }, 120_000);

  it("says render_page does not draw Altium pages yet", async () => {
    const result = (await callTool("render_page", { design: BMS, page: "adc_mcp3913.SchDoc" })) as {
      error?: string;
    };
    expect(result.error).toMatch(/draws Cadence and KiCad pages only/);
  }, 60_000);
});
