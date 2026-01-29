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
    it("should discover Cadence designs and associated .dat files", async () => {
      const designDir = join(testDir, "hush");
      const datDir = join(designDir, "worklib", "hush", "packaged");

      await mkdir(datDir, { recursive: true });
      await writeFile(join(designDir, "hush.cpm"), "");
      await writeFile(join(datDir, "pstxnet.dat"), "test");
      await writeFile(join(datDir, "pstxprt.dat"), "test");
      await writeFile(join(datDir, "pstchip.dat"), "test");

      const designs = await discoverDesigns(testDir);
      expect(designs).toHaveLength(1);
      expect(designs[0]).toMatchObject({
        name: "hush",
        format: "cadence-hdl",
        sourcePath: join(designDir, "hush.cpm"),
        datFiles: {
          pstxnet: join(datDir, "pstxnet.dat"),
          pstxprt: join(datDir, "pstxprt.dat"),
          pstchip: join(datDir, "pstchip.dat"),
        },
      });
    });

    it("should mark Cadence designs with missing dat files", async () => {
      await writeFile(join(testDir, "board.DSN"), "");

      const designs = await discoverDesigns(testDir);
      expect(designs).toHaveLength(1);
      expect(designs[0].name).toBe("board");
      expect(designs[0].error).toBeDefined();
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
        ].join("\n"),
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
        ["[Document1]", "DocumentPath=Schematics\\sheet1.SchDoc"].join("\n"),
      );
      // Write a text-based SchDoc (not OLE format)
      await writeFile(
        join(schematicsDir, "sheet1.SchDoc"),
        "|HEADER=Protel for Windows - Sch|",
      );

      const designs = await discoverDesigns(testDir);
      expect(designs).toHaveLength(1);
      expect(designs[0].error).toBeDefined();
    });

    it("should fall back to a single SchDoc in the project folder", async () => {
      const projectDir = join(testDir, "project");
      await mkdir(projectDir, { recursive: true });

      await writeFile(
        join(projectDir, "board.PrjPcb"),
        ["[Document1]", "DocumentPath=Sheet1.SchDoc"].join("\n"),
      );
      await writeOleSchDoc(join(projectDir, "board.SchDoc"));

      const designs = await discoverDesigns(testDir);
      expect(designs).toHaveLength(1);
      expect(designs[0].error).toBeUndefined();
      const altiumDesign = designs[0] as AltiumDiscoveredDesign;
      expect(altiumDesign.schdocPaths).toEqual([
        join(projectDir, "board.SchDoc"),
      ]);
    });
  });

  describe("Multiple formats", () => {
    it("should discover both Cadence and Altium designs", async () => {
      // Cadence design
      const cadenceDir = join(testDir, "cadence_board");
      const datDir = join(cadenceDir, "worklib", "cadence_board", "packaged");
      await mkdir(datDir, { recursive: true });
      await writeFile(join(cadenceDir, "cadence_board.cpm"), "");
      await writeFile(join(datDir, "pstxnet.dat"), "test");
      await writeFile(join(datDir, "pstxprt.dat"), "test");
      await writeFile(join(datDir, "pstchip.dat"), "test");

      // Altium design
      const altiumDir = join(testDir, "altium_board");
      await mkdir(altiumDir, { recursive: true });
      await writeFile(
        join(altiumDir, "altium_board.PrjPcb"),
        ["[Document1]", "DocumentPath=main.SchDoc"].join("\n"),
      );
      await writeOleSchDoc(join(altiumDir, "main.SchDoc"));

      const designs = await discoverDesigns(testDir);
      expect(designs).toHaveLength(2);

      const cadence = designs.find((d) => d.format === "cadence-hdl");
      const altium = designs.find((d) => d.format === "altium");

      expect(cadence).toBeDefined();
      expect(altium).toBeDefined();
    });
  });
});
