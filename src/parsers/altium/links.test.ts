import { describe, it, expect } from "vitest";
import { collectNetLinks, linkedNetGroups } from "./links.js";
import { RECORD_TYPES } from "./types.js";
import type { AltiumNet, AltiumRecord } from "./types.js";

const EMPTY = { header: [], records: [] };
const port = (name: string): AltiumRecord =>
  ({ index: 1, RECORD: RECORD_TYPES.PORT, Name: name }) as AltiumRecord;

describe("collectNetLinks", () => {
  it("links a harness entry's signal from a net without pins", () => {
    const harnessEntry = {
      index: 1,
      RECORD: RECORD_TYPES.HARNESS_ENTRY,
      Name: "SIG",
      harnessSignal: "port|BUS|SIG",
    } as AltiumRecord;
    const [group] = collectNetLinks([{ name: null, devices: [harnessEntry] }], EMPTY, {});
    expect(group.keys).toContain("harness|port|BUS|SIG");
  });

  it("gives the nets it links a label's name from a net without pins, not a port's", () => {
    const labelled: AltiumNet = { name: "SIG", nameSource: "label", devices: [port("SIG")] };
    const ported: AltiumNet = { name: "SIG", nameSource: "port", devices: [port("SIG")] };
    const [fromLabel, fromPort] = collectNetLinks([labelled, ported], EMPTY, {});
    expect(fromLabel.name).toBe("SIG");
    expect(fromPort.name).toBeUndefined();
  });
});

describe("linkedNetGroups", () => {
  it("meets a port on a document instance with the entry of the symbol placing it", () => {
    const groups = linkedNetGroups(
      [
        {
          placement: "top.schdoc",
          document: "top.schdoc",
          groups: [{ net: "A", keys: ["entry|3|SIG|"] }],
        },
        {
          placement: "top.schdoc/3@1",
          document: "child.schdoc",
          groups: [{ net: "B", keys: ["hier|sig"] }],
        },
      ],
      "hierarchical",
      new Map([["top.schdoc#3", [1]]])
    );
    expect([...groups.values()].map((names) => [...names].sort())).toEqual([["A", "B"]]);
  });

  it("joins every net label of one name across sheets under Global scope only", () => {
    const links = [
      {
        placement: "a.schdoc",
        document: "a.schdoc",
        groups: [{ net: "I2C_SDA", keys: ["label|I2C_SDA", "label|SDA"] }],
      },
      {
        placement: "b.schdoc",
        document: "b.schdoc",
        groups: [{ net: "SDA", keys: ["label|SDA"] }],
      },
    ];
    const global = [...linkedNetGroups(links, "global", new Map()).values()];
    expect(global.map((names) => [...names].sort())).toEqual([["I2C_SDA", "SDA"]]);
    expect(linkedNetGroups(links, "flat", new Map()).size).toBe(0);
  });

  it("meets power ports of a label's name under Global scope", () => {
    const links = [
      {
        placement: "a.schdoc",
        document: "a.schdoc",
        groups: [{ net: "+3V3", keys: ["label|VDD_MCU"] }],
      },
      {
        placement: "b.schdoc",
        document: "b.schdoc",
        groups: [{ net: "VDD_MCU", keys: ["power|VDD_MCU"] }],
      },
    ];
    const global = [...linkedNetGroups(links, "global", new Map()).values()];
    expect(global.map((names) => [...names].sort())).toEqual([["+3V3", "VDD_MCU"]]);
  });

  it("meets a global supply from a label of its name that does not name its net", () => {
    const links = [
      {
        placement: "a.schdoc",
        document: "a.schdoc",
        groups: [{ net: "AAA", keys: ["label|SIG_GND"] }],
      },
      {
        placement: "b.schdoc",
        document: "b.schdoc",
        groups: [{ net: "SIG_GND", keys: ["power|SIG_GND"] }],
      },
    ];
    const groups = [
      ...linkedNetGroups(links, "hierarchical", new Map(), new Set(["SIG_GND"])).values(),
    ];
    expect(groups.map((names) => [...names].sort())).toEqual([["AAA", "SIG_GND"]]);
    expect(linkedNetGroups(links, "hierarchical", new Map()).size).toBe(1);
  });
});
