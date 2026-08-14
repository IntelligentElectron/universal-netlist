import { describe, it, expect } from "vitest";
import { kicadHandler, parseKicadDesign } from "./index.js";
import { discoverKicadDesigns, isKicadFile } from "./discovery.js";
import { fixture, hasFixtures } from "../../../test/utils.js";

const KICAD_FIXTURES = fixture("kicad");

describe("kicadHandler", () => {
  it("declares the kicad name and project extensions", () => {
    expect(kicadHandler.name).toBe("kicad");
    expect(kicadHandler.extensions).toContain(".kicad_pro");
    expect(kicadHandler.extensions).toContain(".kicad_sch");
  });

  it("recognizes KiCad design files", () => {
    expect(isKicadFile("/x/Board.kicad_pro")).toBe(true);
    expect(isKicadFile("/x/Board.kicad_sch")).toBe(true);
    expect(isKicadFile("/x/Board.kicad_pcb")).toBe(false);
    expect(isKicadFile("/x/Board.dsn")).toBe(false);
  });

  it("throws a clear error when neither a .net export nor a root schematic exists", async () => {
    await expect(parseKicadDesign("/no/such/dir/Phantom.kicad_pro")).rejects.toThrow(/No netlist/);
  });
});

describe.skipIf(!hasFixtures)("kicadHandler against fixtures", () => {
  it("discovers all 10 KiCad fixture projects with their committed exports", async () => {
    const designs = await discoverKicadDesigns(KICAD_FIXTURES);
    expect(designs.length).toBe(10);
    for (const d of designs) {
      expect(d.format).toBe("kicad");
      expect(d.sourcePath.endsWith(".kicad_pro")).toBe(true);
      expect(d.netlistExport).not.toBeNull();
    }
  });

  it("parses the flat baseline (DMG-QLA-01) from its committed export", async () => {
    const designs = await discoverKicadDesigns(KICAD_FIXTURES);
    const dmg = designs.find((d) => d.name === "DMG-QLA-01");
    expect(dmg).toBeDefined();
    const netlist = await parseKicadDesign(dmg!.sourcePath);
    expect(Object.keys(netlist.components)).toHaveLength(29);
    expect(Object.keys(netlist.nets)).toHaveLength(24);
    // Spot-check a known connection and a stripped pin name.
    expect(netlist.nets["+5V"]?.["U1"]).toContain("15");
    expect(netlist.components["U1"]?.pins["15"]).toEqual({ name: "PC7", net: "+5V" });
  });

  it("does not false-positive DNP on user 'DNP' BOM fields (cynthion)", async () => {
    const designs = await discoverKicadDesigns(KICAD_FIXTURES);
    const cynthion = designs.find((d) => d.name === "cynthion");
    expect(cynthion).toBeDefined();
    const netlist = await parseKicadDesign(cynthion!.sourcePath);
    const dnp = Object.values(netlist.components).filter((c) => c.dns).length;
    expect(dnp).toBe(0);
  });
});
