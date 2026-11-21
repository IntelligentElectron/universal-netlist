import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { callTool } from "../../tools/index.js";
import type { PageView } from "../../parsers/cadence/dsn/page-views.js";
import { findPage } from "./pages.js";

const MULTIO = join(import.meta.dirname, "../../../test/fixtures/cadence/multio/MULTIO.DSN");

type Pages = { pages: { page: string; parts: number }[] };

describe("list_pages and get_page", () => {
  it("lists every page of a design with its title-block fields", async () => {
    const result = (await callTool("list_pages", { design: MULTIO })) as Pages;
    expect(result.pages.map((p) => p.page.trim())).toEqual(["P1: PI", "P2: I/O"]);
    expect(result.pages[0]).toMatchObject({ title: "MULTIO-PI", page_number: 1, parts: 33 });
  });

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
  });

  it("refuses a design that is not a .DSN schematic", async () => {
    const result = (await callTool("list_pages", { design: "board.netlist.json" })) as {
      error?: string;
    };
    expect(result.error).toMatch(/\.DSN schematics only/);
  });
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
