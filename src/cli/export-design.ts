/**
 * export_design: write one build of a design as Universal Netlist JSON
 * (docs/schemas/universal-netlist.md).
 *
 *   universal-netlist export_design board.DSN --design_variant Fab-A
 *   universal-netlist export_design MyBoard.kicad_pro --output out/board.netlist.json
 *
 * It is a tool of the command line only. Its definition has a tool's shape, so
 * the command line parses its flags, prints its help and its JSON result, and
 * sets its exit code exactly as for a registry tool, but it is not in the
 * registry: the MCP server never offers it. An agent with MCP answers questions
 * with the query tools; a whole-design file is for a program that
 * post-processes the netlist.
 *
 * The build is chosen by the rule every query applies: a design that declares
 * variants is exported only as one of them, and the file records that name in
 * `metadata.designVariant`. A design that declares none is exported as its
 * base build.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { z } from "zod";
import { findHandler, parseDesign } from "../parsers/index.js";
import {
  isUniversalFile,
  parseUniversalNetlistDocument,
  serializeUniversalNetlist,
  type UniversalNetlistOrigin,
  universalDesignName,
} from "../parsers/universal/index.js";
import { resolvePath } from "../paths.js";
import { selectDesignVariant } from "../service/load-netlist.js";
import { DESIGN_VARIANT_ARGUMENT, WRITES_TO_DISK, defineTool } from "../tools/index.js";
import type { ErrorResult, ParsedNetlist } from "../types.js";

export const EXPORT_DESIGN_DESCRIPTION =
  "Write one build of a design as a Universal Netlist JSON file (.netlist.json), for a program " +
  "that post-processes the whole netlist outside universal-netlist. To answer a question about a " +
  "design, use the query tools instead: they read the design directly and return only what was " +
  "asked. A design with named variants is exported as the one design_variant names, and the file " +
  "records it in metadata.designVariant; each part's dns flag is its Do Not Stuff state in that " +
  "build. The written file is itself a design every tool reads. Command line only; the MCP " +
  "server does not offer it.";

/** What export_design returns: the design it read, the build it wrote, and where. */
export interface ExportDesignResult {
  design: string;
  /** The build written: a declared variant's name, or `<Default>`. */
  design_variant: string;
  /** The absolute path of the written `.netlist.json` file. */
  output: string;
}

const VENDORS: Record<string, string> = { cadence: "Cadence", altium: "Altium", kicad: "KiCad" };

export const exportDesignTool = defineTool({
  name: "export_design",
  title: "Export design as Universal Netlist JSON",
  description: EXPORT_DESIGN_DESCRIPTION,
  annotations: WRITES_TO_DISK,
  inputSchema: z.strictObject({
    design: z.string().describe("Path to design file"),
    output: z
      .string()
      .refine(isUniversalFile, "Universal Netlist output paths must end in .netlist.json")
      .optional()
      .describe(
        "Output path, ending in .netlist.json. Default: <design name>.netlist.json in the working directory"
      ),
    design_variant: DESIGN_VARIANT_ARGUMENT,
  }),
  run: async (args, context): Promise<ExportDesignResult | ErrorResult> => {
    const designPath = resolvePath(args.design, context.root);
    const handler = findHandler(designPath);
    if (!handler) return { error: `Unsupported design format: ${designPath}` };

    let netlist: ParsedNetlist;
    let origin: UniversalNetlistOrigin;
    const variants = handler.listVariants
      ? await handler.listVariants(designPath, context.parser)
      : [];
    const selection = selectDesignVariant(variants, args.design_variant, basename(designPath));
    if ("error" in selection) return selection;

    if (isUniversalFile(designPath)) {
      // A Universal Netlist is one build already; its provenance carries over.
      const document = parseUniversalNetlistDocument(
        readFileSync(designPath, "utf-8"),
        basename(designPath)
      );
      netlist = { nets: document.nets, components: document.components };
      origin = document.metadata.origin;
    } else {
      netlist = await parseDesign(designPath, {
        variant: selection.selected,
        context: context.parser,
      });
      origin = {
        type: "vendor",
        source: {
          vendor: VENDORS[handler.name] ?? handler.name,
          fileType: extname(designPath).toLowerCase(),
        },
      };
    }

    const name = isUniversalFile(designPath)
      ? universalDesignName(designPath)
      : basename(designPath, extname(designPath));
    const output = resolve(args.output ?? `${name}.netlist.json`);
    writeFileSync(
      output,
      serializeUniversalNetlist(netlist, { origin, designVariant: selection.native?.name })
    );
    return { design: designPath, design_variant: selection.selected, output };
  },
});
