/**
 * Tests for design discovery logic
 *
 * Tests the file system traversal and design detection for both
 * Cadence and Altium project formats.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "fs/promises";
import { join } from "path";
import { discoverDesigns } from "./index.js";
import type { AltiumDiscoveredDesign } from "../types.js";

describe("discoverDesigns", () => {
  const testDir = join(__dirname, "__test-discovery__");
  const oleStub = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

  async function writeOleSchDoc(filePath: string): Promise<void> {
    await writeFile(filePath, oleStub);
  }

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true, maxRetries: 3 });
    } catch (error) {
      console.warn("Test cleanup warning:", error);
    }
  });

  describe("Cadence designs", () => {
    it("discovers DSN schematics without associating DAT files or exposing HDL designs", async () => {
      const designDir = join(testDir, "test_design_1");
      const datDir = join(designDir, "worklib", "test_design_1", "packaged");

      await mkdir(datDir, { recursive: true });
      await writeFile(join(designDir, "test_design_1.cpm"), "");
      await writeFile(join(designDir, "test_design_1.DSN"), "");
      await writeFile(join(datDir, "pstxnet.dat"), "test");
      await writeFile(join(datDir, "pstxprt.dat"), "test");
      await writeFile(join(datDir, "pstchip.dat"), "test");

      const designs = await discoverDesigns(testDir);
      expect(designs).toHaveLength(1);
      expect(designs[0]).toMatchObject({
        name: "test_design_1",
        format: "cadence-cis",
        sourcePath: join(designDir, "test_design_1.DSN"),
        datFiles: {
          pstxnet: null,
          pstxprt: null,
          pstchip: null,
        },
      });
    });

    it("should not error for DSN design without dat files", async () => {
      await writeFile(join(testDir, "board.DSN"), "");

      const designs = await discoverDesigns(testDir);
      expect(designs).toHaveLength(1);
      expect(designs[0].name).toBe("board");
      expect(designs[0].error).toBeUndefined();
    });
  });

  describe("Altium designs", () => {
    it("should group Altium schdocs by project file", async () => {
      const projectDir = join(testDir, "project");
      const schematicsDir = join(projectDir, "Schematics");
      await mkdir(projectDir, { recursive: true });
      await mkdir(schematicsDir, { recursive: true });

      await writeFile(
        join(projectDir, "board.PrjPcb"),
        [
          "[Document1]",
          "DocumentPath=Schematics\\sheet1.SchDoc",
          "[Document2]",
          "DocumentPath=Schematics\\sheet2.SchDoc",
        ].join("\n")
      );
      await writeOleSchDoc(join(schematicsDir, "sheet1.SchDoc"));
      await writeOleSchDoc(join(schematicsDir, "sheet2.SchDoc"));

      const designs = await discoverDesigns(testDir);
      expect(designs).toHaveLength(1);
      expect(designs[0]).toMatchObject({
        name: "board",
        format: "altium",
        sourcePath: join(projectDir, "board.PrjPcb"),
      });
      const altiumDesign = designs[0] as AltiumDiscoveredDesign;
      expect(altiumDesign.schdocPaths).toEqual([
        join(schematicsDir, "sheet1.SchDoc"),
        join(schematicsDir, "sheet2.SchDoc"),
      ]);
    });

    it("should ignore non-OLE SchDoc files", async () => {
      const projectDir = join(testDir, "project");
      const schematicsDir = join(projectDir, "Schematics");
      await mkdir(projectDir, { recursive: true });
      await mkdir(schematicsDir, { recursive: true });

      await writeFile(
        join(projectDir, "board.PrjPcb"),
        ["[Document1]", "DocumentPath=Schematics\\sheet1.SchDoc"].join("\n")
      );
      // Write a text-based SchDoc (not OLE format)
      await writeFile(join(schematicsDir, "sheet1.SchDoc"), "|HEADER=Protel for Windows - Sch|");

      const designs = await discoverDesigns(testDir);
      expect(designs).toHaveLength(1);
      expect(designs[0].error).toBeDefined();
    });

    it("should fall back to a single SchDoc in the project folder", async () => {
      const projectDir = join(testDir, "project");
      await mkdir(projectDir, { recursive: true });

      await writeFile(
        join(projectDir, "board.PrjPcb"),
        ["[Document1]", "DocumentPath=Sheet1.SchDoc"].join("\n")
      );
      await writeOleSchDoc(join(projectDir, "board.SchDoc"));

      const designs = await discoverDesigns(testDir);
      expect(designs).toHaveLength(1);
      expect(designs[0].error).toBeUndefined();
      const altiumDesign = designs[0] as AltiumDiscoveredDesign;
      expect(altiumDesign.schdocPaths).toEqual([join(projectDir, "board.SchDoc")]);
    });
  });

  describe("maxDepth", () => {
    it("should find designs at depth 0 (root only)", async () => {
      // Design file directly in testDir
      await writeFile(join(testDir, "root.DSN"), "");

      // Design file one level deep — should NOT be found
      const subDir = join(testDir, "sub");
      await mkdir(subDir, { recursive: true });
      await writeFile(join(subDir, "nested.DSN"), "");

      const designs = await discoverDesigns(testDir, { maxDepth: 0 });
      expect(designs).toHaveLength(1);
      expect(designs[0].name).toBe("root");
    });

    it("should find designs up to depth 1", async () => {
      await writeFile(join(testDir, "root.DSN"), "");

      const subDir = join(testDir, "sub");
      await mkdir(subDir, { recursive: true });
      await writeFile(join(subDir, "shallow.DSN"), "");

      const deepDir = join(subDir, "deep");
      await mkdir(deepDir, { recursive: true });
      await writeFile(join(deepDir, "deep.DSN"), "");

      const designs = await discoverDesigns(testDir, { maxDepth: 1 });
      const names = designs.map((d) => d.name).sort();
      expect(names).toEqual(["root", "shallow"]);
    });

    it("should find all designs when maxDepth is omitted", async () => {
      await writeFile(join(testDir, "root.DSN"), "");

      const deepDir = join(testDir, "a", "b", "c");
      await mkdir(deepDir, { recursive: true });
      await writeFile(join(deepDir, "deep.DSN"), "");

      const designs = await discoverDesigns(testDir);
      expect(designs).toHaveLength(2);
    });

    it("should respect maxDepth for Altium projects", async () => {
      // Project at depth 1 — should be found with maxDepth: 1
      const projectDir = join(testDir, "project");
      await mkdir(projectDir, { recursive: true });
      await writeFile(join(projectDir, "board.PrjPcb"), "");

      // Project at depth 2 — should NOT be found with maxDepth: 1
      const deepDir = join(testDir, "a", "b");
      await mkdir(deepDir, { recursive: true });
      await writeFile(join(deepDir, "deep.PrjPcb"), "");

      const designs = await discoverDesigns(testDir, { maxDepth: 1 });
      expect(designs).toHaveLength(1);
      expect(designs[0].name).toBe("board");
    });
  });

  describe("Multiple formats", () => {
    it("should discover both Cadence and Altium designs", async () => {
      // Cadence design
      const cadenceDir = join(testDir, "cadence_board");
      const datDir = join(cadenceDir, "worklib", "cadence_board", "packaged");
      await mkdir(datDir, { recursive: true });
      await writeFile(join(cadenceDir, "cadence_board.DSN"), "");
      await writeFile(join(datDir, "pstxnet.dat"), "test");
      await writeFile(join(datDir, "pstxprt.dat"), "test");
      await writeFile(join(datDir, "pstchip.dat"), "test");

      // Altium design
      const altiumDir = join(testDir, "altium_board");
      await mkdir(altiumDir, { recursive: true });
      await writeFile(
        join(altiumDir, "altium_board.PrjPcb"),
        ["[Document1]", "DocumentPath=main.SchDoc"].join("\n")
      );
      await writeOleSchDoc(join(altiumDir, "main.SchDoc"));

      const designs = await discoverDesigns(testDir);
      expect(designs).toHaveLength(2);

      const cadence = designs.find((d) => d.format === "cadence-cis");
      const altium = designs.find((d) => d.format === "altium");

      expect(cadence).toBeDefined();
      expect(altium).toBeDefined();
    });
  });

  describe("macOS AppleDouble sidecars", () => {
    it("should ignore ._* sidecar files next to real designs", async () => {
      await writeFile(join(testDir, "board.DSN"), "");
      // AppleDouble sidecars carry resource-fork/xattr metadata, not design data.
      await writeFile(join(testDir, "._board.DSN"), Buffer.from([0x00, 0x05, 0x16, 0x07]));

      // An orphan SchDoc becomes a standalone design, so an OLE-looking sidecar
      // would show up as a phantom design named "._sheet" if it were not skipped.
      await writeOleSchDoc(join(testDir, "sheet.SchDoc"));
      await writeOleSchDoc(join(testDir, "._sheet.SchDoc"));

      const designs = await discoverDesigns(testDir);
      expect(designs.map((d) => d.name).sort()).toEqual(["board", "sheet"]);
    });

    it("should not descend into ._* sidecar directories", async () => {
      const sidecarDir = join(testDir, "._project");
      await mkdir(sidecarDir, { recursive: true });
      await writeFile(join(sidecarDir, "phantom.DSN"), "");

      const realDir = join(testDir, "project");
      await mkdir(realDir, { recursive: true });
      await writeFile(join(realDir, "real.DSN"), "");

      const designs = await discoverDesigns(testDir);
      expect(designs.map((d) => d.name)).toEqual(["real"]);
    });

    it("excludes standalone DAT designs and their sidecars", async () => {
      const designDir = join(testDir, "dat_only");
      await mkdir(designDir, { recursive: true });
      for (const name of ["pstxnet.dat", "pstxprt.dat", "pstchip.dat"]) {
        await writeFile(join(designDir, name), "test");
        await writeFile(join(designDir, `._${name}`), Buffer.from([0x00, 0x05, 0x16, 0x07]));
      }

      const designs = await discoverDesigns(testDir);
      expect(designs).toEqual([]);
    });

    it("should ignore ._* sidecars of KiCad project files", async () => {
      await writeFile(join(testDir, "proj.kicad_pro"), "{}");
      await writeFile(join(testDir, "._proj.kicad_pro"), Buffer.from([0x00, 0x05, 0x16, 0x07]));

      const designs = await discoverDesigns(testDir);
      expect(designs.map((d) => d.name)).toEqual(["proj"]);
    });
  });
});
