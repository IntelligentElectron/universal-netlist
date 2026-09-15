/**
 * An Altium project: every document instance parsed, and the instances merged into one
 * netlist across harnesses, ports, sheet entries, buses and power ports.
 */

import { readFile } from "fs/promises";
import type { ParsedNetlist, ParseDesignOptions } from "../../types.js";
import type { NetNameSource } from "./types.js";
import { flattenHierarchy } from "./records.js";
import { identifierKey } from "./notation.js";
import { findAltiumSchDocs } from "./discovery.js";
import { parseProjectOptions, resolveNetIdentifierScope } from "./project-options.js";
import { applyAltiumVariant, parseAltiumProjectVariants } from "./project-variants.js";
import { nameRanks, type NetNamingOptions } from "./net-naming.js";
import { collectNestedHarnessTypes, parseHarnessDefinitions } from "./harness.js";
import {
  parseDocument,
  readDocument,
  renameDocumentNets,
  type ParsedDocument,
  type ReadDocument,
} from "./document.js";
import {
  documentInstances,
  findSheetPlacements,
  type DocumentInstance,
  type SheetPlacement,
} from "./sheet-hierarchy.js";
import { channelDocument, channelNetScope, sharedEntryNames } from "./channels.js";
import { linkedNetGroups, type InstanceLinks } from "./links.js";
import { resolveBundles } from "./bundles.js";
import { planLocalNetRenames } from "./net-scoping.js";
import {
  PROVISIONAL,
  applyNetRenames,
  canonicalNetName,
  mergeNetGroups,
  mergeNetlistInto,
  reconcileNetlist,
  settleProvisionalNames,
} from "./netlist.js";

type Ranks = Readonly<Record<NetNameSource, number>>;

/** A sheet's `.Harness` file beside it, or no definitions. */
const readHarnessDefinitions = async (schdocPath: string) => {
  try {
    return parseHarnessDefinitions(
      await readFile(schdocPath.replace(/\.SchDoc$/i, ".Harness"), "utf-8")
    );
  } catch {
    return new Map<string, string[]>();
  }
};

/**
 * Parse each document once per instance. The channels of one symbol under a parent with
 * one instance share the signals the symbol's plain entries carry; no other instances
 * share anything by name.
 */
const parseInstances = async (
  documents: readonly ReadDocument[],
  placements: ReadonlyMap<string, readonly SheetPlacement[]>,
  instances: ReadonlyMap<string, readonly DocumentInstance[]>,
  naming: NetNamingOptions,
  channelFormat: string
): Promise<ParsedDocument[]> => {
  const parsed: ParsedDocument[] = [];
  for (const read of documents) {
    const channels = instances.get(read.name) ?? [];
    if (channels.length <= 1) {
      parsed.push(parseDocument(read, naming, channels[0]?.key));
      continue;
    }
    const base = parseDocument(read, naming);
    const placed = placements.get(read.name) ?? [];
    const [{ parent, symbol }] = placed;
    const sharedNames =
      placed.length === 1 && (instances.get(parent.name) ?? []).length <= 1
        ? sharedEntryNames(
            symbol,
            await readHarnessDefinitions(parent.path),
            collectNestedHarnessTypes(flattenHierarchy(parent.hierarchical))
          )
        : new Set<string>();
    const scope = channelNetScope(base.nets, sharedNames);
    for (const channel of channels) {
      parsed.push(channelDocument(base, channel, channelFormat, scope));
    }
  }
  return parsed;
};

/** Give names that differ only in case the one spelling the merged net would keep. */
const unifySpellings = (
  documents: readonly ParsedDocument[],
  ranks: Ranks,
  unranked: number
): void => {
  const rank = new Map<string, number>();
  for (const document of documents) {
    for (const [name, source] of document.nameSources) {
      if (source !== "pin") rank.set(name, Math.min(rank.get(name) ?? unranked, ranks[source]));
    }
  }
  const spellings = new Map<string, string[]>();
  for (const name of rank.keys()) {
    const key = identifierKey(name);
    (spellings.get(key) ?? spellings.set(key, []).get(key)!).push(name);
  }
  const respell = new Map<string, string>();
  for (const names of spellings.values()) {
    const canonical = canonicalNetName(names, (name) => rank.get(name)!);
    for (const name of names) if (name !== canonical) respell.set(name, canonical);
  }
  for (const document of documents) renameDocumentNets(document, respell, ranks);
};

/** Parse an Altium project into one netlist. */
export const parseAltiumProject = async (
  projectPath: string,
  parseOptions?: ParseDesignOptions
): Promise<ParsedNetlist> => {
  const schdocPaths = await findAltiumSchDocs(projectPath);
  if (schdocPaths.length === 0) {
    throw new Error(`No schematic documents found for project ${projectPath}`);
  }

  const options = parseProjectOptions(await readFile(projectPath, "utf-8").catch(() => ""));
  const naming: NetNamingOptions = {
    allowPortNetNames: options.allowPortNetNames,
    allowSheetEntryNetNames: options.allowSheetEntryNetNames,
    powerPortNamesTakePriority: options.powerPortNamesTakePriority,
  };
  const ranks = nameRanks(naming);
  const unranked = ranks.pin + 1;

  const documents = schdocPaths.map(readDocument);
  const placements = findSheetPlacements(documents);
  const instances = documentInstances(documents, placements, options.roomNamingStyle);
  const pending = await parseInstances(
    documents,
    placements,
    instances,
    naming,
    options.channelFormat
  );

  const scope = resolveNetIdentifierScope(options, {
    hasSheetEntries: pending.some((document) => document.hasSheetEntries),
    hasPorts: pending.some((document) => document.hasPorts),
  });
  unifySpellings(pending, ranks, unranked);

  // Same-named local nets on different sheets are one net unless the project numbers them.
  const sheetRenames = options.appendSheetNumberToLocalNets
    ? planLocalNetRenames(pending, scope)
    : pending.map(() => new Map<string, string>());

  // Under Hierarchical scope a name a port or entry gives is its sheet's own until links
  // resolve.
  const namesAreSheetLocal = scope === "hierarchical" || scope === "strict-hierarchical";
  const netlist: ParsedNetlist = { nets: {}, components: {} };
  const nameRank = new Map<string, number>();
  const rankOf = (name: string): number => nameRank.get(name) ?? unranked;
  pending.forEach((document, index) => {
    const renames = new Map(sheetRenames[index]);
    for (const [name, source] of namesAreSheetLocal ? document.nameSources : []) {
      if (source !== "port" && source !== "entry") continue;
      renames.set(name, `${renames.get(name) ?? name}${PROVISIONAL}${index}`);
    }
    renameDocumentNets(document, renames, ranks);
    mergeNetlistInto(netlist, document.netlist);
    for (const [name, source] of document.nameSources) {
      if (ranks[source] < rankOf(name)) nameRank.set(name, ranks[source]);
    }
  });

  const symbolChannels = new Map<string, number[]>();
  for (const placed of placements.values()) {
    for (const { parent, symbol, channels } of placed) {
      symbolChannels.set(
        `${parent.name}#${symbol.index}`,
        channels.map((channel) => channel.index)
      );
    }
  }

  const resolveSignal = resolveBundles(pending, scope, symbolChannels);
  const links: InstanceLinks[] = pending.map((document) => ({
    placement: document.placement,
    document: document.name,
    groups: document.links.map((group) => ({
      ...group,
      keys: group.keys.map((key) =>
        key.startsWith("harness|")
          ? `harness|${resolveSignal(document, key.slice("harness|".length))}`
          : key
      ),
    })),
  }));
  mergeNetGroups(netlist, linkedNetGroups(links, scope, symbolChannels).values(), rankOf);
  applyNetRenames(netlist, settleProvisionalNames(netlist.nets));
  reconcileNetlist(netlist);

  applyAltiumVariant(
    netlist.components,
    parseAltiumProjectVariants(await readFile(projectPath, "utf-8")),
    parseOptions?.variant
  );
  return netlist;
};
