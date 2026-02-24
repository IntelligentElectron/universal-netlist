/**
 * Tests for Altium design discovery edge cases.
 *
 * The shared discovery.test.ts covers basic Altium scenarios.
 * These tests focus on parsing edge cases specific to Altium project files.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "fs/promises";
import { join } from "path";
import { discoverAltiumDesigns, findAltiumSchDocs } from "./discovery.js";

describe("Altium Discovery - Project File Parsing", () => {
  const testDir = join(__dirname, "__test-altium-discovery__");
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

  describe("DocumentPath parsing", () => {
    it("should handle quoted paths in project file", async () => {
      const projectDir = join(testDir, "project");
      await mkdir(projectDir, { recursive: true });

      await writeFile(
        join(projectDir, "board.PrjPcb"),
        ["[Document1]", 'DocumentPath="Schematics\\sheet1.SchDoc"'].join("\n")
      );
      await mkdir(join(projectDir, "Schematics"), { recursive: true });
      await writeOleSchDoc(join(projectDir, "Schematics", "sheet1.SchDoc"));

      const designs = await discoverAltiumDesigns(testDir);

      expect(designs).toHaveLength(1);
      expect(designs[0].schdocPaths).toHaveLength(1);
      expect(designs[0].schdocPaths[0]).toBe(join(projectDir, "Schematics", "sheet1.SchDoc"));
    });

    it("should extract path before pipe metadata separator", async () => {
      // Altium project files can have metadata after the path: DocumentPath=path|metadata
      const projectDir = join(testDir, "project");
      await mkdir(projectDir, { recursive: true });

      await writeFile(
        join(projectDir, "board.PrjPcb"),
        ["[Document1]", "DocumentPath=sheet1.SchDoc|DocumentState=Editor"].join("\n")
      );
      await writeOleSchDoc(join(projectDir, "sheet1.SchDoc"));

      const designs = await discoverAltiumDesigns(testDir);

      expect(designs).toHaveLength(1);
      expect(designs[0].schdocPaths).toHaveLength(1);
    });

    it("should skip absolute Windows paths", async () => {
      const projectDir = join(testDir, "project");
      await mkdir(projectDir, { recursive: true });

      await writeFile(
        join(projectDir, "board.PrjPcb"),
        [
          "[Document1]",
          "DocumentPath=C:\\Users\\dev\\old_project\\sheet1.SchDoc",
          "[Document2]",
          "DocumentPath=relative\\sheet2.SchDoc",
        ].join("\n")
      );
      await mkdir(join(projectDir, "relative"), { recursive: true });
      await writeOleSchDoc(join(projectDir, "relative", "sheet2.SchDoc"));

      const designs = await discoverAltiumDesigns(testDir);

      expect(designs).toHaveLength(1);
      // Should only have the relative path, not the absolute one
      expect(designs[0].schdocPaths).toHaveLength(1);
      expect(designs[0].schdocPaths[0]).toContain("sheet2.SchDoc");
    });

    it("should skip absolute Unix paths", async () => {
      const projectDir = join(testDir, "project");
      await mkdir(projectDir, { recursive: true });

      await writeFile(
        join(projectDir, "board.PrjPcb"),
        [
          "[Document1]",
          "DocumentPath=/home/dev/old_project/sheet1.SchDoc",
          "[Document2]",
          "DocumentPath=local/sheet2.SchDoc",
        ].join("\n")
      );
      await mkdir(join(projectDir, "local"), { recursive: true });
      await writeOleSchDoc(join(projectDir, "local", "sheet2.SchDoc"));

      const designs = await discoverAltiumDesigns(testDir);

      expect(designs).toHaveLength(1);
      expect(designs[0].schdocPaths).toHaveLength(1);
      expect(designs[0].schdocPaths[0]).toContain("sheet2.SchDoc");
    });

    it("should convert Windows backslashes to forward slashes", async () => {
      const projectDir = join(testDir, "project");
      const schDir = join(projectDir, "Hardware", "Schematics");
      await mkdir(schDir, { recursive: true });

      await writeFile(
        join(projectDir, "board.PrjPcb"),
        ["[Document1]", "DocumentPath=Hardware\\Schematics\\main.SchDoc"].join("\n")
      );
      await writeOleSchDoc(join(schDir, "main.SchDoc"));

      const designs = await discoverAltiumDesigns(testDir);

      expect(designs).toHaveLength(1);
      expect(designs[0].schdocPaths).toHaveLength(1);
      expect(designs[0].schdocPaths[0]).toBe(join(schDir, "main.SchDoc"));
    });

    it("should deduplicate SchDoc paths listed multiple times", async () => {
      const projectDir = join(testDir, "project");
      await mkdir(projectDir, { recursive: true });

      // Same file listed twice (can happen with project file edits)
      await writeFile(
        join(projectDir, "board.PrjPcb"),
        [
          "[Document1]",
          "DocumentPath=sheet1.SchDoc",
          "[Document2]",
          "DocumentPath=sheet1.SchDoc",
        ].join("\n")
      );
      await writeOleSchDoc(join(projectDir, "sheet1.SchDoc"));

      const designs = await discoverAltiumDesigns(testDir);

      expect(designs).toHaveLength(1);
      expect(designs[0].schdocPaths).toHaveLength(1);
    });

    it("should sort SchDoc paths alphabetically", async () => {
      const projectDir = join(testDir, "project");
      await mkdir(projectDir, { recursive: true });

      await writeFile(
        join(projectDir, "board.PrjPcb"),
        [
          "[Document1]",
          "DocumentPath=zpower.SchDoc",
          "[Document2]",
          "DocumentPath=amain.SchDoc",
          "[Document3]",
          "DocumentPath=mcontrol.SchDoc",
        ].join("\n")
      );
      await writeOleSchDoc(join(projectDir, "zpower.SchDoc"));
      await writeOleSchDoc(join(projectDir, "amain.SchDoc"));
      await writeOleSchDoc(join(projectDir, "mcontrol.SchDoc"));

      const designs = await discoverAltiumDesigns(testDir);

      expect(designs).toHaveLength(1);
      expect(designs[0].schdocPaths).toHaveLength(3);
      expect(designs[0].schdocPaths[0]).toContain("amain.SchDoc");
      expect(designs[0].schdocPaths[1]).toContain("mcontrol.SchDoc");
      expect(designs[0].schdocPaths[2]).toContain("zpower.SchDoc");
    });
  });

  describe("Fallback SchDoc discovery", () => {
    it("should NOT fallback when multiple SchDocs exist in project directory", async () => {
      // Fallback is ambiguous with multiple candidates - should return error on project
      const projectDir = join(testDir, "project");
      await mkdir(projectDir, { recursive: true });

      // Project file references a non-existent SchDoc
      await writeFile(
        join(projectDir, "board.PrjPcb"),
        ["[Document1]", "DocumentPath=missing.SchDoc"].join("\n")
      );
      // But two valid SchDocs exist in the directory
      await writeOleSchDoc(join(projectDir, "sheet1.SchDoc"));
      await writeOleSchDoc(join(projectDir, "sheet2.SchDoc"));

      const designs = await discoverAltiumDesigns(testDir);

      // Project + 2 orphaned SchDocs
      expect(designs).toHaveLength(3);

      const projectDesign = designs.find((d) => d.name === "board");
      expect(projectDesign).toBeDefined();
      expect(projectDesign!.error).toBeDefined();
      expect(projectDesign!.schdocPaths).toHaveLength(0);

      // The unclaimed SchDocs appear as standalone entries
      const orphans = designs.filter((d) => d.error?.includes("Standalone"));
      expect(orphans).toHaveLength(2);
    });

    it("should fallback to single SchDoc in subdirectory of project", async () => {
      const projectDir = join(testDir, "project");
      const schDir = join(projectDir, "Schematics");
      await mkdir(schDir, { recursive: true });

      // Project file references non-existent SchDoc
      await writeFile(
        join(projectDir, "board.PrjPcb"),
        ["[Document1]", "DocumentPath=wrong_path.SchDoc"].join("\n")
      );
      // Single valid SchDoc in subdirectory
      await writeOleSchDoc(join(schDir, "main.SchDoc"));

      const designs = await discoverAltiumDesigns(testDir);

      expect(designs).toHaveLength(1);
      expect(designs[0].schdocPaths).toHaveLength(1);
      expect(designs[0].schdocPaths[0]).toBe(join(schDir, "main.SchDoc"));
      expect(designs[0].error).toBeUndefined();
    });
  });

  describe("findAltiumSchDocs function", () => {
    it("should find SchDocs for a specific project file", async () => {
      const projectDir = join(testDir, "project");
      await mkdir(projectDir, { recursive: true });

      const projectPath = join(projectDir, "board.PrjPcb");
      await writeFile(projectPath, ["[Document1]", "DocumentPath=sheet1.SchDoc"].join("\n"));
      await writeOleSchDoc(join(projectDir, "sheet1.SchDoc"));

      const schdocs = await findAltiumSchDocs(projectPath);

      expect(schdocs).toHaveLength(1);
      expect(schdocs[0]).toBe(join(projectDir, "sheet1.SchDoc"));
    });

    it("should use fallback when project file has no valid SchDoc references", async () => {
      const projectDir = join(testDir, "project");
      await mkdir(projectDir, { recursive: true });

      const projectPath = join(projectDir, "board.PrjPcb");
      // Empty project file
      await writeFile(projectPath, "[Design Info]");
      // Single SchDoc in directory
      await writeOleSchDoc(join(projectDir, "only.SchDoc"));

      const schdocs = await findAltiumSchDocs(projectPath);

      expect(schdocs).toHaveLength(1);
      expect(schdocs[0]).toBe(join(projectDir, "only.SchDoc"));
    });
  });

  describe("Standalone SchDoc discovery", () => {
    it("should discover orphaned SchDoc with no project file in tree", async () => {
      const orphanDir = join(testDir, "loose");
      await mkdir(orphanDir, { recursive: true });
      await writeOleSchDoc(join(orphanDir, "standalone.SchDoc"));

      const designs = await discoverAltiumDesigns(testDir);

      expect(designs).toHaveLength(1);
      expect(designs[0].name).toBe("standalone");
      expect(designs[0].sourcePath).toBe(join(orphanDir, "standalone.SchDoc"));
      expect(designs[0].schdocPaths).toEqual([join(orphanDir, "standalone.SchDoc")]);
      expect(designs[0].error).toContain("Standalone");
    });

    it("should NOT duplicate SchDoc referenced by a project", async () => {
      const projectDir = join(testDir, "project");
      await mkdir(projectDir, { recursive: true });

      await writeFile(
        join(projectDir, "board.PrjPcb"),
        ["[Document1]", "DocumentPath=sheet1.SchDoc"].join("\n")
      );
      await writeOleSchDoc(join(projectDir, "sheet1.SchDoc"));

      const designs = await discoverAltiumDesigns(testDir);

      expect(designs).toHaveLength(1);
      expect(designs[0].name).toBe("board");
      expect(designs[0].error).toBeUndefined();
    });

    it("should handle mixed scenario: project + orphaned SchDoc", async () => {
      const projectDir = join(testDir, "project");
      const looseDir = join(testDir, "loose");
      await mkdir(projectDir, { recursive: true });
      await mkdir(looseDir, { recursive: true });

      await writeFile(
        join(projectDir, "board.PrjPcb"),
        ["[Document1]", "DocumentPath=sheet1.SchDoc"].join("\n")
      );
      await writeOleSchDoc(join(projectDir, "sheet1.SchDoc"));
      await writeOleSchDoc(join(looseDir, "orphan.SchDoc"));

      const designs = await discoverAltiumDesigns(testDir);

      expect(designs).toHaveLength(2);

      const projectDesign = designs.find((d) => d.name === "board");
      const orphanDesign = designs.find((d) => d.name === "orphan");

      expect(projectDesign).toBeDefined();
      expect(projectDesign!.error).toBeUndefined();
      expect(orphanDesign).toBeDefined();
      expect(orphanDesign!.error).toContain("Standalone");
    });

    it("should NOT list SchDoc claimed via fallback as orphan", async () => {
      const projectDir = join(testDir, "project");
      await mkdir(projectDir, { recursive: true });

      // Project references a missing file, but a single SchDoc in the dir triggers fallback
      await writeFile(
        join(projectDir, "board.PrjPcb"),
        ["[Document1]", "DocumentPath=missing.SchDoc"].join("\n")
      );
      await writeOleSchDoc(join(projectDir, "actual.SchDoc"));

      const designs = await discoverAltiumDesigns(testDir);

      expect(designs).toHaveLength(1);
      expect(designs[0].name).toBe("board");
      expect(designs[0].schdocPaths).toHaveLength(1);
      expect(designs[0].schdocPaths[0]).toContain("actual.SchDoc");
      // Should NOT have a standalone error since it was claimed by fallback
      expect(designs[0].error).toBeUndefined();
    });
  });

  describe("OLE format validation", () => {
    it("should reject text-based SchDoc files (ASCII format)", async () => {
      const projectDir = join(testDir, "project");
      await mkdir(projectDir, { recursive: true });

      await writeFile(
        join(projectDir, "board.PrjPcb"),
        ["[Document1]", "DocumentPath=sheet1.SchDoc"].join("\n")
      );
      // Write ASCII-format SchDoc (older Altium format)
      await writeFile(
        join(projectDir, "sheet1.SchDoc"),
        "|HEADER=Protel for Windows - Schematic Capture Binary File Version 5.0|"
      );

      const designs = await discoverAltiumDesigns(testDir);

      expect(designs).toHaveLength(1);
      expect(designs[0].schdocPaths).toHaveLength(0);
      expect(designs[0].error).toBeDefined();
    });

    it("should reject truncated files that are too small for OLE header", async () => {
      const projectDir = join(testDir, "project");
      await mkdir(projectDir, { recursive: true });

      await writeFile(
        join(projectDir, "board.PrjPcb"),
        ["[Document1]", "DocumentPath=sheet1.SchDoc"].join("\n")
      );
      // Write truncated file (less than 8 bytes)
      await writeFile(join(projectDir, "sheet1.SchDoc"), "tiny");

      const designs = await discoverAltiumDesigns(testDir);

      expect(designs).toHaveLength(1);
      expect(designs[0].schdocPaths).toHaveLength(0);
      expect(designs[0].error).toBeDefined();
    });
  });
});
