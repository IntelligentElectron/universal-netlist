import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DsnReader } from "../../parsers/cadence/dsn/dsn-reader.js";
import { parsePage } from "../../parsers/cadence/dsn/page-parser.js";
import { placement } from "../../parsers/cadence/dsn/symbol-graphics.js";
import type { PageView } from "../../pages/page-view.js";
import { readCacheSymbols } from "../../parsers/cadence/dsn/symbol-graphics.js";
import { callTool } from "../../tools/index.js";
import { cropSvg, focusBox } from "./render-page.js";
import { loadPages } from "./pages.js";
import { parserContextFromEnvironment } from "../../parsers/context.js";

const FIXTURES = join(import.meta.dirname, "../../../test/fixtures/cadence");
const MULTIO = join(FIXTURES, "multio/MULTIO.DSN");
const META_CARRIER = join(FIXTURES, "parallella-meta-carrier/meta_carrier_sch_rev1.dsn");

describe("symbol placement", () => {
  it.each([MULTIO, META_CARRIER])(
    "puts every cached pin's hot point on the page pin it draws (%s)",
    (design) => {
      const ole = new DsnReader(readFileSync(design));
      const symbols = readCacheSymbols(ole.readStreamByPath("Cache"));
      let checked = 0;
      for (const entry of ole.listAllEntries()) {
        if (!/^Views\/[^/]+\/Pages\//.test(entry.path) || entry.entry.type !== 2) continue;
        for (const inst of parsePage(ole.readStreamByPath(entry.path)).placedInstances) {
          const sym = symbols.get(inst.pkgName);
          if (!sym) continue;
          const t = placement(sym.box, inst.locX, inst.locY, inst.rotation, inst.mirrored);
          for (const pin of inst.t0x10s) {
            const drawn = sym.pins[pin.pinIndex - 1];
            if (!drawn) continue;
            expect(t([drawn.hotX, drawn.hotY]), `${inst.reference}.${pin.pinIndex}`).toEqual([
              pin.pointX,
              pin.pointY,
            ]);
            checked++;
          }
        }
      }
      expect(checked).toBeGreaterThan(100);
    },
    60_000
  );
});

describe("focus", () => {
  const view = {
    parts: [
      {
        refdes: "R1",
        box: [100, 100, 120, 160],
        pins: [{ number: "1", x: 110, y: 90, net: "VCC" }],
      },
    ],
    wires: [{ x1: 110, y1: 90, x2: 300, y2: 90, bus: false, net: "VCC" }],
    ports: [],
    globals: [],
    off_page_connectors: [],
  } as unknown as PageView;

  it("covers a part's box and pins, or everything on a net", () => {
    expect(focusBox(view, "r1")).toEqual([100, 90, 120, 160]);
    expect(focusBox(view, "VCC")).toEqual([110, 90, 300, 90]);
    expect(focusBox(view, "GND")).toBeUndefined();
  });

  it("narrows the drawing's view to the box with a margin", () => {
    const svg = '<svg viewBox="0 0 11000 8500" width="11000" height="8500"></svg>';
    expect(cropSvg(svg, [1000, 900, 1200, 1600])).toBe(
      '<svg viewBox="600 500 1000 1500" width="1000" height="1500"></svg>'
    );
  });
});

describe("render_page", () => {
  it("returns a PNG of a page and of one part", async () => {
    for (const focus of [undefined, "Q1"]) {
      const result = (await callTool("render_page", {
        design: MULTIO,
        page: "P1: PI",
        ...(focus ? { focus } : {}),
      })) as { width: number; image: { mimeType: string; data: string } };
      expect(result.image.mimeType).toBe("image/png");
      const png = Buffer.from(result.image.data, "base64");
      expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
      expect(png.readUInt32BE(16)).toBe(result.width);
    }
  }, 60_000);

  it("says when the focus is on nothing on the page", async () => {
    const result = (await callTool("render_page", {
      design: MULTIO,
      page: "P1: PI",
      focus: "NOPE",
    })) as { error?: string };
    expect(result.error).toMatch(/neither a part nor a net/);
  }, 60_000);
});

describe("render_page on KiCad", () => {
  const MIXER = join(FIXTURES, "../kicad/multichannel-mixer/multichannel_mixer.kicad_pro");

  it("draws every visible pin from the point get_page gives it", async () => {
    const loaded = await loadPages(MIXER, { parser: parserContextFromEnvironment() }, true);
    if ("error" in loaded) throw new Error(loaded.error);
    const i = loaded.pages.findIndex((p) => p.page === "CH1");
    const svg = loaded.svgs[i]!;
    expect(svg).toMatch(/^<svg [^>]*viewBox="0 0 11693 8268"/);
    // The drawing is in millimetres inside the mils viewBox; a pin's line starts at its tip.
    const starts = new Set(
      [...svg.matchAll(/<line x1="([-\d.]+)" y1="([-\d.]+)"/g)].map(
        (m) => `${Math.round(Number(m[1]) / 0.0254)},${Math.round(Number(m[2]) / 0.0254)}`
      )
    );
    const pins = loaded.pages[i]!.parts.flatMap((p) => p.pins);
    expect(pins.length).toBeGreaterThan(50);
    for (const pin of pins)
      expect(starts.has(`${Math.round(pin.x)},${Math.round(pin.y)}`)).toBe(true);
  }, 60_000);

  it("returns a PNG of a KiCad page and of one part on it", async () => {
    for (const focus of [undefined, "R8"]) {
      const result = (await callTool("render_page", {
        design: MIXER,
        page: "CH1",
        ...(focus ? { focus } : {}),
      })) as { width: number; image: { mimeType: string; data: string } };
      expect(result.image.mimeType).toBe("image/png");
      expect(Buffer.from(result.image.data, "base64").readUInt32BE(16)).toBe(result.width);
    }
  }, 60_000);
});
