import { describe, expect, it } from "vitest";
import {
  documentInstances,
  findSheetPlacements,
  planChannelNetNames,
  type ChannelNetScope,
  type ReadDocument,
} from "./index.js";
import { buildHierarchy } from "./hierarchy.js";
import { RECORD_TYPES, type AltiumRecord } from "./types.js";

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

/** A document placing each `[designator, child]` by a sheet symbol of its own. */
const document = (name: string, symbols: [string, string][] = []): ReadDocument => {
  const records: AltiumRecord[] = [];
  for (const [designator, child] of symbols) {
    const index = records.length;
    records.push(
      { index, RECORD: RECORD_TYPES.SHEET_SYMBOL },
      {
        index: index + 1,
        RECORD: RECORD_TYPES.SHEET_NAME,
        Text: designator,
        OwnerIndex: String(index),
      },
      {
        index: index + 2,
        RECORD: RECORD_TYPES.SHEET_FILE_NAME,
        Text: child,
        OwnerIndex: String(index),
      }
    );
  }
  return {
    name,
    path: name,
    bundleLinks: [],
    hierarchical: buildHierarchy({ header: [], records }),
  };
};

const instancesOf = (documents: ReadDocument[], name: string, roomNamingStyle = "0") =>
  documentInstances(documents, findSheetPlacements(documents), roomNamingStyle).get(name)!;

describe("documentInstances", () => {
  it("repeats a sheet inside a sheet placed twice", () => {
    const documents = [
      document("top.schdoc", [
        ["HalfBridge_B", "half.schdoc"],
        ["HalfBridge_A", "half.schdoc"],
      ]),
      document("half.schdoc", [["Driver", "driver.schdoc"]]),
      document("driver.schdoc"),
    ];

    expect(
      instancesOf(documents, "driver.schdoc").map(({ key, room, ordinal }) => [key, room, ordinal])
    ).toEqual([
      ["top.schdoc/3@1/0@1", "Driver1", 1],
      ["top.schdoc/0@1/0@1", "Driver2", 2],
    ]);
  });

  it("orders channels naturally and letters rooms under room naming style 1", () => {
    const documents = [
      document("top.schdoc", [["Repeat(CH,9,10)", "ch.schdoc"]]),
      document("ch.schdoc"),
    ];

    expect(instancesOf(documents, "ch.schdoc").map(({ room }) => room)).toEqual(["CH9", "CH10"]);
    expect(instancesOf(documents, "ch.schdoc", "1").map(({ room }) => room)).toEqual([
      "CHI",
      "CHJ",
    ]);
  });

  it("numbers repeated rooms past a room they would spell", () => {
    const documents = [
      document("top.schdoc", [["Repeat(P,1,11)", "mid.schdoc"]]),
      document("mid.schdoc", [["Repeat(CH,1,11)", "ch.schdoc"]]),
      document("ch.schdoc"),
    ];

    const rooms = instancesOf(documents, "ch.schdoc").map(({ room }) => room);
    expect(rooms).toHaveLength(121);
    expect(new Set(rooms).size).toBe(121);
  });
});
