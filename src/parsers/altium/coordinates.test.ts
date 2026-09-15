import { describe, expect, it } from "vitest";
import {
  COORDINATE_SCALE,
  TOUCH_TOLERANCE,
  entryOffset,
  pointOnSegment,
  pointsTouch,
  polylinePoints,
  portEnds,
  scaledField,
  scaledPoint,
  sheetEntryPoint,
} from "./coordinates.js";

const units = (value: number): number => Math.round(value * COORDINATE_SCALE);

describe("scaledField", () => {
  it("reads _Frac as hundred-thousandths of a unit", () => {
    expect(scaledField({ Width: "44", Width_Frac: "35626" }, "Width")).toBe(units(44.35626));
  });

  it("puts an auto-sized port's far end on the harness line drawn to it", () => {
    const port = { "Location.X": "270", "Location.Y": "275", Width: "44", Width_Frac: "35626" };
    const line = {
      LocationCount: "2",
      X1: "314",
      X1_Frac: "35626",
      Y1: "275",
      X2: "320",
      Y2: "275",
    };
    expect(portEnds(port)[1]).toEqual(polylinePoints(line)[0]);
  });

  it("reads upper-case keys", () => {
    const record = { "LOCATION.X": "10", "LOCATION.X_FRAC": "50000", "LOCATION.Y": "20" };
    expect(scaledPoint(record)).toEqual([units(10.5), units(20)]);
  });
});

describe("polylinePoints", () => {
  it("reads LocationCount vertices in index order", () => {
    expect(polylinePoints({ LocationCount: "2", X2: "3", Y2: "4", X1: "1", Y1: "2" })).toEqual([
      [units(1), units(2)],
      [units(3), units(4)],
    ]);
  });

  it("puts a coordinate the record leaves out at 0", () => {
    expect(polylinePoints({ LOCATIONCOUNT: "2", X1: "985", Y1: "30", X2: "985" })).toEqual([
      [units(985), units(30)],
      [units(985), 0],
    ]);
  });
});

describe("sheetEntryPoint", () => {
  const symbol = { "Location.X": "100", "Location.Y": "200", XSize: "50", YSize: "40" };

  it("places an entry on each side", () => {
    const at = (Side: string) => sheetEntryPoint(symbol, { Side, DistanceFromTop: "2" });
    expect(at("0")).toEqual([units(100), units(180)]);
    expect(at("1")).toEqual([units(150), units(180)]);
    expect(at("2")).toEqual([units(120), units(200)]);
    expect(at("3")).toEqual([units(120), units(160)]);
  });

  it("adds the symbol's and the entry's fractions", () => {
    const fractional = { "Location.Y": "390", "Location.Y_Frac": "55120" };
    const entry = { DistanceFromTop: "2", DistanceFromTop_Frac1: "555120" };
    expect(entryOffset(entry)).toBe(units(25.5512));
    expect(sheetEntryPoint(fractional, entry)[1]).toBe(units(365));
  });
});

describe("portEnds", () => {
  it("runs a vertical port upward", () => {
    const port = { "Location.X": "10", "Location.Y": "20", Width: "30", Style: "4" };
    expect(portEnds(port)).toEqual([
      [units(10), units(20)],
      [units(10), units(50)],
    ]);
  });
});

describe("touch tolerance", () => {
  it("is half a unit", () => {
    expect(TOUCH_TOLERANCE).toBe(units(0.5));
    expect(pointsTouch([0, 0], [units(0.5), 0])).toBe(true);
    expect(pointsTouch([0, 0], [units(0.5) + 1, 0])).toBe(false);
  });

  it("applies along a segment", () => {
    const segment: [[number, number], [number, number]] = [
      [0, 0],
      [units(10), 0],
    ];
    expect(pointOnSegment([units(5), units(0.5)], segment)).toBe(true);
    expect(pointOnSegment([units(5), units(0.5) + 1], segment)).toBe(false);
    expect(pointOnSegment([units(10.5), 0], segment)).toBe(true);
  });
});
