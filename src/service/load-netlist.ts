import path from "path";
import { findHandler, parseDesign } from "../parsers/index.js";
import { resolvePath } from "../paths.js";
import type { ParsedNetlist, ErrorResult } from "../types.js";

/**
 * Normalize unconnected pins to "NC" (No Connect).
 */
const normalizeUnconnectedPins = (netlist: ParsedNetlist): void => {
  for (const component of Object.values(netlist.components)) {
    for (const [pin, net] of Object.entries(component.pins)) {
      if (typeof net === "string") {
        if (net === "") {
          component.pins[pin] = "NC";
        }
        continue;
      }

      if (net?.net === "") {
        net.net = "NC";
      }
    }
  }
};

/**
 * Load netlist from a design file path.
 * Delegates to the appropriate handler based on file extension.
 */
export const loadNetlist = async (designPath: string): Promise<ParsedNetlist | ErrorResult> => {
  const normalizedPath = resolvePath(designPath);
  const handler = findHandler(normalizedPath);
  if (!handler) {
    const ext = path.extname(normalizedPath);
    return {
      error: `Unsupported design file format '${ext}'. Supported: .dsn, .cpm (Cadence), .PrjPcb, .SchDoc (Altium), .kicad_pro, .kicad_sch (KiCad), .json (Universal Netlist)`,
    };
  }

  try {
    const parsed = await parseDesign(normalizedPath);
    normalizeUnconnectedPins(parsed);
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error occurred";
    return { error: message };
  }
};
