/**
 * Ports and sheet entries joining nets across sheets, on real projects.
 *
 * misko3 is a Hierarchical design (`HierarchyMode=2`) whose top sheet is
 * nothing but sheet symbols wired entry to entry, and whose ports are mostly
 * wired at the far end of the bar. Its board file names the nets these tests
 * expect. pca10056 turns port and entry naming off and half-steps its
 * entries.
 */
import { describe, it, expect } from "vitest";
import { existsSync } from "fs";
import path from "path";
import { altiumHandler } from "./index.js";

const FIXTURES = path.resolve(__dirname, "../../../test/fixtures/altium");
const MISKO3 = path.join(FIXTURES, "misko3/MISKO3.PrjPcb");
const PCA10056 = path.join(
  FIXTURES,
  "nRF52840-Development-Kit/PCA10056-nRF52840 Development Board 3_0_3/Altium Designer files/pca10056.PrjPCB"
);

const pinsOf = (nets: Record<string, Record<string, string[]>>, net: string): string[] =>
  Object.entries(nets[net] ?? {})
    .flatMap(([refdes, pins]) => pins.map((pin) => `${refdes}.${pin}`))
    .sort();

describe.skipIf(!existsSync(MISKO3))("misko3 cross-sheet links", () => {
  it("joins a child port wired at the far end of its bar to the parent's entry", async () => {
    const { nets } = await altiumHandler.parse(MISKO3, {});
    // J10.8 on the Arduino GPIO sheet reaches the CAN transceiver through the
    // top sheet; the board calls the net CANH.
    expect(pinsOf(nets, "CANH")).toEqual(["D7.1", "J10.8", "R64.1", "U8.7"]);
    expect(nets["NetJ10_8"]).toBeUndefined();
  });

  it("names a joined net after its label rather than the child's port", async () => {
    const { nets } = await altiumHandler.parse(MISKO3, {});
    // The MCU sheet labels the net USART5_TX; the CAN+LIN sheet's port calls
    // it LIN_TXD. The board keeps the label.
    expect(pinsOf(nets, "USART5_TX")).toEqual(["J4.8", "R57.2", "U7.4", "U9.102"]);
    expect(nets["LIN_TXD"]).toBeUndefined();
  });

  it("takes the first label in sort order when several sheets label one net", async () => {
    const { nets } = await altiumHandler.parse(MISKO3, {});
    expect(pinsOf(nets, "NRST")).toContain("U9.21");
    expect(pinsOf(nets, "NRST")).toContain("J12.10");
    expect(nets["T_NRST"]).toBeUndefined();
    expect(nets["NRST_DBG"]).toBeUndefined();
  });

  it("keeps same-named ports on different sheets apart under Hierarchical scope", async () => {
    const { nets } = await altiumHandler.parse(MISKO3, {});
    // The MCU's USB_P port meets the hub's USB2_P entry; the USB-C sheet's
    // USB_P is a different net. Merging ports by name would fold them.
    expect(pinsOf(nets, "USB2_P")).toEqual(["U3.5", "U9.93"]);
    expect(pinsOf(nets, "USB_P")).toEqual(["D1.4", "J1.A6", "J1.B6", "U3.20"]);
  });
});

describe.skipIf(!existsSync(PCA10056))("pca10056 cross-sheet links", () => {
  it("joins ports that may not name their net through half-step sheet entries", async () => {
    const { nets } = await altiumHandler.parse(PCA10056, {});
    expect(pinsOf(nets, "RESET_PIN")).toContain("SB43.2");
    expect(pinsOf(nets, "RESET_PIN")).toContain("U7.4");
    expect(nets["NetSB43_2"]).toBeUndefined();
  });
});
