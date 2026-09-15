import { describe, expect, it } from "vitest";
import { applyChannelFormat, planChannelNetNames, type ChannelNetScope } from "./channels.js";

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
    // Altium keeps counting through the ASCII after "Z" instead of rolling
    // over: FMC_DIO_32ch_lvds_a names channels 27..32 `R1[` .. `R1\``.
    expect(applyChannelFormat("$ChannelAlpha", "R1", "X", 27)).toBe("[");
    expect(applyChannelFormat("$ChannelAlpha", "R1", "X", 32)).toBe("`");
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

/**
 * Every case below is drawn from a real repeated sheet, and the expected names
 * are the ones that design's own board file carries where a board is available.
 */
const emptyScope = (): ChannelNetScope => ({
  powerNetNames: new Set(),
  sharedNames: new Set(),
  pinNamed: new Map(),
});

describe("planChannelNetNames", () => {
  it("keeps the number a pin name was given when rebuilding it for a channel", () => {
    const scope: ChannelNetScope = {
      ...emptyScope(),
      pinNamed: new Map([["NetR2_1_2", { refdes: "R2", pin: "1", suffix: "_2" }]]),
    };
    expect(planChannelNetNames(["NetR2_1_2"], scope, "CH1", 1, "$Component_$RoomName")).toEqual(
      new Map([["NetR2_1_2", "NetR2_CH1_1_2"]])
    );
  });

  it("builds an auto-generated name around the channel's designator", () => {
    const scope: ChannelNetScope = {
      ...emptyScope(),
      pinNamed: new Map([["NetDD12_5", { refdes: "DD12", pin: "5" }]]),
    };

    // The board carries NetDD12_AY1_5, not NetDD12_5_AY1.
    expect(planChannelNetNames(["NetDD12_5"], scope, "AY1", 1, "$Component_$RoomName")).toEqual(
      new Map([["NetDD12_5", "NetDD12_AY1_5"]])
    );
    expect(planChannelNetNames(["NetDD12_5"], scope, "AY3", 3, "$Component_$RoomName")).toEqual(
      new Map([["NetDD12_5", "NetDD12_AY3_5"]])
    );
  });

  it("uses the channel format rather than the room name (heron-hardware, cube-sat-eps)", () => {
    const scope: ChannelNetScope = {
      ...emptyScope(),
      pinNamed: new Map([["NetU1_3", { refdes: "U1", pin: "3" }]]),
    };

    expect(
      planChannelNetNames(["NetU1_3"], scope, "MP34DT05TR2", 2, "$Component$ChannelAlpha")
    ).toEqual(new Map([["NetU1_3", "NetU1B_3"]]));
  });

  it("keeps a pin number that contains an underscore intact", () => {
    // NetJ4_2_G is J4 pin "2_G". Recovering the refdes and pin by splitting the
    // name would put the channel in the wrong place, or in the middle of the pin.
    const scope: ChannelNetScope = {
      ...emptyScope(),
      pinNamed: new Map([["NetJ4_2_G", { refdes: "J4", pin: "2_G" }]]),
    };

    expect(planChannelNetNames(["NetJ4_2_G"], scope, "CHAN1", 1, "$Component_$RoomName")).toEqual(
      new Map([["NetJ4_2_G", "NetJ4_CHAN1_2_G"]])
    );
  });

  it("leaves a power net's name alone, so every channel reaches the same supply", () => {
    const scope: ChannelNetScope = { ...emptyScope(), powerNetNames: new Set(["+3V3"]) };

    expect(planChannelNetNames(["+3V3"], scope, "AY1", 1, "$Component_$RoomName")).toEqual(
      new Map([["+3V3", "+3V3"]])
    );
  });

  it("leaves a shared sheet entry signal alone, and suffixes an unshared one", () => {
    const scope: ChannelNetScope = { ...emptyScope(), sharedNames: new Set(["RESET"]) };

    expect(
      planChannelNetNames(["RESET", "AUDIO_OUT"], scope, "AY2", 2, "$Component_$RoomName")
    ).toEqual(
      new Map([
        ["RESET", "RESET"],
        ["AUDIO_OUT", "AUDIO_OUT_AY2"],
      ])
    );
  });

  it("prefers a shared sheet entry over rebuilding, so the channels stay joined", () => {
    // A shared entry names one net across every channel. Rebuilding it per
    // channel would break the connection the parent drew.
    const scope: ChannelNetScope = {
      ...emptyScope(),
      sharedNames: new Set(["NetU1_3"]),
      pinNamed: new Map([["NetU1_3", { refdes: "U1", pin: "3" }]]),
    };

    expect(planChannelNetNames(["NetU1_3"], scope, "AY1", 1, "$Component_$RoomName")).toEqual(
      new Map([["NetU1_3", "NetU1_3"]])
    );
  });

  it("gives each channel a distinct name for the same auto-named net", () => {
    const scope: ChannelNetScope = {
      ...emptyScope(),
      pinNamed: new Map([["NetR4_2", { refdes: "R4", pin: "2" }]]),
    };

    const names = ["AY1", "AY2", "AY3"].map(
      (room, i) =>
        planChannelNetNames(["NetR4_2"], scope, room, i + 1, "$Component_$RoomName").get("NetR4_2")!
    );
    expect(new Set(names).size).toBe(3);
    expect(names).toEqual(["NetR4_AY1_2", "NetR4_AY2_2", "NetR4_AY3_2"]);
  });

  it("names a designer-named local net the way the channel's designators are", () => {
    expect(
      planChannelNetNames(["FILTER_IN"], emptyScope(), "AY1", 1, "$Component_$RoomName")
    ).toEqual(new Map([["FILTER_IN", "FILTER_IN_AY1"]]));
    // cube-sat-eps carries BIASB; ld_pulser carries V_pulser_1_.
    expect(
      planChannelNetNames(["BIAS"], emptyScope(), "MPPT_charger2", 2, "$Component$ChannelAlpha")
    ).toEqual(new Map([["BIAS", "BIASB"]]));
    expect(
      planChannelNetNames(
        ["V_pulser"],
        emptyScope(),
        "CHAN1",
        1,
        "$ComponentPrefix_$ChannelIndex_$ComponentIndex"
      )
    ).toEqual(new Map([["V_pulser", "V_pulser_1_"]]));
  });
});
