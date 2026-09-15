/**
 * Altium Designer: `.PrjPcb` projects and standalone `.SchDoc` sheets.
 */

import path from "path";
import type { EDAProjectFormatHandler } from "../../types.js";
import { ALTIUM_EXTENSIONS, discoverAltiumDesigns, isAltiumFile } from "./discovery.js";
import { listAltiumVariants } from "./project-variants.js";
import { parseDocument, readDocument } from "./document.js";
import { parseAltiumProject } from "./project.js";

const isSchDoc = (designPath: string): boolean =>
  path.extname(designPath).toLowerCase() === ".schdoc";

export const altiumHandler: EDAProjectFormatHandler = {
  name: "altium",
  extensions: ALTIUM_EXTENSIONS,
  canHandle: isAltiumFile,
  discoverDesigns: discoverAltiumDesigns,
  listVariants: async (designPath) => (isSchDoc(designPath) ? [] : listAltiumVariants(designPath)),
  parse: async (designPath, options) =>
    isSchDoc(designPath)
      ? parseDocument(readDocument(designPath)).netlist
      : parseAltiumProject(designPath, options),
};
