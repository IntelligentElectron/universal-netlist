import { describe, expect, it } from "vitest";
import {
  resolvePinNumber,
  findPinMap,
  extractUnitRef,
  buildDeviceIndexMap,
  isPinIgnored,
} from "./pin-resolver.js";
import type { PinMapData } from "./structure-types.js";
import type { PlacedInstance, T0x10 } from "./structures.js";
import type { PageData } from "./page-parser.js";

const pin = (pinIndex: number): T0x10 => ({
  pinIndex,
  pointX: 0,
  pointY: 0,
  netId: 0,
  symbolDisplayProps: [],
});

const instance = (sourcePackage: string, pinCount: number, pkgName?: string): PlacedInstance => ({
  pkgName: pkgName ?? `${sourcePackage}.Normal`,
  dbId: 1,
  reference: "X1",
  sourcePackage,
  partValueIdx: 0,
  prefixProperties: [],
  locX: 0,
  locY: 0,
  symbolDisplayProps: [],
  t0x10s: Array.from({ length: pinCount }, (_, i) => pin(i + 1)),
  sectionIndex: 0,
});

const pinMapData = (
  pinMaps: Record<string, (string | null)[]>,
  cachePinMaps: Record<string, (string | null)[]> = {},
  pinIgnores: Record<string, boolean[]> = {},
  cachePinIgnores: Record<string, boolean[]> = {}
): PinMapData => ({
  pinMaps: new Map(Object.entries(pinMaps)),
  cachePinMaps: new Map(Object.entries(cachePinMaps)),
  deviceUnitRefs: new Map(),
  pinIgnores: new Map(Object.entries(pinIgnores)),
  cachePinIgnores: new Map(Object.entries(cachePinIgnores)),
});

describe("resolvePinNumber", () => {
  it("maps the pin index through the Packages/ pin map", () => {
    const inst = instance("RES", 2);
    const pmd = pinMapData({ RES: ["1", "2"] });

    expect(resolvePinNumber(pin(1), inst, pmd)).toBe("1");
    expect(resolvePinNumber(pin(2), inst, pmd)).toBe("2");
  });

  it("prefers the Cache map when the package has pads the symbol does not expose", () => {
    const inst = instance("XTAL", 2);
    const pmd = pinMapData({ XTAL: ["1", "2", "3", "4"] }, { XTAL: ["1", "3"] });

    expect(resolvePinNumber(pin(2), inst, pmd)).toBe("3");
  });

  it("falls back to the Cache map when the Packages/ lookup misses entirely", () => {
    const inst = instance("XTAL_4PAD", 4);
    const pmd = pinMapData({ SOMETHING_ELSE: ["9", "9"] }, { XTAL_4PAD: ["1", "3", "2", "4"] });

    expect(resolvePinNumber(pin(1), inst, pmd)).toBe("1");
    expect(resolvePinNumber(pin(2), inst, pmd)).toBe("3");
    expect(resolvePinNumber(pin(3), inst, pmd)).toBe("2");
    expect(resolvePinNumber(pin(4), inst, pmd)).toBe("4");
  });

  it("falls back to the Cache map when the Packages/ map has a null at the index", () => {
    const inst = instance("CONN", 3);
    const pmd = pinMapData({ CONN: ["1", null, "3"] }, { CONN: ["1", "7", "3"] });

    expect(resolvePinNumber(pin(2), inst, pmd)).toBe("7");
  });

  it("uses the symbol record order only when neither map resolves the pin", () => {
    const inst = instance("UNKNOWN_PART", 2);
    const pmd = pinMapData({});

    expect(resolvePinNumber(pin(1), inst, pmd)).toBe("1");
    expect(resolvePinNumber(pin(2), inst, pmd)).toBe("2");
  });

  it("does not consult the Cache map past its end", () => {
    const inst = instance("SHORT", 4);
    const pmd = pinMapData({}, { SHORT: ["1", "2"] });

    expect(resolvePinNumber(pin(3), inst, pmd)).toBe("3");
  });

  it("treats a non-positive pin index as pin 1", () => {
    const inst = instance("RES", 2);
    const pmd = pinMapData({ RES: ["5", "6"] });

    expect(resolvePinNumber(pin(0), inst, pmd)).toBe("1");
  });
});

describe("findPinMap", () => {
  it("matches a multi-unit package through the doubled unit letter in pkgName", () => {
    const inst = instance("OMAP_CBP", 2, "OMAP_CBPAA.Normal");
    const maps = new Map<string, (string | null)[]>([["OMAP_CBPA", ["A1", "A2"]]]);

    expect(findPinMap(inst, maps, new Map())).toEqual(["A1", "A2"]);
  });

  it("selects the device positionally when pkgName carries no unit suffix", () => {
    const inst = instance("RPAK", 2);
    const maps = new Map<string, (string | null)[]>([
      ["RPAKA", ["1", "16"]],
      ["RPAKB", ["2", "15"]],
    ]);
    const unitRefs = new Map<string, string[]>([["RPAK", ["A", "B"]]]);

    expect(findPinMap(inst, maps, unitRefs, 1)).toEqual(["2", "15"]);
  });
});

describe("buildDeviceIndexMap", () => {
  const placed = (
    reference: string,
    dbId: number,
    sectionIndex: number,
    pkgName?: string
  ): PlacedInstance => ({
    ...instance("RPAK_8RES", 2, pkgName),
    reference,
    dbId,
    sectionIndex,
  });

  const page = (placedInstances: PlacedInstance[]): PageData =>
    ({
      name: "P1",
      netTable: new Map(),
      wires: [],
      placedInstances,
      ports: [],
      globals: [],
      offPageConnectors: [],
    }) as PageData;

  it("indexes each instance by its own section, not by dbId order", () => {
    // dbId order and section order disagree: the sections were placed on the
    // sheet in an order Cadence did not allocate dbIds in.
    const map = buildDeviceIndexMap([
      page([placed("RP3", 100, 0), placed("RP3", 108, 2), placed("RP3", 116, 1)]),
    ]);

    expect(map.get(100)).toBe(0);
    expect(map.get(108)).toBe(2);
    expect(map.get(116)).toBe(1);
  });

  it("indexes a lone placed section by its real section, not zero", () => {
    const map = buildDeviceIndexMap([page([placed("RP9", 200, 5)])]);

    expect(map.get(200)).toBe(5);
  });

  it("spans pages for one multi-section part", () => {
    const map = buildDeviceIndexMap([page([placed("RP1", 300, 0)]), page([placed("RP1", 301, 3)])]);

    expect(map.get(300)).toBe(0);
    expect(map.get(301)).toBe(3);
  });

  it("skips instances whose pkgName already carries a unit suffix", () => {
    const map = buildDeviceIndexMap([
      page([placed("U4", 400, 1, "RPAK_8RESB.Normal"), placed("U5", 401, 0)]),
    ]);

    expect(map.has(400)).toBe(false);
    expect(map.get(401)).toBe(0);
  });

  it("skips instances without a usable refdes", () => {
    const map = buildDeviceIndexMap([page([placed("", 500, 1), placed("?", 501, 1)])]);

    expect(map.size).toBe(0);
  });
});

describe("extractUnitRef", () => {
  it("returns the unit letters between the package name and the view suffix", () => {
    expect(extractUnitRef(instance("DP_HDMI_CONN", 2, "DP_HDMI_CONNA.Normal"))).toBe("A");
    expect(extractUnitRef(instance("OMAP_CBP", 2, "OMAP_CBPAA.Normal"))).toBe("AA");
  });

  it("returns undefined when the instance has no unit suffix", () => {
    expect(extractUnitRef(instance("RES", 2))).toBeUndefined();
  });
});

describe("pin map selection by symbol pin count", () => {
  it("prefers the Cache map when the package map is shorter than the symbol", () => {
    // CutiePi's HDMI connector: a 23-pin symbol, and a 20-entry package map that
    // cannot describe it, whose 17th and 18th entries are transposed. Riding on
    // it swapped SCL and SDA. The Cache map has exactly 23 entries.
    const inst = instance("CON_HDMI_RA", 23);
    const packageMap = [
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "10",
      "11",
      "12",
      "13",
      "14",
      "15",
      "16",
      "18",
      "17",
      "19",
      "20",
    ];
    const cacheMap = Array.from({ length: 23 }, (_, i) => String(i + 1));
    const pmd = pinMapData({ CON_HDMI_RA: packageMap }, { CON_HDMI_RA: cacheMap });

    expect(resolvePinNumber(pin(17), inst, pmd)).toBe("17");
    expect(resolvePinNumber(pin(18), inst, pmd)).toBe("18");
  });

  it("keeps using the package map when its length matches the symbol", () => {
    // A transposition that the package map genuinely declares must survive: the
    // symbol's pin order need not be the package's numbering.
    const inst = instance("CON", 4);
    const pmd = pinMapData({ CON: ["1", "2", "4", "3"] }, { CON: ["1", "2", "3", "4"] });

    expect(resolvePinNumber(pin(3), inst, pmd)).toBe("4");
    expect(resolvePinNumber(pin(4), inst, pmd)).toBe("3");
  });

  it("keeps the package map when neither map matches the symbol's pin count", () => {
    const inst = instance("PART", 5);
    const pmd = pinMapData({ PART: ["9", "8", "7"] }, { PART: ["1", "2"] });

    expect(resolvePinNumber(pin(2), inst, pmd)).toBe("8");
  });
});

describe("isPinIgnored", () => {
  // A quad RJ45 whose sections do not all expose the same logical pins: the
  // second shield pin exists only on the fourth, which Cadence exports as
  // PIN_NUMBER='(0,0,0,S5)'. The DSN marks the absent ones "Pin Ignore".
  const quadRj45 = (): PinMapData =>
    pinMapData(
      {
        "RJ45-1": ["A1", "S1", "SS1"],
        "RJ45-4": ["D1", "S4", "S5"],
      },
      {},
      {
        "RJ45-1": [false, false, true],
        "RJ45-4": [false, false, false],
      }
    );

  const section = (unitRef: string): PlacedInstance => ({
    ...instance("RJ45", 3),
    pkgName: `RJ45${unitRef}.Normal`,
  });

  it("reports a pin the section has no pad for", () => {
    expect(isPinIgnored(pin(3), section("-1"), quadRj45())).toBe(true);
  });

  it("does not report the same logical pin on a section that has it", () => {
    expect(isPinIgnored(pin(3), section("-4"), quadRj45())).toBe(false);
  });

  it("does not report pins the section does expose", () => {
    expect(isPinIgnored(pin(1), section("-1"), quadRj45())).toBe(false);
    expect(isPinIgnored(pin(2), section("-1"), quadRj45())).toBe(false);
  });

  it("reports nothing when the design records no flags", () => {
    const inst = instance("RES", 2);
    expect(isPinIgnored(pin(1), inst, pinMapData({ RES: ["1", "2"] }))).toBe(false);
  });

  it("reports nothing for a pin index outside the recorded flags", () => {
    const inst = instance("RES", 2);
    const pmd = pinMapData({ RES: ["1", "2"] }, {}, { RES: [false, false] });

    expect(isPinIgnored(pin(9), inst, pmd)).toBe(false);
    expect(isPinIgnored(pin(0), inst, pmd)).toBe(false);
  });
});

describe("Pin Ignore flags follow the map that supplied the pin number", () => {
  it("reads the Cache flags when the pin number came from the Cache map", () => {
    // CutiePi's CON_HDMI_RA: 23-pin symbol, 20-entry package map, 23-entry Cache
    // map. The number comes from the Cache, so the flag must too; indexing the
    // 20-entry package flags with a Cache pin index reads a different pin.
    const inst = instance("CON_HDMI_RA", 23);
    const packageMap = Array.from({ length: 20 }, (_, i) => String(i + 1));
    const cacheMap = Array.from({ length: 23 }, (_, i) => String(i + 1));
    const pmd = pinMapData(
      { CON_HDMI_RA: packageMap },
      { CON_HDMI_RA: cacheMap },
      // Package flags: pin 17 ignored. Cache flags: pin 17 kept, pin 23 ignored.
      { CON_HDMI_RA: Array.from({ length: 20 }, (_, i) => i === 16) },
      { CON_HDMI_RA: Array.from({ length: 23 }, (_, i) => i === 22) }
    );

    expect(isPinIgnored(pin(17), inst, pmd)).toBe(false);
    expect(isPinIgnored(pin(23), inst, pmd)).toBe(true);
  });

  it("reads the package flags when the package map supplied the number", () => {
    const inst = instance("PART", 3);
    const pmd = pinMapData(
      { PART: ["1", "2", "3"] },
      { PART: ["1", "2"] },
      { PART: [false, false, true] },
      { PART: [true, false] }
    );

    expect(isPinIgnored(pin(3), inst, pmd)).toBe(true);
    expect(isPinIgnored(pin(1), inst, pmd)).toBe(false);
  });

  it("uses the Cache flags for a part absent from the package stream", () => {
    // The quad RJ45 that motivated Pin Ignore is Cache-only in its design.
    const inst = { ...instance("RJ45", 3), pkgName: "RJ45-1.Normal" };
    const pmd = pinMapData(
      {},
      { "RJ45-1": ["A1", "S1", "SS1"] },
      {},
      { "RJ45-1": [false, false, true] }
    );

    expect(isPinIgnored(pin(3), inst, pmd)).toBe(true);
    expect(isPinIgnored(pin(2), inst, pmd)).toBe(false);
  });
});
