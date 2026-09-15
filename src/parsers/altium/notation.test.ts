import { describe, it, expect } from "vitest";
import {
  busMemberTest,
  expandBusRange,
  identifierKey,
  repeatBaseName,
  repeatChannels,
  repeatSheetName,
  unescapeOverbar,
} from "./notation.js";

describe("busMemberTest", () => {
  it("accepts the members of a range and nothing else", () => {
    const inRange = busMemberTest("AD[0..11]")!;
    expect(inRange("AD0")).toBe(true);
    expect(inRange("AD11")).toBe(true);
    expect(inRange("AD12")).toBe(false);
    expect(inRange("ADC")).toBe(false);
    expect(inRange("AD")).toBe(false);
  });

  it("reads a descending range and an overbar", () => {
    expect(busMemberTest("D[3..0]")!("D2")).toBe(true);
    expect(busMemberTest("C\\S\\[1..2]")!("CS2")).toBe(true);
  });

  it("accepts any index for a Repeat() identifier", () => {
    const repeated = busMemberTest("Repeat(OP_OUT_P)")!;
    expect(repeated("OP_OUT_P9")).toBe(true);
    expect(repeated("OP_OUT_P")).toBe(false);
    expect(repeated("OP_OUT_N1")).toBe(false);
  });

  it("is undefined for a plain name", () => {
    expect(busMemberTest("CLK")).toBeUndefined();
  });
});

describe("expandBusRange and repeatBaseName", () => {
  it("lists a finite range", () => {
    expect(expandBusRange("DAC[1..2]")).toEqual(["DAC1", "DAC2"]);
    expect(expandBusRange("Repeat(X)")).toEqual([]);
  });

  it("finds the base of a Repeat() identifier", () => {
    expect(repeatBaseName("Repeat( TEMP_A )")).toBe("TEMP_A");
    expect(repeatBaseName("TEMP_A")).toBeUndefined();
  });
});

describe("identifierKey and unescapeOverbar", () => {
  it("ignores ASCII case only", () => {
    expect(identifierKey("VBat")).toBe(identifierKey("VBAT"));
    expect(identifierKey("10µA")).not.toBe(identifierKey("10μA"));
  });

  it("removes overbar escapes", () => {
    expect(unescapeOverbar("C\\S\\")).toBe("CS");
  });
});

describe("repeatChannels", () => {
  it("expands a Repeat() designator, whatever its spacing", () => {
    expect(repeatChannels("Repeat(AY, 1,3)")).toEqual([
      { designator: "AY1", index: 1 },
      { designator: "AY2", index: 2 },
      { designator: "AY3", index: 3 },
    ]);
    expect(repeatSheetName("Repeat(AY, 1,3)")).toBe("AY");
  });

  it("gives no channels for a plain designator or a single index", () => {
    expect(repeatChannels("AY1")).toEqual([]);
    expect(repeatChannels("Repeat(AY,2,2)")).toEqual([]);
  });
});
