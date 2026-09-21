import { describe, expect, it } from "vitest";
import { parseBusName } from "./bus-name.js";

describe("parseBusName", () => {
  it("lists a descending range's members from the first index written", () => {
    expect(parseBusName("DATA[3:0]")).toEqual({ base: "DATA", indices: [3, 2, 1, 0] });
  });

  it("lists an ascending range in its own order", () => {
    expect(parseBusName("OUT_N[1:3]")).toEqual({ base: "OUT_N", indices: [1, 2, 3] });
  });

  it.each(["A[7..4]", "A[7-4]", "A[ 7 : 4 ]"])("accepts the separator in %s", (name) => {
    expect(parseBusName(name)).toEqual({ base: "A", indices: [7, 6, 5, 4] });
  });

  it("keeps a trailing underscore in the base", () => {
    expect(parseBusName("FMC_GA_[1:0]")).toEqual({ base: "FMC_GA_", indices: [1, 0] });
  });

  it("is undefined for a scalar name", () => {
    expect(parseBusName("CLK")).toBeUndefined();
    expect(parseBusName("D3")).toBeUndefined();
  });
});
