import { describe, it, expect } from "vitest";
import { readSheetNumber } from "./document.js";
import { RECORD_TYPES } from "./types.js";
import type { AltiumRecord, AltiumSchematic } from "./types.js";

describe("readSheetNumber", () => {
  const parameter = (name: string, text: string): AltiumRecord => ({
    RECORD: RECORD_TYPES.PARAMETER,
    Name: name,
    Text: text,
    index: 0,
  });

  it("reads a document parameter written at the root of the hierarchy", () => {
    const schematic: AltiumSchematic = { header: [], records: [parameter("SheetNumber", "3")] };
    expect(readSheetNumber(schematic)).toBe("3");
  });

  it("reads a document parameter hung off the SHEET record instead", () => {
    const schematic: AltiumSchematic = {
      header: [],
      records: [
        { RECORD: RECORD_TYPES.SHEET, index: 0, children: [parameter("SheetNumber", "7")] },
      ],
    };
    expect(readSheetNumber(schematic)).toBe("7");
  });

  it("ignores a component that carries its own SheetNumber property", () => {
    const schematic: AltiumSchematic = {
      header: [],
      records: [
        { RECORD: RECORD_TYPES.COMPONENT, index: 0, children: [parameter("SheetNumber", "99")] },
        parameter("SheetNumber", "4"),
      ],
    };
    expect(readSheetNumber(schematic)).toBe("4");
  });

  it("finds nothing when only a component claims a SheetNumber", () => {
    const schematic: AltiumSchematic = {
      header: [],
      records: [
        { RECORD: RECORD_TYPES.COMPONENT, index: 0, children: [parameter("SheetNumber", "99")] },
      ],
    };
    expect(readSheetNumber(schematic)).toBeUndefined();
  });

  it("ignores the placeholder an unnumbered sheet carries", () => {
    const schematic: AltiumSchematic = { header: [], records: [parameter("SheetNumber", "*")] };
    expect(readSheetNumber(schematic)).toBeUndefined();
  });

  it("matches the parameter name however it is cased", () => {
    const schematic: AltiumSchematic = { header: [], records: [parameter("sheetnumber", "2")] };
    expect(readSheetNumber(schematic)).toBe("2");
  });
});
