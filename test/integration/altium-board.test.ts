/**
 * Altium schematic parsing checked against the board.
 *
 * A `.PcbDoc` carries the netlist Altium compiled from the same schematics, so
 * it is an independent reference for which pins share a net and what the net
 * is called. Each fixture below records how far the parser agrees with its
 * board; a change that lowers a number here has lost connectivity somewhere.
 */
import { describe, it, expect } from "vitest";
import { existsSync } from "fs";
import path from "path";
import { altiumHandler } from "../../src/parsers/altium/index.js";
import { readBoardNetlist, compareToBoard } from "../helpers/altium-pcbdoc.js";

const FIXTURES = path.resolve(__dirname, "../fixtures/altium");

interface BoardCase {
  name: string;
  project: string;
  board: string;
  /** Board nets the parser still splits, all accounted for in the description. */
  fragmented: number;
  /** Shared pins whose net name matches the board's, at least. */
  sameName: number;
}

const CASES: BoardCase[] = [
  {
    // Single sheet: the parser and the board agree completely.
    name: "Altium-STM32-PCB",
    project: "Altium-STM32-PCB/STM32_PCB_Design.PrjPcb",
    board: "Altium-STM32-PCB/STM32_PCB_Design.PcbDoc",
    fragmented: 0,
    sameName: 120,
  },
  {
    // Hierarchical, with bus members carried through harness entries and
    // harness-typed ports written as ranges. The names that still differ are
    // harness members the board names after a label on another sheet.
    name: "misko3",
    project: "misko3/MISKO3.PrjPcb",
    board: "misko3/Misko 3.PcbDoc",
    fragmented: 0,
    sameName: 780,
  },
  {
    // Global scope, imported with fractional coordinates: labels and wire ends
    // sit up to 0.011 units off the wires they meet. The names that differ
    // are the board's upper-casing of the schematic's.
    name: "LimeSDR-USB 1v4",
    project: "LimeSDR-USB/hardware/plug/1v4/LimeSDR-USB_1v4.PrjPcb",
    board: "LimeSDR-USB/hardware/plug/1v4/PCB/LimeSDR-USB_1v4.PcbDoc",
    fragmented: 0,
    sameName: 3008,
  },
  {
    name: "LimeSDR-USB 1v2",
    project: "LimeSDR-USB/hardware/plug/1v2/LimeSDR_1v2.PrjPcb",
    board: "LimeSDR-USB/hardware/plug/1v2/PCB/LimeSDR_1v2.PcbDoc",
    fragmented: 0,
    sameName: 2862,
  },
  {
    name: "MIXR Power",
    project: "mixr-power/MIXR Power.PrjPcb",
    board: "mixr-power/Layout/MIXR - Power.PcbDoc",
    fragmented: 0,
    sameName: 380,
  },
  {
    name: "nRF52840 DK pca10056",
    project:
      "nRF52840-Development-Kit/PCA10056-nRF52840 Development Board 3_0_3/Altium Designer files/pca10056.PrjPCB",
    board:
      "nRF52840-Development-Kit/PCA10056-nRF52840 Development Board 3_0_3/Altium Designer files/400236.PcbDoc",
    fragmented: 0,
    sameName: 1056,
  },
];

// The LimeSDR-USB projects take several seconds to parse on a loaded CI runner.
describe("Altium netlist against the board", { timeout: 30_000 }, () => {
  for (const boardCase of CASES) {
    const project = path.join(FIXTURES, boardCase.project);
    const board = path.join(FIXTURES, boardCase.board);
    describe.skipIf(!existsSync(project) || !existsSync(board))(boardCase.name, () => {
      it("splits no board net beyond the known cases and merges none", async () => {
        const parsed = await altiumHandler.parse(project, {});
        const pinNets = new Map<string, string>();
        for (const [refdes, component] of Object.entries(parsed.components)) {
          for (const [pin, entry] of Object.entries(component.pins)) {
            const net = typeof entry === "string" ? entry : entry.net;
            if (net) pinNets.set(`${refdes}.${pin}`, net);
          }
        }
        const comparison = compareToBoard(pinNets, readBoardNetlist(board));
        expect(comparison.overMerged).toEqual([]);
        expect(comparison.fragmented.length).toBeLessThanOrEqual(boardCase.fragmented);
        expect(comparison.sameName).toBeGreaterThanOrEqual(boardCase.sameName);
      });
    });
  }
});
