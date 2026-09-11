/**
 * Altium assembly variants stored in a text `.PrjPcb` project file.
 *
 * The project owns the fitted/not-fitted state and local parameter overrides.
 * `.PrjPcbVariants` is a compound sidecar for alternate component records; it
 * is not where ordinary Not Fitted rows are stored.
 */

import { readFile } from "node:fs/promises";
import type { ComponentDetails, DesignVariant } from "../../types.js";
import { DEFAULT_VARIANT, findVariant, isDefaultVariant } from "../variants.js";

export interface AltiumComponentVariation {
  designator: string;
  uniqueId?: string;
  /** Altium's native kind. Kind 1 is Not Fitted. */
  kind: number;
}

export interface AltiumProjectVariant extends DesignVariant {
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

/** Parse one pipe-delimited `VariationN` row. */
export const parseAltiumVariation = (
  value: string
): AltiumComponentVariation | undefined => {
  const fields = new Map<string, string>();
  for (const token of value.split("|")) {
    const equals = token.indexOf("=");
    if (equals < 0) continue;
    fields.set(token.slice(0, equals).trim().toLowerCase(), token.slice(equals + 1).trim());
  }

  const designator = fields.get("designator")?.trim();
  const kindText = fields.get("kind")?.trim();
  const kind = Number(kindText);
  if (!designator || !Number.isInteger(kind)) return undefined;

  const uniqueId = fields.get("uniqueid")?.trim();
  return {
    designator,
    ...(uniqueId ? { uniqueId } : {}),
    kind,
  };
};

/** Parse every numbered `[ProjectVariantN]` section, in project order. */
export const parseAltiumProjectVariants = (content: string): AltiumProjectVariant[] => {
  const variants: AltiumProjectVariant[] = [];

  for (const section of parseSections(content)) {
    if (!/^ProjectVariant\d+$/i.test(section.name)) continue;

    const name = section.values.get("description")?.trim() || section.name;
    const declaredCount = Number(section.values.get("variationcount"));
    const variationKeys = [...section.values.keys()]
      .map((key) => /^variation(\d+)$/i.exec(key))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => Number(match[1]))
      .filter((number) => Number.isInteger(number) && number > 0);
    const count = Number.isInteger(declaredCount) && declaredCount >= 0
      ? declaredCount
      : Math.max(0, ...variationKeys);

    const variations: AltiumComponentVariation[] = [];
    for (let index = 1; index <= count; index += 1) {
      const raw = section.values.get(`variation${index}`);
      if (!raw) continue;
      const parsed = parseAltiumVariation(raw);
      if (parsed) variations.push(parsed);
    }

    variants.push({ name, variations });
  }

  return variants;
};

/** Read the named assembly variants from an Altium project. */
export const listAltiumVariants = async (projectPath: string): Promise<DesignVariant[]> =>
  parseAltiumProjectVariants(await readFile(projectPath, "utf-8")).map(({ name }) => ({ name }));

/** Apply one selected assembly variant's Not Fitted rows to parsed components. */
export const applyAltiumVariant = (
  components: ComponentDetails,
  variants: readonly AltiumProjectVariant[],
  selected?: string
): void => {
  if (!selected || isDefaultVariant(selected)) return;

  const variant = findVariant(variants, selected) as AltiumProjectVariant | undefined;
  if (!variant) {
    throw new Error(
      `Variant '${selected}' not found. Available variants: [${variants.map((item) => item.name).join(", ")}], ${DEFAULT_VARIANT}`
    );
  }

  const componentsByName = new Map(
    Object.entries(components).map(([refdes, component]) => [refdes.toLowerCase(), component])
  );
  for (const variation of variant.variations) {
    if (variation.kind !== 1) continue;
    const component = componentsByName.get(variation.designator.toLowerCase());
    if (component) component.dns = true;
  }
};
