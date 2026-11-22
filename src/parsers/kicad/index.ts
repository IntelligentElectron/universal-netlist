/**
 * KiCad Parser
 *
 * Converts KiCad schematic projects into the unified ParsedNetlist. Three
 * sources, in priority order (docs/decision-tables/kicad-source):
 *   1. A committed `.net` export beside the project: KiCad's own netlist.
 *   2. The raw `.kicad_sch` reader (schematic/), which resolves wires,
 *      junctions, labels, power symbols, buses and hierarchical sheets itself,
 *      so no KiCad install is needed.
 *   3. Live generation via `kicad-cli` from the root `.kicad_sch`, when the raw
 *      reader cannot read the design and KiCad is installed.
 */

import path from "node:path";
import { contextOrDefault, readText } from "../context.js";
import { markHiddenPins, readKicadPages, readKicadSchematic } from "./schematic/index.js";
import type { DesignPages } from "../../pages/page-view.js";
import { writeKicadNetlist } from "./schematic/netlist-writer.js";
import type { ParsedNetlist, EDAProjectFormatHandler, ParseDesignOptions } from "../../types.js";
import { parseKicadNetlist } from "./netlist-parser.js";
import { exportNetlist } from "./cli.js";
import {
  discoverKicadDesigns,
  isKicadFile,
  kicadRootSchematics,
  resolveKicadArtifacts,
  KICAD_EXTENSIONS,
} from "./discovery.js";
import {
  applyKicadVariant,
  collectKicadVariantOverrides,
  listKicadVariants,
  readSchematicHierarchy,
} from "./variants.js";
import { describeDefaultVariantRefusal, isDefaultVariantLiteral } from "../variants.js";

export { discoverKicadDesigns, isKicadFile, resolveKicadArtifacts } from "./discovery.js";
export { parseKicadNetlist } from "./netlist-parser.js";
export { exportNetlist, isKicadCliAvailable, resolveKicadCli } from "./cli.js";
export type { KicadDiscoveredDesign } from "./discovery.js";

/**
 * The places a KiCad design's netlist can come from, in the order they are
 * tried. A step that does not apply is absent: no saved export, no root
 * schematic to read, or `kicad-cli` turned off.
 */
export interface KicadNetlistSources {
  /** The design's file name, for messages. */
  readonly design: string;
  /** The saved `<project>.net` export beside the project. */
  readonly savedNet?: () => Promise<ParsedNetlist>;
  /** The raw reader over the root `.kicad_sch` and its sheets. */
  readonly raw?: () => Promise<ParsedNetlist>;
  /** `kicad-cli` exporting a netlist from the root schematic. */
  readonly kicadCli?: () => Promise<ParsedNetlist>;
}

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * A KiCad design's netlist: a saved `.net` export when there is one, KiCad's
 * own output; otherwise the raw schematic reader, which needs no KiCad install;
 * otherwise `kicad-cli`. A failure names every step that was tried, so the
 * message says what to fix. See docs/decision-tables/kicad-source.
 */
export const resolveKicadNetlist = async (sources: KicadNetlistSources): Promise<ParsedNetlist> => {
  if (sources.savedNet) return sources.savedNet();
  const stem = sources.design.replace(/\.[^.]+$/, "");
  if (!sources.raw) {
    throw new Error(
      `No netlist for ${sources.design}. Expected a committed "${stem}.net" beside the project, ` +
        `or a root .kicad_sch to read.`
    );
  }
  let rawError: unknown;
  try {
    return await sources.raw();
  } catch (error) {
    rawError = error;
  }
  if (!sources.kicadCli) {
    throw new Error(
      `Could not read ${sources.design}: the schematic reader failed (${reason(rawError)}), and ` +
        `kicad-cli is turned off (the kicadCli option; off by default for a file reader other ` +
        `than the local disk). Commit "${stem}.net" beside the project, or turn kicad-cli on.`
    );
  }
  try {
    return await sources.kicadCli();
  } catch (error) {
    throw new Error(
      `Could not read ${sources.design}: the schematic reader failed (${reason(rawError)}), and ` +
        `so did kicad-cli: ${reason(error)}`
    );
  }
};

/**
 * Parse a KiCad design (a `.kicad_pro` project or a root `.kicad_sch`) into a
 * ParsedNetlist, from a committed `.net` export, the raw schematic reader, or
 * kicad-cli, in that order.
 * A named design variant is then applied from the schematic's own instance
 * blocks, since kicad-cli's export does not apply one.
 */
export const parseKicadDesign = async (
  designPath: string,
  options?: ParseDesignOptions
): Promise<ParsedNetlist> => {
  const ext = path.extname(designPath).toLowerCase();
  const { files, kicadCli } = contextOrDefault(options?.context);

  // Direct-call path only: a caller may pass a resolved `.net` export straight
  // in. `.net` is an internal artifact, so it is intentionally absent from
  // KICAD_EXTENSIONS / `canHandle` and is never reached via discovery.
  if (ext === ".net") {
    return parseKicadNetlist(await readText(files, designPath));
  }

  const { netlistExport, rootSchematic } = await resolveKicadArtifacts(designPath, files);
  const parsed = await resolveKicadNetlist({
    design: path.basename(designPath),
    ...(netlistExport
      ? {
          savedNet: async () => {
            const netlist = parseKicadNetlist(await readText(files, netlistExport));
            // The export does not record which pins are hidden; the schematic does.
            // shortcut: this resolves the whole schematic for the flags alone; read only the
            // symbols' pins and instance references if a saved .net parse becomes slow.
            if (rootSchematic) {
              try {
                markHiddenPins(netlist, await readKicadSchematic(rootSchematic, files, designPath));
              } catch {
                // An unreadable schematic leaves the saved netlist as it is.
              }
            }
            return netlist;
          },
        }
      : {}),
    ...(rootSchematic
      ? {
          raw: async () => {
            const design = await readKicadSchematic(rootSchematic, files, designPath);
            const netlist = parseKicadNetlist(writeKicadNetlist(design));
            markHiddenPins(netlist, design);
            return netlist;
          },
        }
      : {}),
    ...(rootSchematic && kicadCli
      ? {
          kicadCli: async () => {
            // kicad-cli reads the sheets itself; reading them through the
            // reader first lets a parse cache see every file the netlist came from.
            await readSchematicHierarchy(
              await kicadRootSchematics(designPath, rootSchematic, files),
              files
            );
            return parseKicadNetlist(await exportNetlist(rootSchematic, kicadCli));
          },
        }
      : {}),
  });

  // The base netlist describes the base build, which a project that declares no
  // variant has. A named variant is an overlay the schematic records per symbol
  // instance, applied here for every source. Only the literal names the base
  // build: a declared variant called `default` is a variant, and the plain
  // alias is the service's to resolve. A project that declares variants has
  // only those to build, so the literal is refused on it.
  const selectedVariant = options?.variant;
  if (selectedVariant && isDefaultVariantLiteral(selectedVariant)) {
    const variants = await listKicadVariants(designPath, files);
    if (variants.length > 0) throw new Error(describeDefaultVariantRefusal(variants));
  } else if (selectedVariant) {
    applyKicadVariant(
      parsed.components,
      await collectKicadVariantOverrides(designPath, selectedVariant, files)
    );
  }
  return parsed;
};

/** A KiCad design's pages, read from its schematics. Pages do not depend on a variant. */
export const parseKicadPages = async (
  designPath: string,
  options?: ParseDesignOptions,
  draw = false
): Promise<DesignPages> => {
  const { files } = contextOrDefault(options?.context);
  const { rootSchematic } = await resolveKicadArtifacts(designPath, files);
  if (!rootSchematic) throw new Error(`No schematic found for ${path.basename(designPath)}.`);
  const { pages, svgs } = await readKicadPages(rootSchematic, files, designPath, draw);
  // The netlist may come from a saved export rather than the schematics, so
  // every net a page names is one of its nets: each pin takes the netlist's
  // net for it. An unannotated part (`D?`) is the exception: the netlist folds
  // every part of that refdes into one entry, so its pins keep the schematic's
  // net while the netlist has that net.
  const { components, nets } = await parseKicadDesign(designPath, options);
  const pinNet = (refdes: string, number: string): string | undefined => {
    const entry = Object.hasOwn(components, refdes) ? components[refdes].pins[number] : undefined;
    const net = entry === undefined ? undefined : typeof entry === "string" ? entry : entry.net;
    return net === "" ? "NC" : net;
  };
  const names = new Set(Object.keys(nets));
  const known = <T extends { net?: string }>(item: T): T => {
    if (item.net !== undefined && !names.has(item.net)) delete item.net;
    return item;
  };
  for (const page of pages) {
    for (const part of page.parts) {
      for (const pin of part.pins) {
        if (part.refdes.endsWith("?") && pin.net !== undefined && names.has(pin.net)) continue;
        const net = pinNet(part.refdes, pin.number || pin.name || "");
        if (net === undefined) delete pin.net;
        else pin.net = net;
      }
    }
    page.wires.forEach(known);
    page.ports.forEach(known);
    page.globals.forEach(known);
  }
  return { pages, svgs };
};

/**
 * KiCad EDA project format handler.
 * Recognizes `.kicad_pro` projects and `.kicad_sch` schematics; the resolved
 * `.net` export is an internal artifact discovered by convention, not a
 * top-level handled extension.
 */
export const kicadHandler: EDAProjectFormatHandler = {
  name: "kicad",
  extensions: KICAD_EXTENSIONS,

  canHandle: isKicadFile,

  discoverDesigns: discoverKicadDesigns,

  listVariants: (designPath, context) => listKicadVariants(designPath, context?.files),

  parse: parseKicadDesign,
};
