/**
 * Altium schematic parsing checked against the board.
 *
 * A `.PcbDoc` carries the netlist Altium compiled from the same schematics, so
 * it is an independent reference for which pins share a net and what the net
 * is called. Each fixture below lists exactly where the parser disagrees with
 * its board, so any new disagreement fails by name.
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
  /** Board nets the parser splits, each accounted for in the description. */
  fragmented?: string[];
  /** Schematic nets spanning more than one board net. */
  overMerged?: string[];
  /** Connected board pins on no schematic net. */
  unconnected?: string[];
  /** Shared pins whose net name matches the board's, at least. */
  sameName: number;
}

/** The 32 channel letters of a Repeat() sheet: A to Z, then the characters after Z. */
const CHANNELS_32 = Array.from({ length: 32 }, (_, i) => String.fromCharCode(65 + i));

const CASES: BoardCase[] = [
  {
    // Single sheet: the parser and the board agree completely.
    name: "Altium-STM32-PCB",
    project: "Altium-STM32-PCB/STM32_PCB_Design.PrjPcb",
    board: "Altium-STM32-PCB/STM32_PCB_Design.PcbDoc",
    sameName: 120,
  },
  {
    // Hierarchical, with bus members carried through harness entries and
    // harness-typed ports written as ranges. The names that still differ are
    // harness members the board names after a label on another sheet.
    name: "misko3",
    project: "misko3/MISKO3.PrjPcb",
    board: "misko3/Misko 3.PcbDoc",
    sameName: 780,
  },
  {
    // Global scope, imported with fractional coordinates. The names that differ
    // are the board's upper-casing of the schematic's.
    name: "LimeSDR-USB 1v4",
    project: "LimeSDR-USB/hardware/plug/1v4/LimeSDR-USB_1v4.PrjPcb",
    board: "LimeSDR-USB/hardware/plug/1v4/PCB/LimeSDR-USB_1v4.PcbDoc",
    sameName: 3033,
  },
  {
    name: "LimeSDR-USB 1v2",
    project: "LimeSDR-USB/hardware/plug/1v2/LimeSDR_1v2.PrjPcb",
    board: "LimeSDR-USB/hardware/plug/1v2/PCB/LimeSDR_1v2.PcbDoc",
    sameName: 2883,
  },
  {
    // Thirty-two channels of one buffer sheet by Repeat(), fed from buses the
    // top sheet labels FMC1_P[32..1] and the like into entries called
    // Repeat(FMC_P): the members join by index, and the wires that carry them
    // never touch the bus. The board carries every channel's physical
    // designator (IC49A ... IC49`). Parser defect: IC51 pins 3 (GND) and 5
    // (P3V3) are on no net in every channel.
    name: "FMC DIO 32ch LVDS",
    project: "fmc-dio-32chlvdsa/FMC_DIO_32ch_lvds_a.PrjPcb",
    board: "fmc-dio-32chlvdsa/PCB-Layout/FMC_DIO_32ch_lvds_a.PcbDoc",
    unconnected: CHANNELS_32.flatMap((channel) => [`IC51${channel}.3`, `IC51${channel}.5`]),
    sameName: 1877,
  },
  {
    name: "MIXR Power",
    project: "mixr-power/MIXR Power.PrjPcb",
    board: "mixr-power/Layout/MIXR - Power.PcbDoc",
    sameName: 380,
  },
  {
    // A harness meets a port at its fractional far end, and Repeat() entries meet
    // on a labelled wire. The Q400 footprints give three schematic pins nine
    // pads, so the board puts pins 2 and 3 on VBUS as well.
    name: "cube-sat-eps",
    project: "cube-sat-eps/pcb/EPS_board.PrjPcb",
    board: "cube-sat-eps/pcb/EPS.PcbDoc",
    fragmented: ["VBUS"],
    overMerged: ["G_OR_A", "G_OR_B", "VBAT1", "VBAT2"],
    sameName: 413,
  },
  {
    // Harnesses nested in harness entries, a sheet under a sheet placed twice,
    // and an entry and a port named alike but for case.
    name: "easyinverter main board",
    project: "easyinverter/MainBoard.PrjPCB",
    board: "easyinverter/MainBoard_PCB.PcbDoc",
    sameName: 243,
  },
  {
    // Parser defect: U11.7 and the crystal pads X1.2, X1.4, X3.2 and X3.4 are on
    // GND on the board and on no net here.
    name: "nRF52840 DK pca10056",
    project:
      "nRF52840-Development-Kit/PCA10056-nRF52840 Development Board 3_0_3/Altium Designer files/pca10056.PrjPCB",
    board:
      "nRF52840-Development-Kit/PCA10056-nRF52840 Development Board 3_0_3/Altium Designer files/400236.PcbDoc",
    unconnected: ["U11.7", "X1.2", "X1.4", "X3.2", "X3.4"],
    sameName: 1056,
  },
];

// The LimeSDR-USB projects take several seconds to parse on a loaded CI runner.
describe("Altium netlist against the board", { timeout: 30_000 }, () => {
  for (const boardCase of CASES) {
    const project = path.join(FIXTURES, boardCase.project);
    const board = path.join(FIXTURES, boardCase.board);
    describe.skipIf(!existsSync(project) || !existsSync(board))(boardCase.name, () => {
      it("splits, merges and misses exactly the known board nets", async () => {
        const parsed = await altiumHandler.parse(project, {});
        const pinNets = new Map<string, string>();
        const schematicPins = new Set<string>();
        for (const [refdes, component] of Object.entries(parsed.components)) {
          for (const [pin, entry] of Object.entries(component.pins)) {
            schematicPins.add(`${refdes}.${pin}`);
            const net = typeof entry === "string" ? entry : entry.net;
            if (net) pinNets.set(`${refdes}.${pin}`, net);
          }
        }
        const comparison = compareToBoard(pinNets, readBoardNetlist(board), schematicPins);
        expect(comparison.fragmented).toEqual(boardCase.fragmented ?? []);
        expect(comparison.overMerged).toEqual(boardCase.overMerged ?? []);
        expect(comparison.unconnected).toEqual(boardCase.unconnected ?? []);
        expect(comparison.sameName).toBeGreaterThanOrEqual(boardCase.sameName);
      });
    });
  }
});
