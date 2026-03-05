/**
 * Cadence Parser
 * Functions to parse Cadence netlist files to unified schema
 */

import path from "path";
import { parsePstxnet } from "./dat/pstxnet-parser.js";
import { parsePstxprt } from "./dat/pstxprt-parser.js";
import { parsePstchip } from "./dat/pstchip-parser.js";
import type { ChipPart } from "./dat/pstchip-parser.js";
import {
  discoverCadenceDesigns,
  findCadenceDatFiles,
  isCadenceFile,
  CADENCE_EXTENSIONS,
} from "./discovery.js";
import { parseDsnFile } from "./dsn/dsn-parser.js";
import { isValidRefdes } from "../../circuit-traversal.js";
import {
  createPinEntry,
  type ParsedNetlist,
  type ComponentDetails,
  type EDAProjectFormatHandler,
} from "../../types.js";

export { discoverCadenceDesigns, findCadenceDatFiles, isCadenceFile } from "./discovery.js";
export { parseDsnFile } from "./dsn/dsn-parser.js";
export { parsePstxnet, parsePstxnetContent } from "./dat/pstxnet-parser.js";
export { parsePstxprt, parsePstxprtContent } from "./dat/pstxprt-parser.js";
export { parsePstchip, parsePstchipContent, type ChipPart } from "./dat/pstchip-parser.js";

export interface CadenceFilePaths {
  pstxnetPath: string;
  pstxprtPath: string;
  pstchipPath?: string;
}

/**
 * Internal Cadence-specific parsed result before post-processing.
 * Contains chips and partNames for cross-referencing during pin mapping.
 */
export interface CadenceRawNetlist extends ParsedNetlist {
  chips: ChipPart[];
  partNames: Map<string, string>;
}

// =============================================================================
// Pin Mapping (Cadence-specific post-processing)
// =============================================================================

/**
 * Build a lookup of part name -> pin number -> pin name from pstchip data.
 */
const buildPinNameMaps = (chips: ChipPart[]): Map<string, Map<string, string>> => {
  const pinNameMaps = new Map<string, Map<string, string>>();

  for (const chip of chips) {
    const pinMap = new Map<string, string>();
    for (const [pinName, pinNumber] of Object.entries(chip.pins)) {
      if (!pinNumber) {
        continue;
      }
      pinMap.set(String(pinNumber), String(pinName));
    }
    pinNameMaps.set(chip.part_name, pinMap);
  }

  return pinNameMaps;
};

/**
 * Build a lookup of part name -> VALUE from pstchip data.
 */
const buildValueMap = (chips: ChipPart[]): Map<string, string> => {
  const valueMap = new Map<string, string>();

  for (const chip of chips) {
    const value = chip.body_properties?.["VALUE"];
    if (value) {
      valueMap.set(chip.part_name, value);
    }
  }

  return valueMap;
};

/**
 * Build pin mappings for Cadence netlists.
 * Uses partNames map for cross-referencing with pstchip.dat.
 * Also extracts VALUE from pstchip.dat and sets it on components.
 */
export const buildCadencePinMap = (
  nets: ParsedNetlist["nets"],
  components: ComponentDetails,
  chips: ChipPart[],
  partNames: Map<string, string>
): void => {
  const pinNameMaps = buildPinNameMaps(chips);
  const valueMap = buildValueMap(chips);

  for (const [netName, netConnections] of Object.entries(nets)) {
    for (const [refdes, pins] of Object.entries(netConnections)) {
      // Skip garbage Cadence instance paths (e.g., @DESIGN.SHEET:INS123@PART)
      if (!isValidRefdes(refdes)) {
        continue;
      }
      if (!components[refdes]) {
        components[refdes] = { pins: {} };
      }

      const component = components[refdes];
      const partName = partNames.get(refdes);

      // Set value from pstchip.dat if not already set
      if (partName && !component.value) {
        const value = valueMap.get(partName);
        if (value) {
          component.value = value;
        }
      }

      const pinNameMap = partName ? pinNameMaps.get(partName) : undefined;
      const pinArray = Array.isArray(pins) ? pins : [pins];
      for (const pin of pinArray) {
        const pinName = pinNameMap?.get(pin);
        component.pins[pin] = createPinEntry(pin, pinName, netName);
      }
    }
  }
};

// =============================================================================
// Parsing
// =============================================================================

/**
 * Parse Cadence netlist files into internal CadenceRawNetlist schema.
 * Takes absolute paths to the .dat files.
 * Returns partNames for use in post-processing (pin mapping, value extraction).
 */
export const parseCadence = async (paths: CadenceFilePaths): Promise<CadenceRawNetlist> => {
  const nets = await parsePstxnet(paths.pstxnetPath);
  const { components, partNames } = await parsePstxprt(paths.pstxprtPath);

  let chips: ChipPart[] = [];
  if (paths.pstchipPath) {
    chips = await parsePstchip(paths.pstchipPath);
  }

  return {
    nets,
    components,
    chips,
    partNames,
  };
};

/**
 * Parse a Cadence design file by finding its .dat files and parsing them.
 * Falls back to direct DSN binary parsing when .dat files are not available.
 */
const parseCadenceDesign = async (designPath: string): Promise<ParsedNetlist> => {
  const datFiles = await findCadenceDatFiles(designPath);

  // Prefer .dat files when available (richer data: pin names, MPN, values)
  if (datFiles.pstxnet && datFiles.pstxprt) {
    const raw = await parseCadence({
      pstxnetPath: datFiles.pstxnet,
      pstxprtPath: datFiles.pstxprt,
      pstchipPath: datFiles.pstchip ?? undefined,
    });

    buildCadencePinMap(raw.nets, raw.components, raw.chips, raw.partNames);

    return {
      nets: raw.nets,
      components: raw.components,
    };
  }

  // Fall back to direct DSN binary parsing (no .dat export needed)
  const ext = path.extname(designPath).toLowerCase();
  if (ext === ".dsn") {
    return parseDsnFile(designPath);
  }

  throw new Error(
    `Missing netlist files for ${path.basename(designPath)}. Run export_cadence_netlist to generate them.`
  );
};

/**
 * Cadence EDA project format handler.
 * Supports Cadence CIS (.dsn) and HDL (.cpm) designs.
 */
export const cadenceHandler: EDAProjectFormatHandler = {
  name: "cadence",
  extensions: CADENCE_EXTENSIONS,

  canHandle: isCadenceFile,

  discoverDesigns: discoverCadenceDesigns,

  parse: parseCadenceDesign,
};
