import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { callTool } from "../../tools/index.js";
import type { PageView } from "../../parsers/cadence/dsn/page-views.js";
import { findPage } from "./pages.js";

const FIXTURES = join(import.meta.dirname, "../../../test/fixtures/cadence");
const MULTIO = join(FIXTURES, "multio/MULTIO.DSN");
const META_CARRIER = join(FIXTURES, "parallella-meta-carrier/meta_carrier_sch_rev1.dsn");
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

  it("gives a Global that touches only pins the net of those pins", async () => {
    const view = (await callTool("get_page", { design: LAUNCHXL, page: "4_XDS110" })) as PageView;
    const gnd = view.globals.find((g) => g.x === 710 && g.y === 290);
    expect(gnd).toMatchObject({ name: "GND", net: "GND" });
  }, 60_000);

  it("refuses a design that is not a .DSN schematic", async () => {
    const result = (await callTool("list_pages", { design: "board.netlist.json" })) as {
      error?: string;
    };
    expect(result.error).toMatch(/\.DSN schematics only/);
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
