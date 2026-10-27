/**
 * The positional functions `./service` has always exported, kept as thin
 * wrappers over the tool registry. Each one builds the tool's arguments and
 * calls it, so its defaults are the schema's, and it reads designs from the
 * local disk with the environment's settings, as it always has.
 *
 * New code calls `createNetlistService` instead, whose methods take the tool's
 * own argument names and whose files and settings come from options.
 */

import { callTool } from "../tools/index.js";
import { serviceContextFromEnvironment } from "./context.js";
import type { ListDesignsOptions } from "./tools/list-designs.js";
import type { ErcOptions, ErcResult } from "./tools/run-erc.js";
import type {
  AggregatedCircuitResult,
  ErrorResult,
  ListComponentsResult,
  ListDesignsResult,
  ListNetsResult,
  QueryComponentResult,
  SearchComponentsResult,
  SearchNetsResult,
} from "../types.js";

/**
 * Run a tool on the environment's context, keeping only the arguments given.
 * An empty design variant is no variant, as these functions have always read
 * it, though the tool's schema refuses one.
 */
const run = <R>(name: string, args: Record<string, unknown>): Promise<R | ErrorResult> =>
  callTool(
    name,
    Object.fromEntries(
      Object.entries(args).filter(
        ([key, value]) => value !== undefined && !(key === "design_variant" && value === "")
      )
    ),
    serviceContextFromEnvironment()
  ) as Promise<R | ErrorResult>;

export const listDesigns = (
  options: ListDesignsOptions = {}
): Promise<ListDesignsResult | ErrorResult> =>
  run("list_designs", {
    path: options.searchPath,
    pattern: options.pattern,
    max_depth: options.maxDepth,
    max_results: options.maxResults,
  });

export const listComponents = (
  design: string,
  type: string,
  includeDns?: boolean,
  designVariant?: string
): Promise<ListComponentsResult | ErrorResult> =>
  run("list_components", {
    design,
    type,
    include_dns: includeDns,
    design_variant: designVariant,
  });

export const listNets = (
  design: string,
  designVariant?: string
): Promise<ListNetsResult | ErrorResult> =>
  run("list_nets", { design, design_variant: designVariant });

export const searchNets = (
  pattern: string,
  design: string,
  designVariant?: string
): Promise<SearchNetsResult | ErrorResult> =>
  run("search_nets", { pattern, design, design_variant: designVariant });

const searchComponents =
  (name: string) =>
  (
    pattern: string,
    design: string,
    includeDns?: boolean,
    designVariant?: string
  ): Promise<SearchComponentsResult | ErrorResult> =>
    run(name, { pattern, design, include_dns: includeDns, design_variant: designVariant });

export const searchComponentsByRefdes = searchComponents("search_components_by_refdes");
export const searchComponentsByMpn = searchComponents("search_components_by_mpn");
export const searchComponentsByDescription = searchComponents("search_components_by_description");

export const queryComponent = (
  design: string,
  refdes: string,
  designVariant?: string
): Promise<QueryComponentResult | ErrorResult> =>
  run("query_component", { design, refdes, design_variant: designVariant });

const queryXnet =
  (name: string, key: "net_name" | "pin_name") =>
  (
    design: string,
    query: string,
    skipTypes?: string[],
    includeDns?: boolean,
    designVariant?: string
  ): Promise<AggregatedCircuitResult | ErrorResult> =>
    run(name, {
      design,
      [key]: query,
      skip_types: skipTypes,
      include_dns: includeDns,
      design_variant: designVariant,
    });

export const queryXnetByNetName = queryXnet("query_xnet_by_net_name", "net_name");
export const queryXnetByPinName = queryXnet("query_xnet_by_pin_name", "pin_name");

export const runErc = (design: string, opts: ErcOptions = {}): Promise<ErcResult | ErrorResult> =>
  run("run_erc", {
    design,
    include_dns: opts.includeDns,
    include_rules: opts.includeRules,
    exclude_rules: opts.excludeRules,
    design_variant: opts.designVariant,
  });
