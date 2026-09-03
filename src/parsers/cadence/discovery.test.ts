/**
 * Comprehensive tests for Cadence design discovery with subtree-scoped matching.
 *
 * Tests cover:
 * - Basic cases (same directory, subdirectory, nested subdirectory)
 * - Multiple projects isolation (sibling projects don't cross-match)
 * - Multiple designs in same directory (name-based tiebreaking)
 * - Edge cases (missing files, incomplete sets, orphan dats, case insensitivity)
 * - Real-world structures (.DSN with an output folder, Cadence HDL style)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm, chmod } from "fs/promises";
import { join } from "path";
import { discoverCadenceDesigns, findCadenceDatFiles, isCadenceFile } from "./discovery.js";

describe("Cadence Discovery - Subtree Scoped Matching", () => {
  const testDir = join(__dirname, "__test-cadence-discovery__");

  /**
   * Helper to create a complete .dat file set in a directory.
   * Optionally accepts a ROOT_DRAWING name to embed in pstxprt.dat DIRECTIVES.
   */
  async function createDatFiles(dir: string, rootDrawing?: string): Promise<void> {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "pstxnet.dat"), "test-content");
    const pstxprtContent = rootDrawing
      ? `DIRECTIVES\n ROOT_DRAWING='${rootDrawing}';\nEND_DIRECTIVES;\n`
      : "test-content";
    await writeFile(join(dir, "pstxprt.dat"), pstxprtContent);
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
      expect(designs[0].datFiles?.pstxnet).toBe(join(projectDir, "pstxnet.dat"));
      expect(designs[0].datFiles?.pstxprt).toBe(join(projectDir, "pstxprt.dat"));
      expect(designs[0].datFiles?.pstchip).toBe(join(projectDir, "pstchip.dat"));
      expect(designs[0].error).toBeUndefined();
    });

    it("should match .dat files in an IMMEDIATE subdirectory (arbitrary name)", async () => {
      // Structure:
      // project/
      // ├── BOARD_TOP_A.DSN
      // └── allegro/          <- arbitrary name, NOT design name
      //     ├── pstxnet.dat
      //     ├── pstxprt.dat
      //     └── pstchip.dat
      const projectDir = join(testDir, "project");
      await createDesign(join(projectDir, "BOARD_TOP_A.DSN"));
      await createDatFiles(join(projectDir, "allegro"));

      const designs = await discoverCadenceDesigns(testDir);

      expect(designs).toHaveLength(1);
      expect(designs[0].name).toBe("BOARD_TOP_A");
      expect(designs[0].datFiles?.pstxnet).toBe(join(projectDir, "allegro", "pstxnet.dat"));
      expect(designs[0].error).toBeUndefined();
    });

    it("should match .dat files in a NESTED subdirectory (convention-based path)", async () => {
      // Structure:
      // project/
      // ├── test_design_1.cpm
      // └── worklib/
      //     └── test_design_1/
      //         └── packaged/
      //             ├── pstxnet.dat
      //             ├── pstxprt.dat
      //             └── pstchip.dat
      const projectDir = join(testDir, "project");
      await createDesign(join(projectDir, "test_design_1.cpm"));
      await createDatFiles(join(projectDir, "worklib", "test_design_1", "packaged"));

      const designs = await discoverCadenceDesigns(testDir);

      expect(designs).toHaveLength(1);
      expect(designs[0].name).toBe("test_design_1");
      expect(designs[0].format).toBe("cadence-hdl");
      expect(designs[0].datFiles?.pstxnet).toBe(
        join(projectDir, "worklib", "test_design_1", "packaged", "pstxnet.dat")
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
      await createDatFiles(join(projectDir, "output", "netlist", "cadence", "v1"));

      const designs = await discoverCadenceDesigns(testDir);

      expect(designs).toHaveLength(1);
      expect(designs[0].name).toBe("board");
      expect(designs[0].datFiles?.pstxnet).toBe(
        join(projectDir, "output", "netlist", "cadence", "v1", "pstxnet.dat")
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
      // ├── test_design_1/
      // │   ├── test_design_1.cpm
      // │   └── worklib/
      // │       └── *.dat
      // └── test_design_2/           <- similar name, must NOT match test_design_1's dats
      //     └── test_design_2.cpm    <- should have error (no dats)
      const design1Dir = join(testDir, "test_design_1");
      const design2Dir = join(testDir, "test_design_2");

      await createDesign(join(design1Dir, "test_design_1.cpm"));
      await createDatFiles(join(design1Dir, "worklib"));

      await createDesign(join(design2Dir, "test_design_2.cpm"));
      // No .dat files for test_design_2

      const designs = await discoverCadenceDesigns(testDir);

      expect(designs).toHaveLength(2);

      const design1 = designs.find((d) => d.name === "test_design_1");
      const design2 = designs.find((d) => d.name === "test_design_2");

      expect(design1).toBeDefined();
      expect(design2).toBeDefined();

      // test_design_1 should have its .dat files
      expect(design1!.datFiles?.pstxnet).toContain("test_design_1");
      expect(design1!.error).toBeUndefined();

      // test_design_2 should NOT have test_design_1's .dat files
      expect(design2!.datFiles?.pstxnet).toBeNull();
      // No error — DSN parsing is the default path
      expect(design2!.error).toBeUndefined();
    });

    it("should handle 5 sibling projects under one root", async () => {
      // Two schematic projects plus three HDL projects, side by side.
      const projects = [
        {
          dir: "project-main",
          design: "BOARD_TOP_A.DSN",
          datDir: "allegro",
        },
        {
          dir: "project-fork/ALLEGRO",
          design: "BOARD_TOP_B.DSN",
          datDir: "allegro",
        },
        {
          dir: "test_design_3",
          design: "test_design_3.cpm",
          datDir: "worklib/test_design_3/packaged",
        },
        {
          dir: "test_design_4",
          design: "test_design_4.cpm",
          datDir: "worklib/test_design_4/packaged",
        },
        {
          dir: "test_design_5",
          design: "test_design_5.cpm",
          datDir: "worklib/test_design_5/packaged",
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
      const beagle1 = designs.find((d) => d.name === "BOARD_TOP_A");
      const beagle2 = designs.find((d) => d.name === "BOARD_TOP_B");
      const design3 = designs.find((d) => d.name === "test_design_3");

      expect(beagle1!.datFiles?.pstxnet).toContain("project-main");
      expect(beagle2!.datFiles?.pstxnet).toContain("project-fork");
      expect(design3!.datFiles?.pstxnet).toContain("test_design_3");
    });
  });

  describe("Multiple Designs in Same Directory", () => {
    it("should match designs to .dat sets by name when both exist", async () => {
      // Structure:
      // project/
      // ├── test_design_1.cpm
      // ├── test_design_1_v2.cpm
      // └── worklib/
      //     ├── test_design_1/
      //     │   └── packaged/
      //     │       └── *.dat
      //     └── test_design_1_v2/
      //         └── packaged/
      //             └── *.dat
      const projectDir = join(testDir, "project");
      await createDesign(join(projectDir, "test_design_1.cpm"));
      await createDesign(join(projectDir, "test_design_1_v2.cpm"));
      await createDatFiles(join(projectDir, "worklib", "test_design_1", "packaged"));
      await createDatFiles(join(projectDir, "worklib", "test_design_1_v2", "packaged"));

      const designs = await discoverCadenceDesigns(testDir);

      expect(designs).toHaveLength(2);

      const design1 = designs.find((d) => d.name === "test_design_1");
      const design1V2 = designs.find((d) => d.name === "test_design_1_v2");

      expect(design1).toBeDefined();
      expect(design1V2).toBeDefined();

      // Each should match by name
      expect(design1!.datFiles?.pstxnet).toContain(join("worklib", "test_design_1", "packaged"));
      expect(design1V2!.datFiles?.pstxnet).toContain(
        join("worklib", "test_design_1_v2", "packaged")
      );

      expect(design1!.error).toBeUndefined();
      expect(design1V2!.error).toBeUndefined();
    });

    it("should attribute <design>_netlist directories to their own design", async () => {
      // The layout export_cadence_netlist produces. BOARD_B's export sits one
      // level closer than BOARD_A's, so proximity alone pairs both designs
      // wrongly; only recognising the directory's name gets it right.
      // project/
      // ├── BOARD_A.DSN
      // ├── BOARD_B.DSN
      // ├── archive/BOARD_A_netlist/  *.dat
      // └── BOARD_B_netlist/          *.dat
      const projectDir = join(testDir, "project");
      await createDesign(join(projectDir, "BOARD_A.DSN"));
      await createDesign(join(projectDir, "BOARD_B.DSN"));
      await createDatFiles(join(projectDir, "archive", "BOARD_A_netlist"));
      await createDatFiles(join(projectDir, "BOARD_B_netlist"));

      const designs = await discoverCadenceDesigns(testDir);

      const a = designs.find((d) => d.name === "BOARD_A");
      const b = designs.find((d) => d.name === "BOARD_B");

      expect(a?.datFiles?.pstxnet).toContain(join("archive", "BOARD_A_netlist"));
      expect(b?.datFiles?.pstxnet).toContain("BOARD_B_netlist");
      // Neither export is left over as a standalone dat-only design.
      expect(designs).toHaveLength(2);
    });

    it("should leave a contested shared directory unassigned rather than guess", async () => {
      // Mid-migration: BOARD_A has been re-exported and the shared allegro/ they
      // used to overwrite each other in is orphaned. Nothing in the tree says
      // whose it is, and BOARD_B has never been exported, so handing it over
      // would make BOARD_B answer every query with BOARD_A's circuit.
      const projectDir = join(testDir, "project");
      await createDesign(join(projectDir, "BOARD_A.DSN"));
      await createDesign(join(projectDir, "BOARD_B.DSN"));
      await createDatFiles(join(projectDir, "allegro"));
      await createDatFiles(join(projectDir, "BOARD_A_netlist"));

      const designs = await discoverCadenceDesigns(testDir);
      const a = designs.find((d) => d.name === "BOARD_A" && d.format === "cadence-cis");
      const b = designs.find((d) => d.name === "BOARD_B");

      expect(a?.datFiles?.pstxnet).toContain("BOARD_A_netlist");
      expect(b?.datFiles?.pstxnet).toBeNull();
      // A withheld netlist says so. Silent, it looked exactly like a design that
      // had never been exported, whose remedy (run export_cadence_netlist) is
      // not the remedy for this one.
      expect(b?.error).toContain("allegro");
      expect(a?.error).toBeUndefined();

      // findCadenceDatFiles must reach the same conclusion, or the query path
      // serves a circuit list_designs says the design does not have.
      const direct = await findCadenceDatFiles(join(projectDir, "BOARD_B.DSN"));
      expect(direct.pstxnet).toBeNull();
    });

    it("should answer for a design whichever case the extension is written in", async () => {
      // Cadence writes .DSN; callers, agents and this project's own docs write
      // .dsn, and on Windows and macOS both name one file. Comparing the two
      // exactly sent every case-mismatched path down a fallback that scored the
      // directories itself, which answered with a neighbour's netlist where one
      // was reachable and with nothing where one was not.
      const projectDir = join(testDir, "project");
      await createDesign(join(projectDir, "BOARD.DSN"));
      await createDatFiles(join(projectDir, "allegro"));

      const upper = await findCadenceDatFiles(join(projectDir, "BOARD.DSN"));
      const lower = await findCadenceDatFiles(join(projectDir, "BOARD.dsn"));

      expect(upper.pstxnet).toContain("allegro");
      expect(lower.pstxnet).toBe(upper.pstxnet);
    });

    it("should not let one unreadable pstxprt.dat hide the whole tree", async () => {
      // The name in ROOT_DRAWING is a nicety, and reading it was unguarded inside
      // a Promise.all: one ACL-locked or Cadence-held file rejected discovery,
      // which rejected the Promise.all over every format handler, and a single
      // "Failed to search" replaced every design of every format in the tree.
      const projectDir = join(testDir, "project");
      await createDesign(join(projectDir, "A.DSN"));
      await createDesign(join(projectDir, "B.DSN"));
      await createDatFiles(join(projectDir, "allegro"));
      const locked = join(projectDir, "allegro", "pstxprt.dat");
      await chmod(locked, 0o000);

      try {
        const designs = await discoverCadenceDesigns(testDir);
        expect(designs.map((d) => d.name)).toEqual(expect.arrayContaining(["A", "B"]));
      } finally {
        await chmod(locked, 0o644);
      }
    });

    it("should give a _netlist directory to the design that exports it", async () => {
      // A .DSN and a .cpm sharing a stem resolve to one <stem>_netlist, and both
      // score it identically. export_cadence_netlist only accepts a .DSN, so the
      // directory is the CIS design's output; awarding it to the HDL namesake
      // left the design that had just exported with nothing, and a caller
      // following the documented loop re-exported forever.
      //
      // Both spellings, because path order alone decides this the moment the
      // preference is absent, and which way it falls is an accident of where the
      // extension's first letter sits relative to "c": upper-case .DSN happens
      // to sort first and lower-case .dsn happens to sort second.
      for (const [i, dsnName] of ["BOARD.DSN", "BOARD.dsn"].entries()) {
        const projectDir = join(testDir, `project${i}`);
        await createDesign(join(projectDir, dsnName));
        await createDesign(join(projectDir, "BOARD.cpm"));
        await createDatFiles(join(projectDir, "BOARD_netlist"), "BOARD");

        const designs = (await discoverCadenceDesigns(projectDir)).filter((d) =>
          d.sourcePath.includes(`project${i}`)
        );

        expect(designs.find((d) => d.format === "cadence-cis")?.datFiles?.pstxnet).toContain(
          "BOARD_netlist"
        );
        expect(designs.find((d) => d.format === "cadence-hdl")?.datFiles?.pstxnet).toBeNull();
      }
    });

    it("should not hand a design a netlist a design above it claims", async () => {
      // findCadenceDatFiles walks from the design's own directory, so a rival in
      // an ancestor directory is invisible to it while list_designs, walking from
      // the root it was given, can see it. Answering anyway served INNER's every
      // query from shared.DSN's circuit, with no error.
      await createDesign(join(testDir, "shared.DSN"));
      await createDesign(join(testDir, "inner", "INNER.DSN"));
      await createDatFiles(join(testDir, "inner", "shared"), "SHARED");

      const designs = await discoverCadenceDesigns(testDir);
      expect(designs.find((d) => d.name === "shared")?.datFiles?.pstxnet).toContain("shared");
      expect(designs.find((d) => d.name === "INNER")?.datFiles?.pstxnet).toBeNull();

      const direct = await findCadenceDatFiles(join(testDir, "inner", "INNER.DSN"));
      expect(direct.pstxnet).toBeNull();
    });

    it("should refuse a directory two designs name by different conventions", async () => {
      // `X_netlist/` is where export_cadence_netlist puts design X, and it is
      // also the directory named for a design called X_netlist. The export bonus
      // outranks a bare name match unconditionally, so X took X_netlist's own
      // directory and X_netlist was reported as having no netlist at all.
      const projectDir = join(testDir, "project");
      await createDesign(join(projectDir, "X.DSN"));
      await createDesign(join(projectDir, "X_netlist.DSN"));
      await createDatFiles(join(projectDir, "X_netlist"), "X");

      const designs = await discoverCadenceDesigns(testDir);

      expect(designs.find((d) => d.name === "X")?.datFiles?.pstxnet).toBeNull();
      expect(designs.find((d) => d.name === "X_netlist")?.datFiles?.pstxnet).toBeNull();
      expect(designs.find((d) => d.name === "X")?.error).toContain("X_netlist");
    });

    it("should resolve a pstxnet.dat path to its own directory", async () => {
      // list_designs hands out the pstxnet.dat for any design that has one, so
      // this is the path queries actually arrive with.
      const projectDir = join(testDir, "project");
      await createDesign(join(projectDir, "BOARD.DSN"));
      await createDatFiles(join(projectDir, "allegro"));

      const direct = await findCadenceDatFiles(join(projectDir, "allegro", "pstxnet.dat"));
      expect(direct.pstxnet).toContain(join("allegro", "pstxnet.dat"));
    });

    it("should still match a shared directory when only one design can claim it", async () => {
      // One design, one unnamed directory: nothing is contested, so the ordinary
      // proximity match still applies.
      const projectDir = join(testDir, "project");
      await createDesign(join(projectDir, "BOARD.DSN"));
      await createDatFiles(join(projectDir, "allegro"));

      const designs = await discoverCadenceDesigns(testDir);
      expect(designs.find((d) => d.name === "BOARD")?.datFiles?.pstxnet).toContain("allegro");
    });

    it("should give a nested design its own directory over a distant sibling", async () => {
      // Not a tie: the nested design is strictly closer, so it still wins.
      await createDesign(join(testDir, "TOP.DSN"));
      await createDesign(join(testDir, "sub", "NESTED.DSN"));
      await createDatFiles(join(testDir, "sub", "allegro"));

      const designs = await discoverCadenceDesigns(testDir);
      expect(designs.find((d) => d.name === "NESTED")?.datFiles?.pstxnet).toContain("allegro");
      expect(designs.find((d) => d.name === "TOP")?.datFiles?.pstxnet).toBeNull();
    });

    it("should prefer a fresh <design>_netlist over a stale directory with the same name", async () => {
      // Both directories name the design, so nothing but the export convention
      // distinguishes them; returning the stale one makes a successful export
      // look like it did nothing.
      const projectDir = join(testDir, "project");
      await createDesign(join(projectDir, "BOARD.DSN"));
      await createDatFiles(join(projectDir, "BOARD"), "BOARD");
      await createDatFiles(join(projectDir, "BOARD_netlist"), "BOARD");

      const designs = await discoverCadenceDesigns(testDir);
      const live = designs.find((d) => d.format === "cadence-cis");

      expect(live?.datFiles?.pstxnet).toContain("BOARD_netlist");
      // list_designs and findCadenceDatFiles must not disagree for one design.
      const direct = await findCadenceDatFiles(join(projectDir, "BOARD.DSN"));
      expect(direct.pstxnet).toBe(live?.datFiles?.pstxnet);
    });

    it("should prefer name-matching over proximity when resolving conflicts", async () => {
      // Structure:
      // project/
      // ├── mock_design_a.cpm
      // ├── mock_design_b.cpm
      // └── output/
      //     ├── mock_design_a/      <- should match mock_design_a.cpm by name
      //     │   └── *.dat
      //     └── mock_design_b/       <- should match mock_design_b.cpm by name
      //         └── *.dat
      const projectDir = join(testDir, "project");
      await createDesign(join(projectDir, "mock_design_a.cpm"));
      await createDesign(join(projectDir, "mock_design_b.cpm"));
      await createDatFiles(join(projectDir, "output", "mock_design_a"));
      await createDatFiles(join(projectDir, "output", "mock_design_b"));

      const designs = await discoverCadenceDesigns(testDir);

      expect(designs).toHaveLength(2);

      const designA = designs.find((d) => d.name === "mock_design_a");
      const designB = designs.find((d) => d.name === "mock_design_b");

      expect(designA!.datFiles?.pstxnet).toContain(join("output", "mock_design_a"));
      expect(designB!.datFiles?.pstxnet).toContain(join("output", "mock_design_b"));
    });

    it("should assign single .dat set to best matching design when only one exists", async () => {
      // Structure:
      // project/
      // ├── test_design_1.cpm
      // ├── test_design_1_v2.cpm
      // └── worklib/
      //     └── test_design_1/           <- only one .dat set, matches "test_design_1" by name
      //         └── packaged/
      //             └── *.dat
      const projectDir = join(testDir, "project");
      await createDesign(join(projectDir, "test_design_1.cpm"));
      await createDesign(join(projectDir, "test_design_1_v2.cpm"));
      await createDatFiles(join(projectDir, "worklib", "test_design_1", "packaged"));

      const designs = await discoverCadenceDesigns(testDir);

      expect(designs).toHaveLength(2);

      const design1 = designs.find((d) => d.name === "test_design_1");
      const design1V2 = designs.find((d) => d.name === "test_design_1_v2");

      // test_design_1 should get the .dat files (name match)
      expect(design1!.datFiles?.pstxnet).toBeDefined();
      expect(design1!.error).toBeUndefined();

      // test_design_1_v2 should not have .dat files
      expect(design1V2!.datFiles?.pstxnet).toBeNull();
      // No error — DSN parsing is the default path
      expect(design1V2!.error).toBeUndefined();
    });

    it("should not guess which of two equal designs owns a generically named directory", async () => {
      // Structure:
      // project/
      // ├── DesignA.cpm
      // ├── DesignB.cpm
      // └── output/              <- generic name, names neither design
      //     └── *.dat
      //
      // This used to hand the set to whichever design sorted first, which is
      // right half the time and silent when it is wrong: the loser's queries
      // would answer with the winner's circuit. Nothing here says whose netlist
      // it is, so neither design claims it and it is listed in its own right,
      // where it stays queryable and visibly separate.
      const projectDir = join(testDir, "project");
      await createDesign(join(projectDir, "DesignA.cpm"));
      await createDesign(join(projectDir, "DesignB.cpm"));
      await createDatFiles(join(projectDir, "output"));

      const designs = await discoverCadenceDesigns(testDir);

      expect(designs.filter((d) => d.format !== "cadence-dat")).toHaveLength(2);
      for (const d of designs.filter((d) => d.format !== "cadence-dat")) {
        expect(d.datFiles?.pstxnet).toBeNull();
      }
      // The netlist itself is not lost.
      expect(designs.filter((d) => d.format === "cadence-dat")).toHaveLength(1);
    });

    it("should NOT match based on project folder name in absolute path", async () => {
      // This is a critical edge case: if project folder is named "test_design_1" and contains
      // designs "test_design_1.cpm" and "test_design_1_v2.cpm", the name matching should use
      // RELATIVE paths, not absolute paths.
      //
      // Structure:
      // test_design_1/                     <- project folder named "test_design_1"
      // ├── test_design_1.cpm              <- should match worklib/test_design_1/
      // ├── test_design_1_v2.cpm           <- should match test_design_1_v2/test_design_1_v2/
      // ├── worklib/
      // │   └── test_design_1/
      // │       └── packaged/
      // │           └── *.dat
      // └── test_design_1_v2/
      //     └── test_design_1_v2/
      //         └── packaged/
      //             └── *.dat
      const projectDir = join(testDir, "test_design_1"); // Project folder named "test_design_1"
      await createDesign(join(projectDir, "test_design_1.cpm"));
      await createDesign(join(projectDir, "test_design_1_v2.cpm"));
      await createDatFiles(join(projectDir, "worklib", "test_design_1", "packaged"));
      await createDatFiles(join(projectDir, "test_design_1_v2", "test_design_1_v2", "packaged"));

      const designs = await discoverCadenceDesigns(testDir);

      expect(designs).toHaveLength(2);

      const design1 = designs.find((d) => d.name === "test_design_1");
      const design1V2 = designs.find((d) => d.name === "test_design_1_v2");

      expect(design1).toBeDefined();
      expect(design1V2).toBeDefined();

      // test_design_1.cpm should match worklib/test_design_1/packaged (relative path contains "test_design_1")
      expect(design1!.datFiles?.pstxnet).toContain(join("worklib", "test_design_1", "packaged"));
      expect(design1!.error).toBeUndefined();

      // test_design_1_v2.cpm should match test_design_1_v2/test_design_1_v2/packaged (relative path contains "test_design_1_v2")
      expect(design1V2!.datFiles?.pstxnet).toContain(
        join("test_design_1_v2", "test_design_1_v2", "packaged")
      );
      expect(design1V2!.error).toBeUndefined();
    });
  });

  describe("Edge Cases", () => {
    it("should not error for DSN design without .dat files", async () => {
      const projectDir = join(testDir, "project");
      await createDesign(join(projectDir, "board.DSN"));
      // No .dat files — DSN parsing is the default, no error needed

      const designs = await discoverCadenceDesigns(testDir);

      expect(designs).toHaveLength(1);
      expect(designs[0].name).toBe("board");
      expect(designs[0].datFiles?.pstxnet).toBeNull();
      expect(designs[0].datFiles?.pstxprt).toBeNull();
      expect(designs[0].datFiles?.pstchip).toBeNull();
      expect(designs[0].error).toBeUndefined();
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
      // No error — DSN parsing is the default path
      expect(designs[0].error).toBeUndefined();
    });

    it("should discover orphan .dat files as standalone cadence-dat design", async () => {
      // .dat files exist but no design file
      const orphanDir = join(testDir, "orphan");
      await mkdir(orphanDir, { recursive: true });
      await writeFile(join(orphanDir, "pstxnet.dat"), "test-content");
      await writeFile(
        join(orphanDir, "pstxprt.dat"),
        "DIRECTIVES\n ROOT_DRAWING='MY_BOARD';\nEND_DIRECTIVES;\n"
      );
      await writeFile(join(orphanDir, "pstchip.dat"), "test-content");

      const designs = await discoverCadenceDesigns(testDir);

      expect(designs).toHaveLength(1);
      expect(designs[0]).toMatchObject({
        name: "MY_BOARD",
        format: "cadence-dat",
        sourcePath: join(orphanDir, "pstxnet.dat"),
      });
      expect(designs[0].datFiles.pstxnet).toBe(join(orphanDir, "pstxnet.dat"));
      expect(designs[0].error).toBeUndefined();
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
    it("should handle a .DSN beside an allegro/ output folder", async () => {
      // Exact structure a real project of this shape uses.
      const projectDir = join(testDir, "project-main");
      await createDesign(join(projectDir, "BOARD_TOP_A.DSN"));
      await createDatFiles(join(projectDir, "allegro"));

      const designs = await discoverCadenceDesigns(testDir);

      expect(designs).toHaveLength(1);
      expect(designs[0].name).toBe("BOARD_TOP_A");
      expect(designs[0].format).toBe("cadence-cis");
      expect(designs[0].datFiles?.pstxnet).toContain("allegro");
      expect(designs[0].error).toBeUndefined();
    });

    it("should handle nested ALLEGRO folder structure", async () => {
      // Exact structure a real project of this shape uses.
      const projectDir = join(testDir, "project-fork", "ALLEGRO");
      await createDesign(join(projectDir, "BOARD_TOP_B.DSN"));
      await createDatFiles(join(projectDir, "allegro"));

      const designs = await discoverCadenceDesigns(testDir);

      expect(designs).toHaveLength(1);
      expect(designs[0].name).toBe("BOARD_TOP_B");
      expect(designs[0].datFiles?.pstxnet).toContain(join("ALLEGRO", "allegro"));
      expect(designs[0].error).toBeUndefined();
    });

    it("should handle Cadence HDL style with worklib structure", async () => {
      // Exact structure from test_design_1 project
      const projectDir = join(testDir, "test_design_1");
      await createDesign(join(projectDir, "test_design_1.cpm"));
      await createDatFiles(join(projectDir, "worklib", "test_design_1", "packaged"));

      const designs = await discoverCadenceDesigns(testDir);

      expect(designs).toHaveLength(1);
      expect(designs[0].name).toBe("test_design_1");
      expect(designs[0].format).toBe("cadence-hdl");
      expect(designs[0].datFiles?.pstxnet).toContain(join("worklib", "test_design_1", "packaged"));
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

  describe("Dat-Only Standalone Designs", () => {
    it("should NOT produce standalone when dat set is matched to a .DSN", async () => {
      const projectDir = join(testDir, "project");
      await createDesign(join(projectDir, "board.DSN"));
      await createDatFiles(join(projectDir, "allegro"), "BOARD_DESIGN");

      const designs = await discoverCadenceDesigns(testDir);

      expect(designs).toHaveLength(1);
      expect(designs[0].format).toBe("cadence-cis");
      expect(designs[0].name).toBe("board");
      // No cadence-dat design should appear
      expect(designs.filter((d) => d.format === "cadence-dat")).toHaveLength(0);
    });

    it("should create standalone alongside DSN-matched designs (mixed scenario)", async () => {
      // One project with DSN + dat, another with only dat
      const projectA = join(testDir, "projectA");
      await createDesign(join(projectA, "DesignA.DSN"));
      await createDatFiles(join(projectA, "output"), "DESIGN_A");

      const orphanDir = join(testDir, "orphan");
      await createDatFiles(orphanDir, "ORPHAN_BOARD");

      const designs = await discoverCadenceDesigns(testDir);

      expect(designs).toHaveLength(2);

      const dsnDesign = designs.find((d) => d.format === "cadence-cis");
      const datDesign = designs.find((d) => d.format === "cadence-dat");

      expect(dsnDesign).toBeDefined();
      expect(dsnDesign!.name).toBe("DesignA");

      expect(datDesign).toBeDefined();
      expect(datDesign!.name).toBe("ORPHAN_BOARD");
      expect(datDesign!.sourcePath).toBe(join(orphanDir, "pstxnet.dat"));
    });

    it("should extract design name from ROOT_DRAWING in pstxprt.dat", async () => {
      const datDir = join(testDir, "some_folder");
      await createDatFiles(datDir, "BOARD_TOP_A");

      const designs = await discoverCadenceDesigns(testDir);

      expect(designs).toHaveLength(1);
      expect(designs[0].name).toBe("BOARD_TOP_A");
      expect(designs[0].format).toBe("cadence-dat");
    });

    it("should ignore incomplete orphan dat sets (2 of 3 files, no DSN)", async () => {
      const orphanDir = join(testDir, "incomplete");
      await mkdir(orphanDir, { recursive: true });
      await writeFile(join(orphanDir, "pstxnet.dat"), "test-content");
      await writeFile(join(orphanDir, "pstxprt.dat"), "test-content");
      // Missing pstchip.dat, no DSN either

      const designs = await discoverCadenceDesigns(testDir);

      expect(designs).toHaveLength(0);
    });

    it("should fallback to folder name when ROOT_DRAWING is absent", async () => {
      const datDir = join(testDir, "my_board_v2");
      await createDatFiles(datDir); // no rootDrawing => pstxprt has no ROOT_DRAWING

      const designs = await discoverCadenceDesigns(testDir);

      expect(designs).toHaveLength(1);
      expect(designs[0].name).toBe("my_board_v2");
      expect(designs[0].format).toBe("cadence-dat");
    });

    it("should disambiguate when multiple dat trios share the same name", async () => {
      // Two separate directories, both with ROOT_DRAWING='SAME_NAME'
      const dirA = join(testDir, "locationA", "Allegro");
      const dirB = join(testDir, "locationB", "Allegro");
      await createDatFiles(dirA, "SAME_NAME");
      await createDatFiles(dirB, "SAME_NAME");

      const designs = await discoverCadenceDesigns(testDir);

      expect(designs).toHaveLength(2);
      // Both should be cadence-dat
      expect(designs.every((d) => d.format === "cadence-dat")).toBe(true);
      // Names should be unique (disambiguated with hash suffix)
      expect(designs[0].name).not.toBe(designs[1].name);
      // Both should start with SAME_NAME
      expect(designs[0].name).toMatch(/^SAME_NAME_[0-9a-f]{4}$/);
      expect(designs[1].name).toMatch(/^SAME_NAME_[0-9a-f]{4}$/);
    });
  });

  describe("isCadenceFile", () => {
    it("should recognize .DSN files", () => {
      expect(isCadenceFile("/path/to/Design.DSN")).toBe(true);
      expect(isCadenceFile("/path/to/design.dsn")).toBe(true);
    });

    it("should recognize .cpm files", () => {
      expect(isCadenceFile("/path/to/design.cpm")).toBe(true);
      expect(isCadenceFile("/path/to/DESIGN.CPM")).toBe(true);
    });

    it("should recognize pstxnet.dat", () => {
      expect(isCadenceFile("/path/to/pstxnet.dat")).toBe(true);
      expect(isCadenceFile("/path/to/PSTXNET.DAT")).toBe(true);
      expect(isCadenceFile("/some/dir/Pstxnet.Dat")).toBe(true);
    });

    it("should reject other .dat files", () => {
      expect(isCadenceFile("/path/to/pstxprt.dat")).toBe(false);
      expect(isCadenceFile("/path/to/pstchip.dat")).toBe(false);
      expect(isCadenceFile("/path/to/other.dat")).toBe(false);
    });

    it("should reject unrelated extensions", () => {
      expect(isCadenceFile("/path/to/design.txt")).toBe(false);
      expect(isCadenceFile("/path/to/design.SchDoc")).toBe(false);
    });
  });
});
