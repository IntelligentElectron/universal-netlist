/**
 * DSN Parser - Top-level orchestrator for OrCAD .DSN files
 *
 * Opens a .DSN CFBF container, parses Page, Package, Cache, Library,
 * and Hierarchy streams, then assembles a ParsedNetlist.
 */

import { DsnReader } from "./dsn-reader.js";
import type { ComponentDetails, ParsedNetlist, ParseDesignOptions } from "../../../types.js";
import type { CachedLibraryPart, PinMapData } from "./structure-types.js";
import { parsePage, parsePackageStream } from "./page-parser.js";
import { parseHierarchyStream, type HierarchyStream } from "./hierarchy-parser.js";
import { expandHierarchy } from "./hierarchy-expander.js";
import type { PageData } from "./page-parser.js";
import { parseCacheStream, indexLibraryPart } from "./cache-parser.js";
import { parseLibraryStrLst } from "./library-parser.js";
import { buildDeviceIndexMap } from "./pin-resolver.js";
import { buildNetConnectivity } from "./net-builder.js";
import { buildComponents } from "./component-builder.js";
import { readVariantDns } from "./variant-store.js";

/** Parse a .DSN file into a ParsedNetlist. */
export function parseDsnFile(dsnPath: string, options?: ParseDesignOptions): ParsedNetlist {
  const ole = new DsnReader(dsnPath);
  const entries = ole.listAllEntries();

  // Each view's Hierarchy stream is its occurrence tree: the root schematic's
  // nets and parts, and one nested scope per placement of every hierarchical
  // block. Best-effort: a view whose stream will not parse is read flat.
  const roots: HierarchyStream[] = [];
  for (const entry of entries) {
    if (!/^Views\/[^/]+\/Hierarchy\/Hierarchy$/.test(entry.path) || entry.entry.type !== 2)
      continue;
    try {
      roots.push(parseHierarchyStream(ole.readStreamByPath(entry.path)));
    } catch {
      // The pages still parse; they keep their inline references and flat nets.
    }
  }

  // Parse all Page streams, grouped by the schematic folder each sits in.
  const pagesBySchematic = new Map<string, PageData[]>();
  for (const entry of entries) {
    const match = /^Views\/([^/]+)\/Pages\//.exec(entry.path);
    if (!match || entry.entry.type !== 2) continue;
    const schematic = match[1].toLowerCase();
    const list = pagesBySchematic.get(schematic) ?? [];
    list.push(parsePage(ole.readStreamByPath(entry.path)));
    pagesBySchematic.set(schematic, list);
  }

  // Parse Library stream for strLst string table
  let strLst: string[] = [];
  const libEntry = entries.find(
    (e) => (e.path === "Library" || e.path.endsWith("/Library")) && e.entry.type === 2
  );
  if (libEntry) {
    try {
      const libBuffer = ole.readStreamByPath(libEntry.path);
      strLst = parseLibraryStrLst(libBuffer);
    } catch {
      // Library parsing is best-effort
    }
  }

  // One copy of a child schematic's pages per placement of the block that
  // draws it, carrying that placement's reference designators.
  const { pages, canonicalNetNames, occurrenceRefdes } = expandHierarchy(
    roots,
    pagesBySchematic,
    strLst
  );

  // Parse Package streams for pin mapping data.
  // Each Package stream contains Device entries with pinMap arrays that map
  // T0x10 index -> physical pin number/name. We index by sourcePackage
  // for lookup during pin resolution.
  const pmd: PinMapData = {
    pinMaps: new Map(),
    cachePinMaps: new Map(),
    deviceUnitRefs: new Map(),
    pinIgnores: new Map(),
    cachePinIgnores: new Map(),
  };
  const cachedParts = new Map<string, CachedLibraryPart>();
  // Keys a part claimed under its own name, which an alias must not displace.
  const exactPartNames = new Set<string>();
  const pkgStreamEntries = entries.filter(
    (e) =>
      /^Packages\//.test(e.path) && e.entry.type === 2 && !e.path.includes("_pDboPackage_Copy_")
  );

  for (const pkgEntry of pkgStreamEntries) {
    try {
      const pkgBuffer = ole.readStreamByPath(pkgEntry.path);
      const { pkg, libraryParts } = parsePackageStream(pkgBuffer);
      const streamName = pkgEntry.path.replace("Packages/", "");

      // Index pin maps by sourcePackage for pin number resolution.
      // For single-device packages, the sourcePackage key is the stream
      // name stripped of the trailing _N suffix. For multi-device (multi-unit)
      // packages, each device gets its own entry keyed by streamName + unitRef.
      const baseName = streamName.replace(/_\d+$/, "");
      if (pkg.devices.length === 1) {
        if (!pmd.pinMaps.has(baseName)) {
          pmd.pinMaps.set(baseName, pkg.devices[0].pinMap);
          pmd.pinIgnores.set(baseName, pkg.devices[0].pinIgnore);
        }
        // Also store by exact stream name for direct matches
        pmd.pinMaps.set(streamName, pkg.devices[0].pinMap);
        pmd.pinIgnores.set(streamName, pkg.devices[0].pinIgnore);
      } else {
        // Multi-unit: store per unit keyed by both baseName and streamName
        // so findPinMap can match either sourcePackage form.
        const unitRefs = pkg.devices.map((d) => d.unitRef);
        if (!pmd.deviceUnitRefs.has(baseName)) pmd.deviceUnitRefs.set(baseName, unitRefs);
        for (const device of pkg.devices) {
          const baseKey = baseName + device.unitRef;
          if (!pmd.pinMaps.has(baseKey)) {
            pmd.pinMaps.set(baseKey, device.pinMap);
            pmd.pinIgnores.set(baseKey, device.pinIgnore);
          }
          if (streamName !== baseName) {
            const streamKey = streamName + device.unitRef;
            if (!pmd.pinMaps.has(streamKey)) {
              pmd.pinMaps.set(streamKey, device.pinMap);
              pmd.pinIgnores.set(streamKey, device.pinIgnore);
            }
          }
        }
      }

      // Index LibraryPart pin names and default values.
      // Key by both the original LP name and the suffix-stripped form,
      // since LP names include a Package stream suffix (e.g., "RES_0.Normal")
      // but PlacedInstance.pkgName uses the base name (e.g., "RES.Normal").
      for (const lp of libraryParts) {
        indexLibraryPart(lp, cachedParts, exactPartNames);
      }
    } catch {
      // Package parsing is best-effort; skip malformed streams
    }
  }

  // Parse Cache stream as fallback for pin maps and library parts.
  // The Cache contains Package/Device structures (for pin number mapping) and
  // LibraryPart structures (for pin names) for all components in the design.
  const cacheEntry = entries.find((e) => e.path === "Cache" && e.entry.type === 2);
  if (cacheEntry) {
    try {
      const cacheBuf = ole.readStreamByPath(cacheEntry.path);
      parseCacheStream(cacheBuf, pmd, cachedParts, exactPartNames);
    } catch {
      // Cache parsing is best-effort
    }
  }

  // Build netlist from parsed data
  const deviceIndexMap = buildDeviceIndexMap(pages);
  const { nets, componentPins } = buildNetConnectivity(
    pages,
    canonicalNetNames,
    pmd,
    deviceIndexMap,
    strLst
  );
  const components = buildComponents(
    pages,
    componentPins,
    strLst,
    cachedParts,
    pmd,
    deviceIndexMap
  );

  // A design's variants carry their own Do Not Stuff set, which the values the
  // components were built from say nothing about.
  applyVariantDns(components, readVariantDns(ole, entries, occurrenceRefdes, options?.variant));

  return { nets, components };
}

/** Mark the components a variant leaves off the board. */
function applyVariantDns(components: ComponentDetails, dnsRefdes: Set<string>): void {
  for (const refdes of dnsRefdes) {
    const component = components[refdes];
    if (component) component.dns = true;
  }
}
