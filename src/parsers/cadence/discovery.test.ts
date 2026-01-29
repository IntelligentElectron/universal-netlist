/**
 * Comprehensive tests for Cadence design discovery with subtree-scoped matching.
 *
 * Tests cover:
 * - Basic cases (same directory, subdirectory, nested subdirectory)
 * - Multiple projects isolation (sibling projects don't cross-match)
 * - Multiple designs in same directory (name-based tiebreaking)
 * - Edge cases (missing files, incomplete sets, orphan dats, case insensitivity)
 * - Real-world structures (BeagleBone style, Cadence HDL style)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "fs/promises";
import { join } from "path";
import { discoverCadenceDesigns, findCadenceDatFiles } from "./discovery.js";

describe("Cadence Discovery - Subtree Scoped Matching", () => {
  const testDir = join(__dirname, "__test-cadence-discovery__");

  /**
   * Helper to create a complete .dat file set in a directory.
   */
  async function createDatFiles(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "pstxnet.dat"), "test-content");
    await writeFile(join(dir, "pstxprt.dat"), "test-content");
    await writeFile(join(dir, "pstchip.dat"), "test-content");
  }

  /**
   * Helper to create a design file.
   */
  async function createDesign(filePath: string): Promise<void> {
    await mkdir(join(filePath, ".."), { recursive: true });
    await writeFile(filePath, "");
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

  describe("Basic Cases", () => {
    it("should match .dat files in the SAME directory as design", async () => {
      // Structure:
      // project/
      // ├── Design.DSN
      // ├── pstxnet.dat
      // ├── pstxprt.dat
      // └── pstchip.dat
      const projectDir = join(testDir, "project");
      await createDesign(join(projectDir, "Design.DSN"));
      await createDatFiles(projectDir);

      const designs = await discoverCadenceDesigns(testDir);

      expect(designs).toHaveLength(1);
      expect(designs[0]).toMatchObject({
        name: "Design",
        format: "cadence-cis",
        sourcePath: join(projectDir, "Design.DSN"),
      });
      expect(designs[0].datFiles?.pstxnet).toBe(
        join(projectDir, "pstxnet.dat"),
      );
      expect(designs[0].datFiles?.pstxprt).toBe(
        join(projectDir, "pstxprt.dat"),
      );
      expect(designs[0].datFiles?.pstchip).toBe(
        join(projectDir, "pstchip.dat"),
      );
      expect(designs[0].error).toBeUndefined();
    });

    it("should match .dat files in an IMMEDIATE subdirectory (arbitrary name)", async () => {
      // Structure:
      // project/
      // ├── BEAGLEBONEBLK_C.DSN
      // └── allegro/          <- arbitrary name, NOT design name
      //     ├── pstxnet.dat
      //     ├── pstxprt.dat
      //     └── pstchip.dat
      const projectDir = join(testDir, "project");
      await createDesign(join(projectDir, "BEAGLEBONEBLK_C.DSN"));
      await createDatFiles(join(projectDir, "allegro"));

      const designs = await discoverCadenceDesigns(testDir);

      expect(designs).toHaveLength(1);
      expect(designs[0].name).toBe("BEAGLEBONEBLK_C");
      expect(designs[0].datFiles?.pstxnet).toBe(
        join(projectDir, "allegro", "pstxnet.dat"),
      );
      expect(designs[0].error).toBeUndefined();
    });

    it("should match .dat files in a NESTED subdirectory (convention-based path)", async () => {
      // Structure:
      // project/
      // ├── hush.cpm
      // └── worklib/
      //     └── hush/
      //         └── packaged/
      //             ├── pstxnet.dat
      //             ├── pstxprt.dat
      //             └── pstchip.dat
      const projectDir = join(testDir, "project");
      await createDesign(join(projectDir, "hush.cpm"));
      await createDatFiles(join(projectDir, "worklib", "hush", "packaged"));

      const designs = await discoverCadenceDesigns(testDir);

      expect(designs).toHaveLength(1);
      expect(designs[0].name).toBe("hush");
      expect(designs[0].format).toBe("cadence-hdl");
      expect(designs[0].datFiles?.pstxnet).toBe(
        join(projectDir, "worklib", "hush", "packaged", "pstxnet.dat"),
      );
      expect(designs[0].error).toBeUndefined();
    });

    it("should match .dat files in deeply nested output directory", async () => {
      // Structure:
      // project/
      // ├── board.DSN
      // └── output/
      //     └── netlist/
      //         └── cadence/
      //             └── v1/
      //                 ├── pstxnet.dat
      //                 ├── pstxprt.dat
      //                 └── pstchip.dat
      const projectDir = join(testDir, "project");
      await createDesign(join(projectDir, "board.DSN"));
      await createDatFiles(
        join(projectDir, "output", "netlist", "cadence", "v1"),
      );

      const designs = await discoverCadenceDesigns(testDir);

      expect(designs).toHaveLength(1);
      expect(designs[0].name).toBe("board");
      expect(designs[0].datFiles?.pstxnet).toBe(
        join(projectDir, "output", "netlist", "cadence", "v1", "pstxnet.dat"),
      );
      expect(designs[0].error).toBeUndefined();
    });
  });

  describe("Multiple Projects Isolation", () => {
    it("should correctly isolate .dat files to their respective projects", async () => {
      // Structure:
      // root/
      // ├── projectA/
      // │   ├── DesignA.DSN
      // │   └── output/
      // │       └── *.dat
      // └── projectB/
      //     ├── DesignB.cpm
      //     └── netlist/
      //         └── *.dat
      const projectA = join(testDir, "projectA");
      const projectB = join(testDir, "projectB");

      await createDesign(join(projectA, "DesignA.DSN"));
      await createDatFiles(join(projectA, "output"));

      await createDesign(join(projectB, "DesignB.cpm"));
      await createDatFiles(join(projectB, "netlist"));

      const designs = await discoverCadenceDesigns(testDir);

      expect(designs).toHaveLength(2);

      const designA = designs.find((d) => d.name === "DesignA");
      const designB = designs.find((d) => d.name === "DesignB");

      expect(designA).toBeDefined();
      expect(designB).toBeDefined();

      // Each design should have its own .dat files, not cross-matched
      expect(designA!.datFiles?.pstxnet).toContain("projectA");
      expect(designB!.datFiles?.pstxnet).toContain("projectB");

      expect(designA!.error).toBeUndefined();
      expect(designB!.error).toBeUndefined();
    });

    it("should NOT cross-match projects with similar names (path boundary check)", async () => {
      // Structure:
      // root/
      // ├── hush/
      // │   ├── hush.cpm
      // │   └── worklib/
      // │       └── *.dat
      // └── hushmore/           <- similar name, must NOT match hush's dats
      //     └── hushmore.cpm    <- should have error (no dats)
      const hushDir = join(testDir, "hush");
      const hushmoreDir = join(testDir, "hushmore");

      await createDesign(join(hushDir, "hush.cpm"));
      await createDatFiles(join(hushDir, "worklib"));

      await createDesign(join(hushmoreDir, "hushmore.cpm"));
      // No .dat files for hushmore

      const designs = await discoverCadenceDesigns(testDir);

      expect(designs).toHaveLength(2);

      const hush = designs.find((d) => d.name === "hush");
      const hushmore = designs.find((d) => d.name === "hushmore");

      expect(hush).toBeDefined();
      expect(hushmore).toBeDefined();

      // hush should have its .dat files
      expect(hush!.datFiles?.pstxnet).toContain("hush");
      expect(hush!.error).toBeUndefined();

      // hushmore should NOT have hush's .dat files
      expect(hushmore!.datFiles?.pstxnet).toBeNull();
      expect(hushmore!.error).toBeDefined();
    });

    it("should handle 5 projects like reference-designs folder", async () => {
      // Simulating: BeagleBone-Black-master, beaglebone-black-forked, hush, calboard_pro, kibblepro
      const projects = [
        {
          dir: "BeagleBone-Black-master",
          design: "BEAGLEBONEBLK_C.DSN",
          datDir: "allegro",
        },
        {
          dir: "beaglebone-black-forked/ALLEGRO",
          design: "BEAGLEBONEBLK_C3.DSN",
          datDir: "allegro",
        },
        { dir: "hush", design: "hush.cpm", datDir: "worklib/hush/packaged" },
        {
          dir: "calboard_pro",
          design: "calboard_pro.cpm",
          datDir: "worklib/calboard_pro/packaged",
        },
        {
          dir: "kibblepro",
          design: "kibblepro.cpm",
          datDir: "worklib/kibblepro/packaged",
        },
      ];

      for (const p of projects) {
        const projectPath = join(testDir, p.dir);
        await createDesign(join(projectPath, p.design));
        await createDatFiles(join(projectPath, p.datDir));
      }

      const designs = await discoverCadenceDesigns(testDir);

      expect(designs).toHaveLength(5);

      // Each should have its own .dat files
      for (const design of designs) {
        expect(design.error).toBeUndefined();
        expect(design.datFiles?.pstxnet).toBeDefined();
        expect(design.datFiles?.pstxprt).toBeDefined();
        expect(design.datFiles?.pstchip).toBeDefined();
      }

      // Verify specific projects
      const beagle1 = designs.find((d) => d.name === "BEAGLEBONEBLK_C");
      const beagle2 = designs.find((d) => d.name === "BEAGLEBONEBLK_C3");
      const hush = designs.find((d) => d.name === "hush");

      expect(beagle1!.datFiles?.pstxnet).toContain("BeagleBone-Black-master");
      expect(beagle2!.datFiles?.pstxnet).toContain("beaglebone-black-forked");
      expect(hush!.datFiles?.pstxnet).toContain("hush");
    });
  });

  describe("Multiple Designs in Same Directory", () => {
    it("should match designs to .dat sets by name when both exist", async () => {
      // Structure:
      // project/
      // ├── hush.cpm
      // ├── hush_v1p5.cpm
      // └── worklib/
      //     ├── hush/
      //     │   └── packaged/
      //     │       └── *.dat
      //     └── hush_v1p5/
      //         └── packaged/
      //             └── *.dat
      const projectDir = join(testDir, "project");
      await createDesign(join(projectDir, "hush.cpm"));
      await createDesign(join(projectDir, "hush_v1p5.cpm"));
      await createDatFiles(join(projectDir, "worklib", "hush", "packaged"));
      await createDatFiles(
        join(projectDir, "worklib", "hush_v1p5", "packaged"),
      );

      const designs = await discoverCadenceDesigns(testDir);

      expect(designs).toHaveLength(2);

      const hush = designs.find((d) => d.name === "hush");
      const hushV1p5 = designs.find((d) => d.name === "hush_v1p5");

      expect(hush).toBeDefined();
      expect(hushV1p5).toBeDefined();

      // Each should match by name
      expect(hush!.datFiles?.pstxnet).toContain(
        join("worklib", "hush", "packaged"),
      );
      expect(hushV1p5!.datFiles?.pstxnet).toContain(
        join("worklib", "hush_v1p5", "packaged"),
      );

      expect(hush!.error).toBeUndefined();
      expect(hushV1p5!.error).toBeUndefined();
    });

    it("should prefer name-matching over proximity when resolving conflicts", async () => {
      // Structure:
      // project/
      // ├── alpha.cpm
      // ├── beta.cpm
      // └── output/
      //     ├── alpha/      <- should match alpha.cpm by name
      //     │   └── *.dat
      //     └── beta/       <- should match beta.cpm by name
      //         └── *.dat
      const projectDir = join(testDir, "project");
      await createDesign(join(projectDir, "alpha.cpm"));
      await createDesign(join(projectDir, "beta.cpm"));
      await createDatFiles(join(projectDir, "output", "alpha"));
      await createDatFiles(join(projectDir, "output", "beta"));

      const designs = await discoverCadenceDesigns(testDir);

      expect(designs).toHaveLength(2);

      const alpha = designs.find((d) => d.name === "alpha");
      const beta = designs.find((d) => d.name === "beta");

      expect(alpha!.datFiles?.pstxnet).toContain(join("output", "alpha"));
      expect(beta!.datFiles?.pstxnet).toContain(join("output", "beta"));
    });

    it("should assign single .dat set to best matching design when only one exists", async () => {
      // Structure:
      // project/
      // ├── hush.cpm
      // ├── hush_v1p5.cpm
      // └── worklib/
      //     └── hush/           <- only one .dat set, matches "hush" by name
      //         └── packaged/
      //             └── *.dat
      const projectDir = join(testDir, "project");
      await createDesign(join(projectDir, "hush.cpm"));
      await createDesign(join(projectDir, "hush_v1p5.cpm"));
      await createDatFiles(join(projectDir, "worklib", "hush", "packaged"));

      const designs = await discoverCadenceDesigns(testDir);

      expect(designs).toHaveLength(2);

      const hush = designs.find((d) => d.name === "hush");
      const hushV1p5 = designs.find((d) => d.name === "hush_v1p5");

      // hush should get the .dat files (name match)
      expect(hush!.datFiles?.pstxnet).toBeDefined();
      expect(hush!.error).toBeUndefined();

      // hush_v1p5 should not have .dat files
      expect(hushV1p5!.datFiles?.pstxnet).toBeNull();
      expect(hushV1p5!.error).toBeDefined();
    });

    it("should use proximity when names dont match any candidate", async () => {
      // Structure:
      // project/
      // ├── DesignA.cpm
      // ├── DesignB.cpm
      // └── output/              <- generic name, no name match
      //     └── *.dat
      const projectDir = join(testDir, "project");
      await createDesign(join(projectDir, "DesignA.cpm"));
      await createDesign(join(projectDir, "DesignB.cpm"));
      await createDatFiles(join(projectDir, "output"));

      const designs = await discoverCadenceDesigns(testDir);

      expect(designs).toHaveLength(2);

      // One should get the .dat files (first processed or by proximity)
      const withDat = designs.filter((d) => d.datFiles?.pstxnet !== null);
      const withoutDat = designs.filter((d) => d.datFiles?.pstxnet === null);

      expect(withDat).toHaveLength(1);
      expect(withoutDat).toHaveLength(1);
    });

    it("should NOT match based on project folder name in absolute path", async () => {
      // This is a critical edge case: if project folder is named "hush" and contains
      // designs "hush.cpm" and "hush_v1p5.cpm", the name matching should use
      // RELATIVE paths, not absolute paths.
      //
      // Structure:
      // hush/                     <- project folder named "hush"
      // ├── hush.cpm              <- should match worklib/hush/
      // ├── hush_v1p5.cpm         <- should match hush_v1p5/hush_v1p5/
      // ├── worklib/
      // │   └── hush/
      // │       └── packaged/
      // │           └── *.dat
      // └── hush_v1p5/
      //     └── hush_v1p5/
      //         └── packaged/
      //             └── *.dat
      const projectDir = join(testDir, "hush"); // Project folder named "hush"
      await createDesign(join(projectDir, "hush.cpm"));
      await createDesign(join(projectDir, "hush_v1p5.cpm"));
      await createDatFiles(join(projectDir, "worklib", "hush", "packaged"));
      await createDatFiles(
        join(projectDir, "hush_v1p5", "hush_v1p5", "packaged"),
      );

      const designs = await discoverCadenceDesigns(testDir);

      expect(designs).toHaveLength(2);

      const hush = designs.find((d) => d.name === "hush");
      const hushV1p5 = designs.find((d) => d.name === "hush_v1p5");

      expect(hush).toBeDefined();
      expect(hushV1p5).toBeDefined();

      // hush.cpm should match worklib/hush/packaged (relative path contains "hush")
      expect(hush!.datFiles?.pstxnet).toContain(
        join("worklib", "hush", "packaged"),
      );
      expect(hush!.error).toBeUndefined();

      // hush_v1p5.cpm should match hush_v1p5/hush_v1p5/packaged (relative path contains "hush_v1p5")
      expect(hushV1p5!.datFiles?.pstxnet).toContain(
        join("hush_v1p5", "hush_v1p5", "packaged"),
      );
      expect(hushV1p5!.error).toBeUndefined();
    });
  });

  describe("Edge Cases", () => {
    it("should mark design as not exported when no .dat files exist", async () => {
      const projectDir = join(testDir, "project");
      await createDesign(join(projectDir, "board.DSN"));
      // No .dat files

      const designs = await discoverCadenceDesigns(testDir);

      expect(designs).toHaveLength(1);
      expect(designs[0].name).toBe("board");
      expect(designs[0].datFiles?.pstxnet).toBeNull();
      expect(designs[0].datFiles?.pstxprt).toBeNull();
      expect(designs[0].datFiles?.pstchip).toBeNull();
      expect(designs[0].error).toBeDefined();
      expect(designs[0].error).toContain("not exported");
    });

    it("should ignore INCOMPLETE .dat file sets (missing required files)", async () => {
      const projectDir = join(testDir, "project");
      await createDesign(join(projectDir, "board.DSN"));

      // Only create 2 of 3 required files
      const datDir = join(projectDir, "output");
      await mkdir(datDir, { recursive: true });
      await writeFile(join(datDir, "pstxnet.dat"), "test");
      await writeFile(join(datDir, "pstxprt.dat"), "test");
      // Missing pstchip.dat

      const designs = await discoverCadenceDesigns(testDir);

      expect(designs).toHaveLength(1);
      expect(designs[0].datFiles?.pstxnet).toBeNull();
      expect(designs[0].error).toBeDefined();
    });

    it("should ignore orphan .dat files with no design", async () => {
      // .dat files exist but no design file
      const orphanDir = join(testDir, "orphan");
      await createDatFiles(orphanDir);

      const designs = await discoverCadenceDesigns(testDir);

      expect(designs).toHaveLength(0);
    });

    it("should handle CASE INSENSITIVE design name matching in paths", async () => {
      // Structure:
      // project/
      // ├── MyDesign.DSN
      // └── worklib/
      //     └── MYDESIGN/      <- uppercase, should still match
      //         └── *.dat
      const projectDir = join(testDir, "project");
      await createDesign(join(projectDir, "MyDesign.DSN"));
      await createDatFiles(join(projectDir, "worklib", "MYDESIGN"));

      const designs = await discoverCadenceDesigns(testDir);

      expect(designs).toHaveLength(1);
      expect(designs[0].name).toBe("MyDesign");
      expect(designs[0].datFiles?.pstxnet).toBeDefined();
      expect(designs[0].error).toBeUndefined();
    });

    it("should handle mixed case .dat file names", async () => {
      const projectDir = join(testDir, "project");
      await createDesign(join(projectDir, "board.DSN"));

      // Create .dat files with mixed case
      const datDir = join(projectDir, "output");
      await mkdir(datDir, { recursive: true });
      await writeFile(join(datDir, "PSTXNET.DAT"), "test");
      await writeFile(join(datDir, "PstXprt.Dat"), "test");
      await writeFile(join(datDir, "pstchip.dat"), "test");

      const designs = await discoverCadenceDesigns(testDir);

      expect(designs).toHaveLength(1);
      expect(designs[0].datFiles?.pstxnet).toBeDefined();
      expect(designs[0].error).toBeUndefined();
    });

    it("should return empty array for directory with no Cadence files", async () => {
      // Just create some random files
      await writeFile(join(testDir, "readme.txt"), "hello");
      await writeFile(join(testDir, "config.json"), "{}");

      const designs = await discoverCadenceDesigns(testDir);

      expect(designs).toHaveLength(0);
    });

    it("should handle paths with forward slashes (cross-platform)", async () => {
      // This tests that path normalization works - agents may provide paths with
      // forward slashes even on Windows (e.g., "C:/Users/foo/bar")
      const projectDir = join(testDir, "project");
      await createDesign(join(projectDir, "board.DSN"));
      await createDatFiles(join(projectDir, "output"));

      // Use forward slashes in the path (simulating what an agent might provide)
      const pathWithForwardSlashes = testDir.split(/[\\/]/).join("/");
      const designs = await discoverCadenceDesigns(pathWithForwardSlashes);

      expect(designs).toHaveLength(1);
      expect(designs[0].datFiles?.pstxnet).toBeDefined();
      expect(designs[0].error).toBeUndefined();
    });

    it("should handle paths with backslashes on Unix (cross-platform)", async () => {
      // This tests that path normalization works - agents may provide paths with
      // backslashes even on macOS/Linux (e.g., "\\Users\\foo\\bar")
      const projectDir = join(testDir, "project");
      await createDesign(join(projectDir, "board.DSN"));
      await createDatFiles(join(projectDir, "output"));

      // Use backslashes in the path (simulating what an agent might provide)
      const pathWithBackslashes = testDir.split(/[\\/]/).join("\\");
      const designs = await discoverCadenceDesigns(pathWithBackslashes);

      expect(designs).toHaveLength(1);
      expect(designs[0].datFiles?.pstxnet).toBeDefined();
      expect(designs[0].error).toBeUndefined();
    });

    it("should handle design file in nested subdirectory", async () => {
      // Structure:
      // root/
      // └── deep/
      //     └── nested/
      //         └── project/
      //             ├── board.DSN
      //             └── output/
      //                 └── *.dat
      const projectDir = join(testDir, "deep", "nested", "project");
      await createDesign(join(projectDir, "board.DSN"));
      await createDatFiles(join(projectDir, "output"));

      const designs = await discoverCadenceDesigns(testDir);

      expect(designs).toHaveLength(1);
      expect(designs[0].datFiles?.pstxnet).toBeDefined();
      expect(designs[0].error).toBeUndefined();
    });
  });

  describe("Real-World Structures", () => {
    it("should handle BeagleBone style: .DSN with allegro/ output folder", async () => {
      // Exact structure from BeagleBone-Black-master
      const projectDir = join(testDir, "BeagleBone-Black-master");
      await createDesign(join(projectDir, "BEAGLEBONEBLK_C.DSN"));
      await createDatFiles(join(projectDir, "allegro"));

      const designs = await discoverCadenceDesigns(testDir);

      expect(designs).toHaveLength(1);
      expect(designs[0].name).toBe("BEAGLEBONEBLK_C");
      expect(designs[0].format).toBe("cadence-cis");
      expect(designs[0].datFiles?.pstxnet).toContain("allegro");
      expect(designs[0].error).toBeUndefined();
    });

    it("should handle nested ALLEGRO folder structure", async () => {
      // Exact structure from beaglebone-black-forked
      const projectDir = join(testDir, "beaglebone-black-forked", "ALLEGRO");
      await createDesign(join(projectDir, "BEAGLEBONEBLK_C3.DSN"));
      await createDatFiles(join(projectDir, "allegro"));

      const designs = await discoverCadenceDesigns(testDir);

      expect(designs).toHaveLength(1);
      expect(designs[0].name).toBe("BEAGLEBONEBLK_C3");
      expect(designs[0].datFiles?.pstxnet).toContain(
        join("ALLEGRO", "allegro"),
      );
      expect(designs[0].error).toBeUndefined();
    });

    it("should handle Cadence HDL style with worklib structure", async () => {
      // Exact structure from hush project
      const projectDir = join(testDir, "hush");
      await createDesign(join(projectDir, "hush.cpm"));
      await createDatFiles(join(projectDir, "worklib", "hush", "packaged"));

      const designs = await discoverCadenceDesigns(testDir);

      expect(designs).toHaveLength(1);
      expect(designs[0].name).toBe("hush");
      expect(designs[0].format).toBe("cadence-hdl");
      expect(designs[0].datFiles?.pstxnet).toContain(
        join("worklib", "hush", "packaged"),
      );
      expect(designs[0].error).toBeUndefined();
    });
  });

  describe("findCadenceDatFiles function", () => {
    it("should find .dat files for a specific design file", async () => {
      const projectDir = join(testDir, "project");
      const designPath = join(projectDir, "board.DSN");
      await createDesign(designPath);
      await createDatFiles(join(projectDir, "output"));

      const datFiles = await findCadenceDatFiles(designPath);

      expect(datFiles.pstxnet).toBe(join(projectDir, "output", "pstxnet.dat"));
      expect(datFiles.pstxprt).toBe(join(projectDir, "output", "pstxprt.dat"));
      expect(datFiles.pstchip).toBe(join(projectDir, "output", "pstchip.dat"));
    });

    it("should return nulls when no .dat files exist", async () => {
      const projectDir = join(testDir, "project");
      const designPath = join(projectDir, "board.DSN");
      await createDesign(designPath);

      const datFiles = await findCadenceDatFiles(designPath);

      expect(datFiles.pstxnet).toBeNull();
      expect(datFiles.pstxprt).toBeNull();
      expect(datFiles.pstchip).toBeNull();
    });

    it("should find .dat files in same directory as design", async () => {
      const projectDir = join(testDir, "project");
      const designPath = join(projectDir, "board.DSN");
      await createDesign(designPath);
      await createDatFiles(projectDir);

      const datFiles = await findCadenceDatFiles(designPath);

      expect(datFiles.pstxnet).toBe(join(projectDir, "pstxnet.dat"));
    });
  });
});
