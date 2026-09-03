import { describe, expect, it } from "vitest";
import { applyChannelFormat } from "./index.js";

/**
 * Every format string below was read verbatim from the `ChannelDesignatorFormatString`
 * of a real open-source Altium project. The design each came from is named so a
 * failure points at something reproducible rather than at an invented case.
 */
describe("applyChannelFormat", () => {
  it("substitutes $Component and $RoomName", () => {
    expect(applyChannelFormat("$Component_$RoomName", "DD12", "AY1", 1)).toBe("DD12_AY1");
    expect(applyChannelFormat("$Component_$RoomName", "R4", "AY3", 3)).toBe("R4_AY3");
  });

  it("substitutes $ChannelAlpha (cube-sat-eps, heron-hardware, utca-rtm-8-sfp)", () => {
    expect(applyChannelFormat("$Component$ChannelAlpha", "R5", "MPPT1", 1)).toBe("R5A");
    expect(applyChannelFormat("$Component$ChannelAlpha", "R5", "MPPT2", 2)).toBe("R5B");
    expect(applyChannelFormat("$Component$ChannelAlpha", "C12", "MIC8", 8)).toBe("C12H");
  });

  it("substitutes $ChannelIndex with a dot separator (easyinverter OnePhase)", () => {
    expect(applyChannelFormat("$Component.$ChannelIndex", "Q1", "Phase_T1", 1)).toBe("Q1.1");
    expect(applyChannelFormat("$Component.$ChannelIndex", "Q1", "Phase_T4", 4)).toBe("Q1.4");
  });

  it("substitutes $RoomName with a dot separator (easyinverter LogicsOnly, RoomNamingStyle=1)", () => {
    expect(applyChannelFormat("$Component.$RoomName", "K2", "GateCircuit_B2", 2)).toBe(
      "K2.GateCircuit_B2"
    );
  });

  it("substitutes $Component_$ChannelIndex (PW-Sat2, Thermostat_EEM, Booster)", () => {
    expect(applyChannelFormat("$Component_$ChannelIndex", "U7", "S2", 2)).toBe("U7_2");
  });

  it("splits a refdes into prefix and index (vme-adc-250k-16b-36cha)", () => {
    expect(
      applyChannelFormat("$ComponentPrefix_$ChannelIndex_$ComponentIndex", "R5", "IA3", 3)
    ).toBe("R_3_5");
    expect(
      applyChannelFormat("$ComponentPrefix_$ChannelIndex_$ComponentIndex", "RP12", "IA1", 1)
    ).toBe("RP_1_12");
  });

  it("does not let $Component swallow the longer $ComponentPrefix token", () => {
    // A naive `.replace("$Component", ...)` turns "$ComponentPrefix" into "R5Prefix".
    expect(applyChannelFormat("$ComponentPrefix", "R5", "X1", 1)).toBe("R");
    expect(applyChannelFormat("$ComponentIndex", "R5", "X1", 1)).toBe("5");
  });

  it("substitutes every occurrence, not just the first", () => {
    expect(applyChannelFormat("$Component_$RoomName_$RoomName", "R1", "CH2", 2)).toBe("R1_CH2_CH2");
  });

  it("rolls the alphabetic label past Z", () => {
    expect(applyChannelFormat("$ChannelAlpha", "R1", "X", 26)).toBe("Z");
    expect(applyChannelFormat("$ChannelAlpha", "R1", "X", 27)).toBe("AA");
    expect(applyChannelFormat("$ChannelAlpha", "R1", "X", 32)).toBe("AF");
  });

  it("handles a refdes with no numeric part", () => {
    expect(applyChannelFormat("$ComponentPrefix_$ComponentIndex", "TP", "CH1", 1)).toBe("TP_");
    expect(applyChannelFormat("$Component$ChannelAlpha", "TP", "CH1", 1)).toBe("TPA");
  });

  it("leaves an unmodelled token visible rather than dropping it", () => {
    // A silently dropped token would collapse every channel onto one designator,
    // which is the failure mode this whole fix exists to remove.
    expect(applyChannelFormat("$Component_$SomethingElse", "R1", "CH1", 1)).toBe(
      "R1_$SomethingElse"
    );
  });
});
