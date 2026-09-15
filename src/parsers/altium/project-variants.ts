/**
 * Design variants, written in the `.PrjPcb` as `[ProjectVariantN]` sections: each
 * `VariationN` row fits, removes (`Kind=1`) or substitutes (`Kind=2`) one part, and each
 * `ParamVariationN` row overrides a parameter of the part its `ParamDesignatorN` names.
 */

import { readFile } from "node:fs/promises";
import type { ComponentDetails, DesignVariant } from "../../types.js";
import { DEFAULT_VARIANT, findVariant, isDefaultVariant } from "../variants.js";

const KIND_NOT_FITTED = 1;
const KIND_ALTERNATE_PART = 2;

interface AltiumComponentVariation {
  designator: string;
  uniqueId?: string;
  /** Altium's native kind: 0 Fitted, 1 Not Fitted, 2 Alternate Part. */
  kind: number;
  /** The library item an alternate-part row substitutes, when the row names one. */
  alternatePart?: string;
  /** Parameter overrides keyed by Altium parameter name, e.g. `Value` -> `12k`. */
  parameters: Record<string, string>;
}

interface AltiumProjectVariant extends DesignVariant {
  variations: AltiumComponentVariation[];
}

interface IniSection {
  name: string;
  values: Map<string, string>;
}

/** Parse the small INI-like subset used by `.PrjPcb` files. */
const parseSections = (content: string): IniSection[] => {
  const sections: IniSection[] = [];
  let current: IniSection | undefined;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    const sectionMatch = /^\[([^\]]+)]$/.exec(line);
    if (sectionMatch) {
      current = { name: sectionMatch[1], values: new Map() };
      sections.push(current);
      continue;
    }
    if (!current || !line || line.startsWith(";") || line.startsWith("#")) continue;

    const equals = line.indexOf("=");
    if (equals < 0) continue;
    current.values.set(line.slice(0, equals).trim().toLowerCase(), line.slice(equals + 1));
  }

  return sections;
};

/** Split a pipe-delimited `key=value|key=value` row into a case-insensitive map. */
const parsePipeFields = (value: string): Map<string, string> => {
  const fields = new Map<string, string>();
  for (const token of value.split("|")) {
    const equals = token.indexOf("=");
    if (equals < 0) continue;
    fields.set(token.slice(0, equals).trim().toLowerCase(), token.slice(equals + 1).trim());
  }
  return fields;
};

/** Parse one pipe-delimited `VariationN` row. */
export const parseAltiumVariation = (value: string): AltiumComponentVariation | undefined => {
  const fields = parsePipeFields(value);

  const designator = fields.get("designator")?.trim();
  const kindText = fields.get("kind")?.trim();
  const kind = Number(kindText);
  if (!designator || !Number.isInteger(kind)) return undefined;

  const uniqueId = fields.get("uniqueid")?.trim();
  // The library item is the identity of the substituted part. `AlternatePart`
  // itself usually reads `=Value`, which is the comment expression and not a
  // part, so it is only used when the library link is absent.
  const designItem = fields.get("altliblink_designitemid")?.trim();
  const alternateField = fields.get("alternatepart")?.trim();
  const alternatePart =
    designItem || (alternateField && !alternateField.startsWith("=") ? alternateField : undefined);
  return {
    designator,
    ...(uniqueId ? { uniqueId } : {}),
    kind,
    ...(alternatePart ? { alternatePart } : {}),
    parameters: {},
  };
};

/** Read the numbered keys of one prefix, honouring the declared count when it is sane. */
const numberedRows = (
  section: IniSection,
  prefix: string,
  countKey: string
): Array<[number, string]> => {
  const declaredCount = Number(section.values.get(countKey));
  const pattern = new RegExp(`^${prefix}(\\d+)$`, "i");
  const discovered = [...section.values.keys()]
    .map((key) => pattern.exec(key))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => Number(match[1]))
    .filter((number) => Number.isInteger(number) && number > 0);
  const count =
    Number.isInteger(declaredCount) && declaredCount >= 0
      ? declaredCount
      : Math.max(0, ...discovered);

  const rows: Array<[number, string]> = [];
  for (let index = 1; index <= count; index += 1) {
    const raw = section.values.get(`${prefix}${index}`);
    if (raw) rows.push([index, raw]);
  }
  return rows;
};

/** Parse every numbered `[ProjectVariantN]` section, in project order. */
export const parseAltiumProjectVariants = (content: string): AltiumProjectVariant[] => {
  const variants: AltiumProjectVariant[] = [];

  for (const section of parseSections(content)) {
    if (!/^ProjectVariant\d+$/i.test(section.name)) continue;

    const name = section.values.get("description")?.trim() || section.name;
    const variations: AltiumComponentVariation[] = [];
    for (const [, raw] of numberedRows(section, "variation", "variationcount")) {
      const parsed = parseAltiumVariation(raw);
      if (parsed) variations.push(parsed);
    }

    // Parameter rows attach to a part by designator. A designator repeated in
    // several rows (one per channel of a repeated sheet) receives them all.
    const byDesignator = new Map<string, AltiumComponentVariation[]>();
    for (const variation of variations) {
      const key = variation.designator.toLowerCase();
      byDesignator.set(key, [...(byDesignator.get(key) ?? []), variation]);
    }
    for (const [index, raw] of numberedRows(section, "paramvariation", "paramvariationcount")) {
      const fields = parsePipeFields(raw);
      const parameterName = fields.get("parametername")?.trim();
      const variantValue = fields.get("variantvalue");
      const designator = section.values.get(`paramdesignator${index}`)?.trim();
      if (!parameterName || variantValue === undefined || !designator) continue;
      for (const variation of byDesignator.get(designator.toLowerCase()) ?? []) {
        variation.parameters[parameterName] = variantValue.trim();
      }
    }

    const fabricationFlag = section.values.get("allowfabrication")?.trim();
    variants.push({
      name,
      ...(fabricationFlag !== undefined ? { fabrication: fabricationFlag === "1" } : {}),
      variations,
    });
  }

  return variants;
};

/** Read the named design variants from an Altium project. */
export const listAltiumVariants = async (projectPath: string): Promise<DesignVariant[]> =>
  parseAltiumProjectVariants(await readFile(projectPath, "utf-8")).map(({ name, fabrication }) => ({
    name,
    ...(fabrication !== undefined ? { fabrication } : {}),
  }));

/** The component field each parameter name overrides. */
const PARAMETER_FIELDS: Record<string, "value" | "description" | "manufacturer" | "mpn"> = {
  value: "value",
  description: "description",
  manufacturer: "manufacturer",
  "manufacturer part number": "mpn",
};

/** Apply one part's parameter overrides in place. */
const applyParameterOverrides = (
  component: ComponentDetails[string],
  parameters: Record<string, string>
): void => {
  let comment: string | undefined;
  for (const [name, rawValue] of Object.entries(parameters)) {
    const value = rawValue.trim();
    if (!value) continue;
    const key = name.trim().toLowerCase();
    if (key === "comment") {
      comment = value;
      continue;
    }
    const field = PARAMETER_FIELDS[key];
    if (field) component[field] = value;
  }
  // `=Value` shows the Value parameter; a comment equal to the value is not reported.
  if (comment !== undefined) {
    const resolved = comment === "=Value" ? component.value : comment;
    if (resolved && resolved !== component.value) component.comment = resolved;
    else delete component.comment;
  }
};

/** Apply one selected design variant's rows to parsed components. */
export const applyAltiumVariant = (
  components: ComponentDetails,
  variants: readonly AltiumProjectVariant[],
  selected?: string
): void => {
  if (!selected || isDefaultVariant(selected)) return;

  const variant = findVariant(variants, selected) as AltiumProjectVariant | undefined;
  if (!variant) {
    throw new Error(
      `Design variant '${selected}' not found. Available: [${[...variants.map((item) => `'${item.name}'`), `'${DEFAULT_VARIANT}'`].join(", ")}]`
    );
  }

  const componentsByName = new Map(
    Object.entries(components).map(([refdes, component]) => [refdes.toLowerCase(), component])
  );
  for (const variation of variant.variations) {
    const component = componentsByName.get(variation.designator.toLowerCase());
    if (!component) continue;
    if (variation.kind === KIND_NOT_FITTED) {
      component.dns = true;
      continue;
    }
    if (variation.kind === KIND_ALTERNATE_PART) component.alternate_part = true;
    applyParameterOverrides(component, variation.parameters);
  }
};
