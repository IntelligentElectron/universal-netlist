import { describe, expect, it } from "vitest";
import {
  applyAltiumVariant,
  parseAltiumProjectVariants,
  parseAltiumVariation,
} from "./project-variants.js";
import type { ComponentDetails } from "../../types.js";

const project = `[Design]\nCurrentVariant=Production\n\n[ProjectVariant1]\nDescription=Production\nVariationCount=3\nVariation1=Designator=R1|UniqueId=\\ABC|Kind=1|AlternatePart= \nVariation2=Designator=R2|UniqueId=\\DEF|Kind=0|AlternatePart=0R|Comment=0R\nVariation3=Designator=U1|UniqueId=\\GHI|Kind=2|AlternatePart=SomePart\nParamVariationCount=0\n\n[ProjectVariant2]\nDescription=Debug\nVariationCount=1\nVariation1=Designator=R1|UniqueId=\\ABC|Kind=0|AlternatePart= \n`;

describe("parseAltiumVariation", () => {
  it("reads designator, unique id, and native kind from a project row", () => {
    expect(
      parseAltiumVariation("Designator=R23|UniqueId=\\EVVHJLMB|Kind=1|AlternatePart= ")
    ).toEqual({ designator: "R23", uniqueId: "\\EVVHJLMB", kind: 1 });
  });

  it("rejects rows whose identity or kind is malformed", () => {
    expect(parseAltiumVariation("UniqueId=\\ABC|Kind=1")).toBeUndefined();
    expect(parseAltiumVariation("Designator=R1|Kind=NotFitted")).toBeUndefined();
  });
});

describe("parseAltiumProjectVariants", () => {
  it("reads only numbered project-variant sections in their stored order", () => {
    expect(parseAltiumProjectVariants(project)).toEqual([
      {
        name: "Production",
        variations: [
          { designator: "R1", uniqueId: "\\ABC", kind: 1 },
          { designator: "R2", uniqueId: "\\DEF", kind: 0 },
          { designator: "U1", uniqueId: "\\GHI", kind: 2 },
        ],
      },
      {
        name: "Debug",
        variations: [{ designator: "R1", uniqueId: "\\ABC", kind: 0 }],
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
        variations: [{ designator: "C1", kind: 1 }],
      },
    ]);
  });
});

describe("applyAltiumVariant", () => {
  const components = (): ComponentDetails => ({
    R1: { pins: {} },
    R2: { pins: {} },
    U1: { pins: {} },
  });
  const variants = parseAltiumProjectVariants(project);

  it("marks only Kind=1 rows from the selected variant", () => {
    const result = components();
    applyAltiumVariant(result, variants, "production");
    expect(result.R1.dns).toBe(true);
    expect(result.R2.dns).toBeUndefined();
    expect(result.U1.dns).toBeUndefined();
  });

  it("leaves the explicit base design unchanged", () => {
    const result = components();
    applyAltiumVariant(result, variants, "<Default>");
    expect(result).toEqual(components());
  });

  it("rejects an unknown selection rather than falling back to fitted", () => {
    expect(() => applyAltiumVariant(components(), variants, "missing")).toThrow(
      "Available variants: [Production, Debug], <Default>"
    );
  });
});
