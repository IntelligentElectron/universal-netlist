/** KiCad 10 design-variant discovery from raw schematic instance data. */

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { DesignVariant } from "../../types.js";
import { uniqueVariants } from "../variants.js";
import { childString, childrenByTag, isList, parseSexpr, tag, type SExpr } from "./sexpr.js";
import { resolveKicadArtifacts } from "./discovery.js";

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

/** Read named variants from the root schematic and every hierarchical sheet. */
export const listKicadVariants = async (designPath: string): Promise<DesignVariant[]> => {
  const { rootSchematic } = await resolveKicadArtifacts(designPath);
  if (!rootSchematic) return [];

  const variants: DesignVariant[] = [];
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

    variants.push(...parseKicadVariantNames(content).map((name) => ({ name })));
    for (const child of parseKicadSheetFiles(content)) {
      queue.push(path.resolve(path.dirname(schematic), child));
    }
  }

  return uniqueVariants(variants);
};
