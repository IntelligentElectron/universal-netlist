import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listKicadVariants, parseKicadSheetFiles, parseKicadVariantNames } from "./variants.js";

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
