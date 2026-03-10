import { describe, it, expect } from "vitest";
import { parseProjectStructure, findRepeatedSheets } from "./structure-parser.js";

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
