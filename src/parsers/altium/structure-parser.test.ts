import { describe, it, expect } from "vitest";
import {
  parseProjectStructure,
  findRepeatedSheets,
  expandRepeatDesignator,
} from "./structure-parser.js";

describe("parseProjectStructure", () => {
  it("should parse TopLevelDocument", () => {
    const content = "Record=TopLevelDocument|FileName=main.SchDoc\n";
    const result = parseProjectStructure(content);
    expect(result.topLevelDocument).toBe("main.SchDoc");
  });

  it("should parse SheetSymbol records", () => {
    const content = [
      "Record=TopLevelDocument|FileName=main.SchDoc",
      "Record=SheetSymbol|SourceDocument=main.SchDoc|Designator=AY1|SchDesignator=Repeat(AY,1,3)|FileName=ay.SchDoc",
      "Record=SheetSymbol|SourceDocument=main.SchDoc|Designator=AY2|SchDesignator=Repeat(AY,1,3)|FileName=ay.SchDoc",
      "Record=SheetSymbol|SourceDocument=main.SchDoc|Designator=AY3|SchDesignator=Repeat(AY,1,3)|FileName=ay.SchDoc",
    ].join("\n");

    const result = parseProjectStructure(content);
    expect(result.sheetInstances).toHaveLength(3);
    expect(result.sheetInstances[0].designator).toBe("AY1");
    expect(result.sheetInstances[0].fileName).toBe("ay.SchDoc");
    expect(result.sheetInstances[0].schDesignator).toBe("Repeat(AY,1,3)");
  });

  it("should handle empty lines and whitespace", () => {
    const content = "\n  \nRecord=TopLevelDocument|FileName=main.SchDoc\n\n";
    const result = parseProjectStructure(content);
    expect(result.topLevelDocument).toBe("main.SchDoc");
    expect(result.sheetInstances).toHaveLength(0);
  });

  it("should handle Windows line endings", () => {
    const content =
      "Record=TopLevelDocument|FileName=main.SchDoc\r\nRecord=SheetSymbol|SourceDocument=main.SchDoc|Designator=X|SchDesignator=X|FileName=x.SchDoc\r\n";
    const result = parseProjectStructure(content);
    expect(result.topLevelDocument).toBe("main.SchDoc");
    expect(result.sheetInstances).toHaveLength(1);
  });
});

describe("findRepeatedSheets", () => {
  it("should identify sheets with multiple instances", () => {
    const content = [
      "Record=TopLevelDocument|FileName=main.SchDoc",
      "Record=SheetSymbol|SourceDocument=main.SchDoc|Designator=AY1|SchDesignator=Repeat(AY,1,3)|FileName=ay.SchDoc",
      "Record=SheetSymbol|SourceDocument=main.SchDoc|Designator=AY2|SchDesignator=Repeat(AY,1,3)|FileName=ay.SchDoc",
      "Record=SheetSymbol|SourceDocument=main.SchDoc|Designator=AY3|SchDesignator=Repeat(AY,1,3)|FileName=ay.SchDoc",
      "Record=SheetSymbol|SourceDocument=main.SchDoc|Designator=Mixer|SchDesignator=Mixer|FileName=mixer.SchDoc",
    ].join("\n");

    const structure = parseProjectStructure(content);
    const repeated = findRepeatedSheets(structure);

    expect(repeated.size).toBe(1);
    expect(repeated.has("ay.schdoc")).toBe(true);
    expect(repeated.get("ay.schdoc")).toHaveLength(3);
  });

  it("should not include single-instance sheets", () => {
    const content = [
      "Record=TopLevelDocument|FileName=main.SchDoc",
      "Record=SheetSymbol|SourceDocument=main.SchDoc|Designator=Mixer|SchDesignator=Mixer|FileName=mixer.SchDoc",
    ].join("\n");

    const structure = parseProjectStructure(content);
    const repeated = findRepeatedSheets(structure);

    expect(repeated.size).toBe(0);
  });
});

describe("expandRepeatDesignator", () => {
  it("expands a repeat range into one designator per channel", () => {
    expect(expandRepeatDesignator("Repeat(AY,1,3)")).toEqual(["AY1", "AY2", "AY3"]);
  });

  it("tolerates the spacing variants Altium writes in practice", () => {
    // Each spelling below was observed verbatim in a real Altium project.
    expect(expandRepeatDesignator("Repeat(AY,1,3)")).toEqual(["AY1", "AY2", "AY3"]);
    expect(expandRepeatDesignator("Repeat(ideal_diode, 1, 2)")).toEqual([
      "ideal_diode1",
      "ideal_diode2",
    ]);
    expect(expandRepeatDesignator("Repeat(CHAN, 1,9)")).toHaveLength(9);
    expect(expandRepeatDesignator("  Repeat(CH,1,4)  ")).toEqual(["CH1", "CH2", "CH3", "CH4"]);
  });

  it("starts from the declared index rather than assuming 1", () => {
    expect(expandRepeatDesignator("Repeat(M,5,8)")).toEqual(["M5", "M6", "M7", "M8"]);
  });

  it("ignores a designator that is not a repeat", () => {
    expect(expandRepeatDesignator("U_Power")).toEqual([]);
    expect(expandRepeatDesignator("")).toEqual([]);
    expect(expandRepeatDesignator("Repeat(CS)")).toEqual([]);
  });

  it("ignores a range that yields fewer than two channels", () => {
    // A single instance is not multi-channel, and expanding it would rename a
    // component that Altium leaves alone.
    expect(expandRepeatDesignator("Repeat(X,1,1)")).toEqual([]);
    expect(expandRepeatDesignator("Repeat(X,3,2)")).toEqual([]);
  });
});
