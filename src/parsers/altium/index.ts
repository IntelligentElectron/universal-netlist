/**
 * Altium Designer: `.PrjPcb` projects and standalone `.SchDoc` sheets.
 */

import path from "path";
import type { EDAProjectFormatHandler } from "../../types.js";
import { ALTIUM_EXTENSIONS, discoverAltiumDesigns, isAltiumFile } from "./discovery.js";
import { listAltiumVariants } from "./project-variants.js";
import { parseDocument, readDocument } from "./document.js";
import { parseAltiumProject } from "./project.js";
import { pairDifferentialNets } from "./netlist.js";
import { contextOrDefault } from "../context.js";

const isSchDoc = (designPath: string): boolean =>
  path.extname(designPath).toLowerCase() === ".schdoc";

export const altiumHandler: EDAProjectFormatHandler = {
  name: "altium",
  extensions: ALTIUM_EXTENSIONS,
  canHandle: isAltiumFile,
  discoverDesigns: discoverAltiumDesigns,
  listVariants: async (designPath, context) =>
    isSchDoc(designPath) ? [] : listAltiumVariants(designPath, context?.files),
  parse: async (designPath, options) => {
    if (!isSchDoc(designPath)) return parseAltiumProject(designPath, options);
    const { files } = contextOrDefault(options?.context);
    const { netlist } = parseDocument(readDocument(designPath, await files.readFile(designPath)));
    pairDifferentialNets(netlist);
    return netlist;
  },
};
