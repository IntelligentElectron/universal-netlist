import { describe, expect, it } from "vitest";
import { renderAltiumSheet } from "./page-render.js";
import type { AltiumRecord } from "./types.js";

const size = { width: 1150, height: 760 };
const draw = (records: Partial<AltiumRecord>[], parameters: Record<string, string> = {}) =>
  renderAltiumSheet(records as AltiumRecord[], size, (d) => d, parameters);

describe("renderAltiumSheet", () => {
  it("flips y so the sheet's bottom edge is at the bottom of the drawing", () => {
    const svg = draw([
      { index: 0, RECORD: "27", LocationCount: "2", X1: "100", Y1: "700", X2: "200", Y2: "700" },
    ]);
    // y 700 of 760, measured from the bottom, is 60 units from the top.
    expect(svg).toContain(`d="M100 60L200 60"`);
    expect(svg).toMatch(/viewBox="0 0 11500 7600"/);
  });

  it("draws only the instance's part, its designator with the part letter, fills first", () => {
    const component: Partial<AltiumRecord> = {
      index: 0,
      RECORD: "1",
      CurrentPartId: "2",
      PartCount: "3",
      children: [
        {
          index: 1,
          RECORD: "4",
          OwnerPartId: "1",
          Text: "PART_A",
          "Location.X": "10",
          "Location.Y": "10",
        },
        {
          index: 2,
          RECORD: "4",
          OwnerPartId: "2",
          Text: "PART_B",
          "Location.X": "10",
          "Location.Y": "10",
        },
        {
          index: 3,
          RECORD: "34",
          OwnerPartId: "-1",
          Text: "U1",
          "Location.X": "10",
          "Location.Y": "20",
        },
        {
          index: 4,
          RECORD: "14",
          OwnerPartId: "2",
          IsSolid: "T",
          "Location.X": "0",
          "Location.Y": "0",
          "Corner.X": "50",
          "Corner.Y": "50",
        },
      ] as AltiumRecord[],
    };
    const svg = draw([component]);
    expect(svg).not.toContain("PART_A");
    expect(svg).toContain("PART_B");
    expect(svg).toContain(">U1B<");
    expect(svg.indexOf('<rect x="0"')).toBeLessThan(svg.indexOf("PART_B"));
  });

  it("shows a =parameter's value and leaves out one it cannot resolve", () => {
    const label = (text: string, i: number) => ({
      index: i,
      RECORD: "4",
      Text: text,
      "Location.X": "10",
      "Location.Y": "10",
    });
    const svg = draw([label("=Revision", 0), label("=ModifiedDate", 1)], { Revision: "B" });
    expect(svg).toContain(">B<");
    expect(svg).not.toContain("ModifiedDate");
  });

  it("turns a power port toward its body: a ground at orientation 3 hangs down", () => {
    const svg = draw([
      {
        index: 0,
        RECORD: "17",
        Text: "GND",
        Style: "4",
        Orientation: "3",
        "Location.X": "100",
        "Location.Y": "100",
      },
    ]);
    expect(svg).toContain("rotate(180)");
  });

  it("shows a component's =Value comment from its own parameters", () => {
    const svg = draw([
      {
        index: 0,
        RECORD: "1",
        children: [
          { index: 1, RECORD: "41", Name: "Value", Text: "10K", IsHidden: "T" },
          {
            index: 2,
            RECORD: "41",
            Name: "Comment",
            Text: "=Value",
            "Location.X": "10",
            "Location.Y": "10",
          },
        ] as AltiumRecord[],
      },
    ]);
    expect(svg).toContain(">10K<");
  });
});
