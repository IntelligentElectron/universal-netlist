/**
 * Selector resolution: which build a caller's `design_variant` names.
 *
 * The plain alias `default` used to be checked before the declared names, so a
 * design whose own variant was called `default` had no way to reach it: the
 * alias took the request and the echoed `<Default>` was the only clue. A
 * declared name wins now, and only the literal `<Default>` is reserved.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_VARIANT,
  describeDefaultVariantRefusal,
  describeVariantChoices,
  isDefaultVariant,
  isDefaultVariantLiteral,
  resolveVariantSelector,
} from "./variants.js";

const variants = [
  { name: "default", fabrication: true },
  { name: "Main", fabrication: true },
];

describe("resolveVariantSelector", () => {
  it("resolves a declared variant called `default` rather than the alias", () => {
    expect(resolveVariantSelector(variants, "default")).toEqual({
      selected: "default",
      native: variants[0],
    });
    expect(resolveVariantSelector(variants, "DEFAULT")).toEqual({
      selected: "default",
      native: variants[0],
    });
  });

  it("reserves the literal <Default> for the base build", () => {
    expect(resolveVariantSelector(variants, "<Default>")).toEqual({ selected: DEFAULT_VARIANT });
    expect(resolveVariantSelector(variants, " <default> ")).toEqual({
      selected: DEFAULT_VARIANT,
    });
  });

  it("resolves the alias to the base build where no declared name takes it", () => {
    expect(resolveVariantSelector([{ name: "Main" }], "default")).toEqual({
      selected: DEFAULT_VARIANT,
    });
    expect(resolveVariantSelector([], "default")).toEqual({ selected: DEFAULT_VARIANT });
  });

  it("matches declared names case-insensitively and returns their own spelling", () => {
    expect(resolveVariantSelector(variants, "main")).toEqual({
      selected: "Main",
      native: variants[1],
    });
  });

  it("resolves nothing for a name the design does not declare", () => {
    expect(resolveVariantSelector(variants, "Debug")).toBeUndefined();
  });
});

describe("default spellings", () => {
  it("tells the literal apart from the alias", () => {
    expect(isDefaultVariantLiteral("<Default>")).toBe(true);
    expect(isDefaultVariantLiteral("<DEFAULT>")).toBe(true);
    expect(isDefaultVariantLiteral("default")).toBe(false);
    expect(isDefaultVariant("default")).toBe(true);
    expect(isDefaultVariant("<Default>")).toBe(true);
  });
});

describe("describeVariantChoices", () => {
  it("lists the declared variants, or the base build of a design that declares none", () => {
    expect(describeVariantChoices([{ name: "Main" }])).toBe("['Main']");
    expect(describeVariantChoices([])).toBe("['<Default>']");
  });
});

describe("describeDefaultVariantRefusal", () => {
  it("names the argument for a tool result and the choice for a parser", () => {
    const variants = [{ name: "Main" }];
    expect(describeDefaultVariantRefusal(variants, "A.DSN")).toBe(
      "'<Default>' is not a build of design 'A.DSN': its variants ['Main'] are the assemblies it records, and nothing in the design marks the bare schematic as one. Pass design_variant as one of those names."
    );
    expect(describeDefaultVariantRefusal(variants)).toBe(
      "'<Default>' is not a build of this design: its variants ['Main'] are the assemblies it records, and nothing in the design marks the bare schematic as one. Select one of those names."
    );
  });
});
