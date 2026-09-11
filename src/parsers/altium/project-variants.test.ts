import { describe, expect, it } from "vitest";
import {
  applyAltiumVariant,
  parseAltiumProjectVariants,
  parseAltiumVariation,
} from "./project-variants.js";
import type { ComponentDetails } from "../../types.js";

const project = [
  "[Design]",
  "CurrentVariant=Production",
  "",
  "[ProjectVariant1]",
  "Description=Production",
  "AllowFabrication=1",
  "VariationCount=3",
  "Variation1=Designator=R1|UniqueId=\\ABC|Kind=1|AlternatePart= ",
  "Variation2=Designator=R2|UniqueId=\\DEF|Kind=0|AlternatePart=0R|Comment=0R",
  "Variation3=Designator=U1|UniqueId=\\GHI|Kind=2|AlternatePart==Value|AltLibLink_DesignItemID=LM358|AltLibLink_Footprint=SOIC-8",
  "ParamVariationCount=4",
  "ParamVariation1=ParameterName=Comment|VariantValue==Value",
  "ParamDesignator1=U1",
  "ParamVariation2=ParameterName=Value|VariantValue=LM358",
  "ParamDesignator2=U1",
  "ParamVariation3=ParameterName=Manufacturer Part Number|VariantValue=LM358DR",
  "ParamDesignator3=U1",
  "ParamVariation4=ParameterName=Value|VariantValue=0R",
  "ParamDesignator4=R2",
  "",
  "[ProjectVariant2]",
  "Description=Debug",
  "AllowFabrication=0",
  "VariationCount=1",
  "Variation1=Designator=R1|UniqueId=\\ABC|Kind=0|AlternatePart= ",
  "",
].join("\n");

describe("parseAltiumVariation", () => {
  it("reads designator, unique id, and native kind from a project row", () => {
    expect(
      parseAltiumVariation("Designator=R23|UniqueId=\\EVVHJLMB|Kind=1|AlternatePart= ")
    ).toEqual({ designator: "R23", uniqueId: "\\EVVHJLMB", kind: 1, parameters: {} });
  });

  it("names the library item an alternate-part row substitutes", () => {
    expect(
      parseAltiumVariation(
        "Designator=R94|UniqueId=\\QHTSDXVH\\AWXOAPPG|Kind=2|AlternatePart==Value|AltLibLink_DesignItemID=CRG0805F12K"
      )
    ).toMatchObject({ designator: "R94", kind: 2, alternatePart: "CRG0805F12K" });
    // `=Value` is the comment expression, not a part, so it never becomes one.
    expect(
      parseAltiumVariation("Designator=R2|Kind=2|AlternatePart==Value")?.alternatePart
    ).toBeUndefined();
  });

  it("rejects rows whose identity or kind is malformed", () => {
    expect(parseAltiumVariation("UniqueId=\\ABC|Kind=1")).toBeUndefined();
    expect(parseAltiumVariation("Designator=R1|Kind=NotFitted")).toBeUndefined();
  });
});

describe("parseAltiumProjectVariants", () => {
  it("reads numbered sections in stored order with their fabrication flag and parameter rows", () => {
    expect(parseAltiumProjectVariants(project)).toEqual([
      {
        name: "Production",
        fabrication: true,
        variations: [
          { designator: "R1", uniqueId: "\\ABC", kind: 1, parameters: {} },
          {
            designator: "R2",
            uniqueId: "\\DEF",
            kind: 0,
            alternatePart: "0R",
            parameters: { Value: "0R" },
          },
          {
            designator: "U1",
            uniqueId: "\\GHI",
            kind: 2,
            alternatePart: "LM358",
            parameters: {
              Comment: "=Value",
              Value: "LM358",
              "Manufacturer Part Number": "LM358DR",
            },
          },
        ],
      },
      {
        name: "Debug",
        fabrication: false,
        variations: [{ designator: "R1", uniqueId: "\\ABC", kind: 0, parameters: {} }],
      },
    ]);
  });

  it("falls back to the section name and discovered rows when metadata is absent", () => {
    expect(
      parseAltiumProjectVariants(
        "[ProjectVariant7]\r\nVariation1=Designator=C1|Kind=1\r\nVariation2=bad\r\n"
      )
    ).toEqual([
      {
        name: "ProjectVariant7",
        variations: [{ designator: "C1", kind: 1, parameters: {} }],
      },
    ]);
  });
});

describe("applyAltiumVariant", () => {
  const components = (): ComponentDetails => ({
    R1: { pins: {} },
    R2: { pins: {}, value: "10k" },
    U1: { pins: {}, value: "TL072", mpn: "TL072CD", manufacturer: "TI" },
  });
  const variants = parseAltiumProjectVariants(project);

  it("marks Not Fitted rows from the selected variant and nothing else", () => {
    const result = components();
    applyAltiumVariant(result, variants, "production");
    expect(result.R1.dns).toBe(true);
    expect(result.R2.dns).toBeUndefined();
    expect(result.U1.dns).toBeUndefined();
  });

  it("substitutes an alternate part and flags it, keeping fields the variant does not touch", () => {
    const result = components();
    applyAltiumVariant(result, variants, "Production");
    expect(result.U1).toEqual({
      pins: {},
      value: "LM358",
      mpn: "LM358DR",
      manufacturer: "TI",
      alternate_part: true,
    });
  });

  it("applies parameter overrides to a fitted row without flagging an alternate part", () => {
    const result = components();
    applyAltiumVariant(result, variants, "Production");
    expect(result.R2).toEqual({ pins: {}, value: "0R" });
    expect(result.R2.alternate_part).toBeUndefined();
  });

  it("leaves the explicit base design unchanged", () => {
    const result = components();
    applyAltiumVariant(result, variants, "<Default>");
    expect(result).toEqual(components());
  });

  it("rejects an unknown selection rather than falling back to fitted", () => {
    expect(() => applyAltiumVariant(components(), variants, "missing")).toThrow(
      "Available: ['Production', 'Debug', '<Default>']"
    );
  });
});
