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
 * The design is loaded as every query loads it, by `loadNetlist`: the same
 * variant rules, file reader and parse cache. A design that declares variants
 * is exported only as one of them, and the file records that name in
 * `metadata.designVariant`. A design that declares none is exported as its
 * base build.
 */

import { writeFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { z } from "zod";
import { readText } from "../parsers/context.js";
import { vendorOrigin } from "../parsers/index.js";
import {
  isUniversalFile,
  serializeUniversalNetlist,
  type UniversalNetlistOrigin,
  universalDesignName,
} from "../parsers/universal/index.js";
import { DEFAULT_VARIANT } from "../parsers/variants.js";
import { resolvePath } from "../paths.js";
import { loadNetlist } from "../service/load-netlist.js";
import { DESIGN_VARIANT_ARGUMENT, WRITES_TO_DISK, defineTool } from "../tools/index.js";
import type { ComponentDetails, ErrorResult, ParsedNetlist, PinEntry } from "../types.js";

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

/**
 * The netlist as the file records it. `loadNetlist` names a pin that is
 * connected to nothing `NC`, while the file leaves its net empty, so such a pin
 * is written back as `""`. A pin that a net called `NC` lists is on that net,
 * and keeps it.
 */
const withUnconnectedPinsEmpty = (netlist: ParsedNetlist): ParsedNetlist => {
  const components: ComponentDetails = {};
  for (const [refdes, component] of Object.entries(netlist.components)) {
    const onNcNet = netlist.nets.NC?.[refdes] ?? [];
    const pins: Record<string, PinEntry> = {};
    for (const [pin, entry] of Object.entries(component.pins)) {
      const net = typeof entry === "string" ? entry : entry.net;
      if (net !== "NC" || onNcNet.includes(pin)) pins[pin] = entry;
      else pins[pin] = typeof entry === "string" ? "" : { name: entry.name, net: "" };
    }
    components[refdes] = { ...component, pins };
  }
  return { nets: netlist.nets, components };
};

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
    const loaded = await loadNetlist(designPath, args.design_variant, context);
    if ("error" in loaded) return loaded;

    // A Universal Netlist is one build already, and its provenance carries
    // over. The load above has validated the file.
    const origin: UniversalNetlistOrigin = isUniversalFile(designPath)
      ? JSON.parse(await readText(context.parser.files, designPath)).metadata.origin
      : vendorOrigin(loaded.format, designPath);
    const name = isUniversalFile(designPath)
      ? universalDesignName(designPath)
      : basename(designPath, extname(designPath));
    const output = resolve(args.output ?? `${name}.netlist.json`);
    const designVariant =
      loaded.design_variant === DEFAULT_VARIANT ? undefined : loaded.design_variant;
    writeFileSync(
      output,
      serializeUniversalNetlist(withUnconnectedPinsEmpty(loaded), { origin, designVariant })
    );
    return { design: designPath, design_variant: loaded.design_variant, output };
  },
});
