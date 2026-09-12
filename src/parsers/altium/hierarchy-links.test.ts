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
const EPS_BOARD = path.join(FIXTURES, "cube-sat-eps/pcb/EPS_board.PrjPcb");
const LD_HARNESS = path.join(FIXTURES, "HELIOS-R/ld_harness/ld_harness.PrjPcb");
const MICROPHONES = path.join(
  FIXTURES,
  "heron-hardware/Microphone-Boards/Microphone-Boards.PrjPcb"
);
const Q23 = path.join(FIXTURES, "qfsae-harness/q23-harness/q23-harness.PrjPcb");
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

  it("joins bus members through harness entries written as ranges", async () => {
    const { nets } = await altiumHandler.parse(MISKO3, {});
    // The Arduino GPIO sheet labels AD0 on a wire into a bus that reaches the
    // harness entry AD[0..11]; the MCU sheet does the same. The board calls
    // the net AD0, and the bus members are not sheet-local nets.
    expect(pinsOf(nets, "AD0")).toEqual(["J8.1", "U9.27"]);
    expect(pinsOf(nets, "AD11")).toEqual(["J10.4", "U9.75"]);
    expect(pinsOf(nets, "DAC1")).toEqual(["J10.5", "U9.33"]);
    expect(nets["AD0_6"]).toBeUndefined();
    expect(nets["AD0_11"]).toBeUndefined();
  });

  it("joins bus members through harness-typed ports written as ranges", async () => {
    const { nets } = await altiumHandler.parse(MISKO3, {});
    // LED[0..7] is a harness-typed port on both the MCU and the joystick
    // sheets, each reached by a bus; the bundle is named after the port.
    expect(pinsOf(nets, "LED0")).toEqual(["R77.2", "U9.26"]);
    expect(pinsOf(nets, "LED7")).toEqual(["R70.2", "U9.25"]);
  });

  it("leaves no net with a single pin", async () => {
    const { nets } = await altiumHandler.parse(MISKO3, {});
    const single = Object.entries(nets).filter(
      ([, pins]) => Object.values(pins).flat().length === 1
    );
    expect(single).toEqual([]);
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

describe.skipIf(!existsSync(EPS_BOARD))("EPS_board multi-placed child", () => {
  it("instantiates a child placed by two plain sheet symbols once per placement", async () => {
    const { nets, components } = await altiumHandler.parse(EPS_BOARD, {});
    // buck_boost.SchDoc is placed by two symbols both designated buck_boost;
    // the project's $Component$ChannelAlpha format tells the channels apart.
    expect(components["U500A"]).toBeDefined();
    expect(components["U500B"]).toBeDefined();
    expect(components["U500"]).toBeUndefined();
    // Each placement's local nets stay apart, and both reach the parent's VBUS
    // through their own symbol's entries.
    expect(pinsOf(nets, "NetC400A_1")).toEqual(["C400A.1", "Q400A.3", "U400A.1"]);
    expect(pinsOf(nets, "NetC400B_1")).toEqual(["C400B.1", "Q400B.3", "U400B.1"]);
    expect(pinsOf(nets, "VBUS")).toContain("U400A.6");
    expect(pinsOf(nets, "VBUS")).toContain("U400B.6");
    expect(pinsOf(nets, "VBUS")).toContain("U500A.10");
    expect(pinsOf(nets, "VBUS")).toContain("U500B.10");
  });

  it("gives each Repeat() channel its own entry-named net", async () => {
    const { nets } = await altiumHandler.parse(EPS_BOARD, {});
    expect(pinsOf(nets, "PG1")).toEqual(["U200.58", "U300A.19"]);
    expect(pinsOf(nets, "PG2")).toEqual(["U200.59", "U300B.19"]);
  });
});

describe.skipIf(!existsSync(LD_HARNESS))("ld_harness Repeat() bus members", () => {
  it("hands bus member n of a Repeat(NAME) entry to channel n", async () => {
    const { nets } = await altiumHandler.parse(LD_HARNESS, {});
    // The top sheet labels a bus OP_OUT_P[1..9] beside the repeated channel
    // symbol and again beside the connector; OP_OUT_P3 reaches channel 3 only.
    expect(pinsOf(nets, "OP_OUT_P3")).toEqual(["J2.4", "J4_CHAN3.5_G"]);
    expect(pinsOf(nets, "TEMP_A9")).toEqual(["J3.17", "J4_CHAN9.11_G"]);
  });

  it("hands a plain entry to every channel without ports naming the net", async () => {
    const { nets } = await altiumHandler.parse(LD_HARNESS, {});
    const stdn = pinsOf(nets, "STDN_A");
    expect(stdn).toContain("J1.1");
    for (let channel = 1; channel <= 9; channel++) expect(stdn).toContain(`J4_CHAN${channel}.10_G`);
  });

  it("leaves no net with a single pin", async () => {
    const { nets } = await altiumHandler.parse(LD_HARNESS, {});
    const single = Object.entries(nets).filter(
      ([, pins]) => Object.values(pins).flat().length === 1
    );
    expect(single).toEqual([]);
  });
});

describe.skipIf(!existsSync(MICROPHONES))("Microphone-Boards unwired Repeat() entries", () => {
  it("keeps each channel's net apart when its entry is wired to nothing", async () => {
    const { nets } = await altiumHandler.parse(MICROPHONES, {});
    // AllowPortNetNames is off, so the net is named after its pin per channel.
    expect(pinsOf(nets, "NetM2A_1")).toEqual(["M2A.1"]);
    expect(pinsOf(nets, "NetM2B_1")).toEqual(["M2B.1"]);
  });
});

describe.skipIf(!existsSync(Q23))("q23-harness net naming", () => {
  it("names a net after its label rather than its power port, the project not saying otherwise", async () => {
    const { nets } = await altiumHandler.parse(Q23, {});
    expect(pinsOf(nets, "SEN_5V_A1")).toContain("BSPD_CONN.2");
    expect(nets["VCC5V"]).toBeUndefined();
  });
});
