import { describe, it, expect } from "vitest";
import { splitLines } from "./lines.js";

describe("splitLines", () => {
  it("ends a line at LF, CR LF and CR CR LF alike", () => {
    expect(splitLines("A=1\nB=2\r\nC=3\r\r\nD=4")).toEqual(["A=1", "B=2", "C=3", "D=4"]);
  });

  it("keeps a CR with no LF after it as part of its line", () => {
    expect(splitLines("Value=x\ry\r\nNext=1")).toEqual(["Value=x\ry", "Next=1"]);
  });
});
