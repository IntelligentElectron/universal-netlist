import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DsnReader } from "./dsn-reader.js";
import { readLibraryVersion } from "./library-parser.js";
import { parsePage } from "./page-parser.js";
import { connectionPoint, readCacheSymbols } from "./symbol-graphics.js";
import { symbolUnderPin } from "./symbol-attachment.js";

const FIXTURES = join(import.meta.dirname, "../../../../test/fixtures/cadence");
const designs = execSync(`find "${FIXTURES}" -iname '*.dsn'`).toString().trim().split("\n");

describe("connectionPoint (§7.7, §11.4)", () => {
  it("lands on the end of the wire each connector's trailer names, on every fixture but 8 known", () => {
    let checked = 0;
    const misses: string[] = [];
    for (const design of designs) {
      const ole = new DsnReader(readFileSync(design));
      const entries = ole.listAllEntries();
      const library = entries.find((e) => e.path === "Library");
      if (!library || readLibraryVersion(ole.readStreamByPath(library.path))?.major !== 3) continue;
      const cache = entries.find((e) => e.path === "Cache");
      if (!cache) continue;
      const symbols = readCacheSymbols(ole.readStreamByPath(cache.path));
      for (const entry of entries) {
        if (!/\/Pages\//.test(entry.path) || entry.entry.type !== 2) continue;
        const page = parsePage(ole.readStreamByPath(entry.path));
        const wires = new Map(page.wires.map((w) => [w.segmentId, w]));
        for (const sym of [...page.globals, ...page.ports, ...page.offPageConnectors]) {
          const wire = sym.wireId ? wires.get(sym.wireId) : undefined;
          if (!wire) continue;
          checked++;
          const at = connectionPoint(sym, symbols)?.join(",");
          if (at !== `${wire.startX},${wire.startY}` && at !== `${wire.endX},${wire.endY}`)
            misses.push(`${design.split("/").pop()} ${entry.path} ${sym.name} -> ${at}`);
        }
      }
    }
    // The golden spec's 8 unexplained misses (§7.7): GND symbols at half-grid
    // points on one OpenCellular page, in both copies of that design. They have
    // trailer wires, so they attach by the wire.
    expect(misses).toHaveLength(8);
    expect(misses.every((m) => /OC_CONNECT1_SDR_REV_C.*PAGE 12 .*GND/.test(m))).toBe(true);
    expect(checked).toBeGreaterThan(1000);
  }, 120_000);
});

describe("symbolUnderPin", () => {
  // Two ports one grid step apart, each box two steps tall, as on HB1A's link
  // ports: the pin at (260, 330) lies in both boxes but on only one connection point.
  const port = (y: number, connection?: [number, number]) => ({
    x1: 230,
    y1: y - 10,
    x2: 270,
    y2: y + 10,
    locX: 230,
    locY: y,
    connection,
  });

  it("picks the connector whose connection point the pin is on, over an earlier box", () => {
    const upper = port(320, [260, 320]);
    const lower = port(330, [260, 330]);
    expect(symbolUnderPin([upper, lower], 260, 330)).toBe(lower);
  });

  it("falls back to a box only when no connector's point is under the pin", () => {
    const noSymbol = port(320);
    expect(symbolUnderPin([noSymbol], 260, 330)).toBe(noSymbol);
    expect(symbolUnderPin([noSymbol], 300, 330)).toBeUndefined();
  });
});
