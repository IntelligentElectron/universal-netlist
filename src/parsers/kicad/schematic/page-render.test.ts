import { describe, expect, it } from "vitest";
import { renderKicadSheet } from "./page-render.js";

const sheet = (body: string) =>
  renderKicadSheet(`(kicad_sch (version 20231120) (uuid "r") ${body})`, "/r", {
    width: 297,
    height: 210,
  });

describe("renderKicadSheet", () => {
  it("runs a label turned 90 up from its anchor and one turned 270 down", () => {
    const up = sheet(`(label "UP" (at 50 50 90) (effects (font (size 1.27 1.27))))`);
    const down = sheet(`(label "DOWN" (at 50 50 270) (effects (font (size 1.27 1.27))))`);
    expect(up).toMatch(/text-anchor="start" transform="rotate\(-90 50 50\)"/);
    expect(down).toMatch(/text-anchor="end" transform="rotate\(-90 50 50\)"/);
  });

  it("draws ~{} with an overbar and _{} as plain text", () => {
    const svg = sheet(`(text "~{CS} and V_{DDA}" (at 10 10 0))`);
    expect(svg).toContain(`<tspan text-decoration="overline">CS</tspan> and VDDA`);
  });

  it("states its size in mils and draws in millimetres", () => {
    expect(sheet("")).toMatch(/viewBox="0 0 11693 8268".*scale\(39\.37/);
  });
});
