import { describe, expect, it } from "vitest";
import { documentInstances, findSheetPlacements } from "./sheet-hierarchy.js";
import { buildHierarchy } from "./records.js";
import { RECORD_TYPES, type AltiumRecord } from "./types.js";
import type { ReadDocument } from "./document.js";

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
