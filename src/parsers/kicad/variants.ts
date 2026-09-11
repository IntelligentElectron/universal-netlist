/**
 * KiCad 10 design variants, read from the schematic itself.
 *
 * A variant lives on each symbol instance, next to its reference:
 *
 *   (instances (project "variants"
 *     (path "/uuid" (reference "R14") (unit 1)
 *       (variant (name "Variant2") (dnp yes) (in_bom no)
 *         (field (name "Value") (value "2u"))))))
 *
 * kicad-cli's netlist export writes the same netlist whatever `--variant` it is
 * given (kicad-cli 10.0.5, measured on KiCad's own qa/data/cli/variants, where
 * R14 above still comes out fitted), so the blocks are read and applied here,
 * the way the Altium handler applies its project rows.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ComponentDetails, DesignVariant } from "../../types.js";
import { uniqueVariants } from "../variants.js";
import { childrenByTag, childString, isList, parseSexpr, tag, type SExpr } from "./sexpr.js";
import { resolveKicadArtifacts } from "./discovery.js";
import { resolveKicadFieldTarget } from "./netlist-parser.js";

/** Collect every `(variant (name "..."))` block in a schematic. */
export const parseKicadVariantNames = (content: string): string[] => {
  const variants: DesignVariant[] = [];

  const visit = (node: SExpr): void => {
    if (!isList(node)) return;
    if (tag(node) === "variant") {
      const name = childString(node, "name")?.trim();
      if (name) variants.push({ name });
    }
    for (const child of node.slice(1)) visit(child);
  };

  for (const node of parseSexpr(content)) visit(node);
  return uniqueVariants(variants).map((variant) => variant.name);
};

/** Collect hierarchical child schematic paths from `(property "Sheetfile" ...)`. */
export const parseKicadSheetFiles = (content: string): string[] => {
  const files: string[] = [];

  const visit = (node: SExpr): void => {
    if (!isList(node)) return;
    if (tag(node) === "sheet") {
      for (const property of childrenByTag(node, "property")) {
        if (property[1] === "Sheetfile" && typeof property[2] === "string") {
          const file = property[2].trim();
          if (file) files.push(file);
        }
      }
    }
    for (const child of node.slice(1)) visit(child);
  };

  for (const node of parseSexpr(content)) visit(node);
  return [...new Set(files)];
};

/** Read the root schematic and every hierarchical child once each, root first. */
const readSchematicHierarchy = async (rootSchematic: string): Promise<string[]> => {
  const contents: string[] = [];
  const queue = [path.resolve(rootSchematic)];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const schematic = queue.shift();
    if (!schematic || visited.has(schematic)) continue;
    visited.add(schematic);

    let content: string;
    try {
      content = await readFile(schematic, "utf-8");
    } catch (error) {
      // Preserve committed-netlist support when a historical fixture omits a
      // child sheet. kicad-cli will report the missing file if live export is
      // actually requested.
      if (schematic !== path.resolve(rootSchematic)) continue;
      throw error;
    }

    contents.push(content);
    for (const child of parseKicadSheetFiles(content)) {
      queue.push(path.resolve(path.dirname(schematic), child));
    }
  }

  return contents;
};

/** Read named variants from the root schematic and every hierarchical sheet. */
export const listKicadVariants = async (designPath: string): Promise<DesignVariant[]> => {
  const { rootSchematic } = await resolveKicadArtifacts(designPath);
  if (!rootSchematic) return [];

  const variants: DesignVariant[] = [];
  for (const content of await readSchematicHierarchy(rootSchematic)) {
    variants.push(...parseKicadVariantNames(content).map((name) => ({ name })));
  }
  return uniqueVariants(variants);
};

/** What one variant changes on one reference. */
export interface KicadVariantOverride {
  /** `(dnp yes)` or `(dnp no)`; absent when the block does not say. */
  dnp?: boolean;
  /** `(field (name "Value") (value "2u"))` overrides, keyed by field name. */
  fields: Record<string, string>;
}

const mergeOverride = (
  into: Map<string, KicadVariantOverride>,
  reference: string,
  override: KicadVariantOverride
): void => {
  const key = reference.trim();
  if (!key) return;
  const entry = into.get(key) ?? { fields: {} };
  // A multi-unit symbol carries one block per unit; any unit saying not
  // fitted means the part is not fitted.
  if (override.dnp === true) entry.dnp = true;
  else if (override.dnp === false && entry.dnp === undefined) entry.dnp = false;
  Object.assign(entry.fields, override.fields);
  into.set(key, entry);
};

/**
 * Read one named variant's overrides from a schematic, keyed by reference.
 *
 * Instances are grouped by project; when `projectName` is given and the symbol
 * carries a block for it, only that project's paths are read, so a sheet
 * shared between two projects reports the references this project annotated.
 */
export const parseKicadVariantOverrides = (
  content: string,
  variantName: string,
  projectName?: string
): Map<string, KicadVariantOverride> => {
  const wanted = variantName.trim().toLowerCase();
  const overrides = new Map<string, KicadVariantOverride>();

  const visitPath = (pathNode: SExpr[]): void => {
    const reference = childString(pathNode, "reference");
    if (!reference) return;
    for (const block of childrenByTag(pathNode, "variant")) {
      if (childString(block, "name")?.trim().toLowerCase() !== wanted) continue;
      const override: KicadVariantOverride = { fields: {} };
      const dnp = childString(block, "dnp");
      if (dnp === "yes") override.dnp = true;
      else if (dnp === "no") override.dnp = false;
      for (const field of childrenByTag(block, "field")) {
        const name = childString(field, "name");
        const value = childString(field, "value");
        if (name && value !== undefined) override.fields[name] = value;
      }
      mergeOverride(overrides, reference, override);
    }
  };

  const visit = (node: SExpr): void => {
    if (!isList(node)) return;
    if (tag(node) === "instances") {
      const projects = childrenByTag(node, "project");
      const own = projectName
        ? projects.filter(
            (project) =>
              typeof project[1] === "string" &&
              project[1].toLowerCase() === projectName.toLowerCase()
          )
        : [];
      for (const project of own.length > 0 ? own : projects) {
        for (const pathNode of childrenByTag(project, "path")) visitPath(pathNode);
      }
      return;
    }
    for (const child of node.slice(1)) visit(child);
  };

  for (const node of parseSexpr(content)) visit(node);
  return overrides;
};

/** Collect one variant's overrides across the whole schematic hierarchy. */
export const collectKicadVariantOverrides = async (
  designPath: string,
  variantName: string
): Promise<Map<string, KicadVariantOverride>> => {
  const { name, rootSchematic } = await resolveKicadArtifacts(designPath);
  if (!rootSchematic) {
    throw new Error(
      `Design variant '${variantName}' needs the root .kicad_sch beside ${path.basename(designPath)}, which was not found.`
    );
  }

  const merged = new Map<string, KicadVariantOverride>();
  for (const content of await readSchematicHierarchy(rootSchematic)) {
    for (const [reference, override] of parseKicadVariantOverrides(content, variantName, name)) {
      mergeOverride(merged, reference, override);
    }
  }
  return merged;
};

/** Fields whose change means a different part is fitted, not just described. */
const IDENTITY_FIELDS = new Set(["value", "mpn", "internal_pn", "manufacturer"]);

/** Apply one variant's overrides to parsed components, in place. */
export const applyKicadVariant = (
  components: ComponentDetails,
  overrides: ReadonlyMap<string, KicadVariantOverride>
): void => {
  const componentsByName = new Map(
    Object.entries(components).map(([refdes, component]) => [refdes.toLowerCase(), component])
  );
  for (const [reference, override] of overrides) {
    const component = componentsByName.get(reference.toLowerCase());
    if (!component) continue;

    if (override.dnp === true) component.dns = true;
    else if (override.dnp === false) delete component.dns;

    for (const [fieldName, rawValue] of Object.entries(override.fields)) {
      const target = resolveKicadFieldTarget(fieldName);
      if (!target) continue;
      const value = rawValue.trim();
      const changed = (component[target] ?? "") !== value;
      if (value) component[target] = value;
      else delete component[target];
      if (changed && IDENTITY_FIELDS.has(target)) component.alternate_part = true;
    }
  }
};
