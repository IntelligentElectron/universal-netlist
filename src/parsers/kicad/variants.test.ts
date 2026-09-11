import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyKicadVariant,
  listKicadVariants,
  parseKicadSheetFiles,
  parseKicadVariantNames,
  parseKicadVariantOverrides,
} from "./variants.js";
import type { ComponentDetails } from "../../types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("parseKicadVariantNames", () => {
  it("finds per-instance variant overlays and de-duplicates their names", () => {
    const schematic = `(kicad_sch
      (version 20260101)
      (symbol
        (instances
          (project "demo"
            (path "/a" (reference "R1") (unit 1)
              (variant (name "WiFi-only") (dnp yes))
              (variant (name "Production") (field (name "Value") (value "10k")))))))
      (symbol
        (instances
          (project "demo"
            (path "/b" (reference "U1") (unit 1)
              (variant (name "wifi-ONLY") (in_bom no)))))))`;

    expect(parseKicadVariantNames(schematic)).toEqual(["WiFi-only", "Production"]);
  });

  it("returns no named variant for a pre-KiCad-10/base-only schematic", () => {
    expect(
      parseKicadVariantNames(
        `(kicad_sch (version 20231120) (symbol (instances (project "demo" (path "/a")))))`
      )
    ).toEqual([]);
  });

  it("finds hierarchical sheet files", () => {
    expect(
      parseKicadSheetFiles(`(kicad_sch
        (sheet (property "Sheetname" "Power") (property "Sheetfile" "power/power.kicad_sch"))
        (sheet (property "Sheetfile" "io.kicad_sch")))`)
    ).toEqual(["power/power.kicad_sch", "io.kicad_sch"]);
  });

  it("discovers variants stored on hierarchical child sheets", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "universal-netlist-kicad-variants-"));
    tempDirs.push(dir);
    const root = path.join(dir, "board.kicad_sch");
    const child = path.join(dir, "power.kicad_sch");
    await writeFile(
      root,
      `(kicad_sch (sheet (property "Sheetfile" "power.kicad_sch"))
        (variant (name "Root variant")))`
    );
    await writeFile(child, `(kicad_sch (variant (name "Child variant")))`);

    await expect(listKicadVariants(root)).resolves.toEqual([
      { name: "Root variant" },
      { name: "Child variant" },
    ]);
  });
});

const overlay = `(kicad_sch
  (symbol
    (instances
      (project "demo"
        (path "/a" (reference "R1") (unit 1)
          (variant (name "Production") (dnp yes))
          (variant (name "Debug") (field (name "Value") (value "4k7")) (field (name "MPN") (value "RC0402-4K7")))))
      (project "other-board"
        (path "/z" (reference "R900") (unit 1)
          (variant (name "Production") (dnp yes))))))
  (symbol
    (instances
      (project "demo"
        (path "/b" (reference "U1") (unit 1) (variant (name "production") (dnp no)))
        (path "/b" (reference "U1") (unit 2) (variant (name "Production") (dnp yes) (field (name "Description") (value "Alt op-amp")))))))
  (symbol
    (instances
      (project "demo"
        (path "/c" (reference "C3") (unit 1) (variant (name "Debug") (field (name "Value") (value ""))))))))`;

describe("parseKicadVariantOverrides", () => {
  it("reads one variant's blocks by reference, case-insensitively, merging multi-unit symbols", () => {
    const production = parseKicadVariantOverrides(overlay, "PRODUCTION", "demo");
    expect([...production.keys()]).toEqual(["R1", "U1"]);
    expect(production.get("R1")).toEqual({ dnp: true, fields: {} });
    // Unit 1 says fitted, unit 2 says not fitted: the part is not fitted.
    expect(production.get("U1")).toEqual({ dnp: true, fields: { Description: "Alt op-amp" } });
  });

  it("reads only the named project's paths when the symbol carries one", () => {
    expect([...parseKicadVariantOverrides(overlay, "Production", "demo").keys()]).not.toContain(
      "R900"
    );
    expect([...parseKicadVariantOverrides(overlay, "Production").keys()]).toContain("R900");
  });

  it("keeps field overrides, including an emptied value", () => {
    const debug = parseKicadVariantOverrides(overlay, "Debug", "demo");
    expect(debug.get("R1")).toEqual({ fields: { Value: "4k7", MPN: "RC0402-4K7" } });
    expect(debug.get("C3")).toEqual({ fields: { Value: "" } });
  });
});

describe("applyKicadVariant", () => {
  const components = (): ComponentDetails => ({
    R1: { pins: {}, value: "10k", mpn: "RC0402-10K" },
    U1: { pins: {}, value: "TL072", description: "Op-amp" },
    C3: { pins: {}, value: "100n" },
  });

  it("marks not-fitted parts and clears an explicit fitted override", () => {
    const result = components();
    result.U1.dns = true;
    applyKicadVariant(
      result,
      new Map([
        ["r1", { dnp: true, fields: {} }],
        ["U1", { dnp: false, fields: {} }],
      ])
    );
    expect(result.R1.dns).toBe(true);
    expect(result.U1.dns).toBeUndefined();
  });

  it("substitutes a part when an identity field changes, and flags it", () => {
    const result = components();
    applyKicadVariant(result, parseKicadVariantOverrides(overlay, "Debug", "demo"));
    expect(result.R1).toEqual({ pins: {}, value: "4k7", mpn: "RC0402-4K7", alternate_part: true });
    expect(result.C3).toEqual({ pins: {}, alternate_part: true });
  });

  it("changes a description without calling the part an alternate", () => {
    const result = components();
    applyKicadVariant(result, parseKicadVariantOverrides(overlay, "Production", "demo"));
    expect(result.U1).toEqual({ pins: {}, value: "TL072", description: "Alt op-amp", dns: true });
    expect(result.U1.alternate_part).toBeUndefined();
  });

  it("ignores references the netlist does not carry", () => {
    const result = components();
    applyKicadVariant(result, new Map([["R999", { dnp: true, fields: {} }]]));
    expect(result).toEqual(components());
  });
});
