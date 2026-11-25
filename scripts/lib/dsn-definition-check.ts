/**
 * Check a `.DSN`'s resolved pins against the file's own part definitions.
 *
 * A placed part names its package, its library, its view and its section
 * index (docs/cadence-dsn-format.md §7.4). The Cache holds one package per
 * name and source library; inside it, the Device that draws with the view's
 * cell is the part's section, the section index choosing among devices that
 * share a cell (§5.6). That Device's slots are the part's physical pins, and
 * the view's pins carry their names.
 *
 * This walks those links directly, by name, library and cell, and compares
 * each pin with what the parser resolves through its own lookup
 * (`resolvePinNumber`, `isPinIgnored`, `findCachedPart`). The two readings
 * share the record decoders and nothing else, so a difference is a lookup
 * that picked another definition, section or symbol than the file names.
 */
import { BinaryReader } from "../../src/parsers/cadence/dsn/binary-reader.js";
import { walkCacheTables } from "../../src/parsers/cadence/dsn/cache-parser.js";
import { findCachedPart } from "../../src/parsers/cadence/dsn/component-builder.js";
import { readPartDefinitions } from "../../src/parsers/cadence/dsn/dsn-parser.js";
import { DsnReader, ROOT_LIBRARY } from "../../src/parsers/cadence/dsn/dsn-reader.js";
import {
  assertReadableLibraryVersion,
  parseLibraryStream,
  readLibraryVersion,
} from "../../src/parsers/cadence/dsn/library-parser.js";
import { parsePage } from "../../src/parsers/cadence/dsn/page-parser.js";
import {
  extractUnitRef,
  isPinIgnored,
  resolvePinNumber,
} from "../../src/parsers/cadence/dsn/pin-resolver.js";
import { StructureType } from "../../src/parsers/cadence/dsn/structure-types.js";
import {
  parseLibraryPart,
  parsePackage,
  type Device,
} from "../../src/parsers/cadence/dsn/structures.js";

export interface DefinitionCheck {
  /** Placed parts checked against a package of their own library. */
  parts: number;
  pins: number;
  /** Pins whose slot in the file holds no physical number. */
  unnumbered: number;
  /** Pins whose resolved number, Pin Ignore flag or name is not the file's. */
  differences: string[];
  /** Parts with nothing to check against: no library named, or no package of theirs in it. */
  unchecked: string[];
  /** Checked parts of multi-section packages, per cell of the table `section-pin-map`. */
  sectionCells: Record<string, number>;
  /** Parts per cell of the table `part-definition`. */
  definitionCells: Record<string, number>;
}

const stripped = (name: string): string => name.replace(/_\d+$/, "");
const count = (cells: Record<string, number>, cell: string): void => {
  cells[cell] = (cells[cell] ?? 0) + 1;
};

/** Throws what `parseDsnFile` throws for a design it does not read. */
export function checkPartDefinitions(source: Uint8Array | string): DefinitionCheck {
  const ole = new DsnReader(source);
  const entries = ole.listAllEntries();

  // The Library version says which page encoding the design was written in.
  const library = entries.find((e) => e.path === ROOT_LIBRARY && e.entry.type === 2);
  const libraryStream = library ? ole.readStreamByPath(library.path) : undefined;
  assertReadableLibraryVersion(libraryStream ? readLibraryVersion(libraryStream) : undefined);
  let strLst: string[] = [];
  try {
    if (libraryStream) ({ strLst } = parseLibraryStream(libraryStream));
  } catch {
    // No string table: no part names its library, and every part is unchecked.
  }

  // The file's definitions, by source library and name.
  const packages = new Map<string, Map<string, Device[]>>();
  const views = new Map<string, Map<string, string[]>>();
  const librariesOf = new Map<string, Set<string>>();
  const cache = entries.find((e) => e.path === "Cache" && e.entry.type === 2);
  if (cache) {
    walkCacheTables(ole.readStreamByPath(cache.path), (type, name, record, lib) => {
      try {
        if (type === StructureType.Package) {
          const pkg = parsePackage(new BinaryReader(record));
          if (!packages.has(lib)) packages.set(lib, new Map());
          if (!packages.get(lib)!.has(pkg.name)) packages.get(lib)!.set(pkg.name, pkg.devices);
          if (!librariesOf.has(pkg.name)) librariesOf.set(pkg.name, new Set());
          librariesOf.get(pkg.name)!.add(lib);
        } else if (type === StructureType.LibraryPart) {
          const part = parseLibraryPart(new BinaryReader(record));
          if (!views.has(lib)) views.set(lib, new Map());
          if (!views.get(lib)!.has(name)) views.get(lib)!.set(name, part.pinNames);
        }
      } catch {
        // A record that will not parse defines nothing here either.
      }
    });
  }
  const streams = new Set<string>();
  for (const e of entries) {
    if (!/^Packages\//.test(e.path) || e.entry.type !== 2) continue;
    if (e.path.includes("_pDboPackage_Copy_")) continue;
    const name = e.path.replace("Packages/", "");
    streams.add(name).add(stripped(name));
  }

  const { pmd, cachedParts } = readPartDefinitions(ole, entries);
  const result: DefinitionCheck = {
    parts: 0,
    pins: 0,
    unnumbered: 0,
    differences: [],
    unchecked: [],
    sectionCells: {},
    definitionCells: {},
  };

  for (const entry of entries) {
    if (!/^Views\/[^/]+\/Pages\//.test(entry.path) || entry.entry.type !== 2) continue;
    const page = parsePage(ole.readStreamByPath(entry.path));
    for (const parsed of page.placedInstances) {
      const lib = parsed.libraryIdx === undefined ? undefined : strLst[parsed.libraryIdx];
      const inst = { ...parsed, library: lib };
      const names = [inst.sourcePackage, stripped(inst.sourcePackage)];
      const own = lib === undefined ? undefined : packages.get(lib);
      const devices = own?.get(names[0]) ?? own?.get(names[1]);
      const where = `${page.name} ${inst.reference} ${inst.pkgName}`;

      const elsewhere = names.some((n) => [...(librariesOf.get(n) ?? [])].some((l) => l !== lib));
      count(
        result.definitionCells,
        [
          lib === undefined ? "not named" : devices ? "defines the part" : "lacks the part",
          names.some((n) => streams.has(n)) ? "holds the part" : "none",
          elsewhere ? "defines the part" : "none",
        ].join(" | ")
      );
      if (!devices) {
        result.unchecked.push(where);
        continue;
      }
      result.parts++;

      // The section: the device of the view's cell, by index among those sharing it.
      const dot = inst.pkgName.lastIndexOf(".");
      const cell = dot >= 0 ? inst.pkgName.slice(0, dot) : inst.pkgName;
      const drawn = devices.flatMap((d, i) => (d.cellName === cell ? [i] : []));
      const section = drawn.length === 1 ? drawn[0] : inst.sectionIndex;
      if (drawn.length === 0) result.differences.push(`${where}: no device draws cell ${cell}`);
      else if (!drawn.includes(section)) {
        result.differences.push(`${where}: section ${section} does not draw cell ${cell}`);
      }
      const device = devices[section];

      const scope = pmd.libraries?.get(lib!);
      if (devices.length > 1 && scope) {
        const unit = extractUnitRef(inst);
        const mapped =
          unit !== undefined &&
          names.some(
            (n) =>
              scope.cachePinMaps.has(n + unit) ||
              (unit.length >= 2 && unit[0] === unit[1] && scope.cachePinMaps.has(n + unit[0]))
          );
        const listed = names.find((n) => scope.deviceUnitRefs.has(n));
        const units = listed === undefined ? undefined : scope.deviceUnitRefs.get(listed);
        const aMap = names.find((n) => scope.cachePinMaps.has(`${n}A`));
        const under = (name: string | undefined): string =>
          name === undefined ? "none" : name === names[0] ? "source" : "stripped";
        count(
          result.sectionCells,
          names.some((n) => scope.cachePinMaps.has(n))
            ? "a single-device map under the name"
            : [
                unit === undefined ? "no" : mapped ? "yes" : "unmapped",
                units && inst.sectionIndex < units.length ? "in-range" : "out-of-range",
                under(listed),
                under(aMap),
              ].join(",")
        );
      }

      const pinNames = findCachedPart(inst, cachedParts)?.pinNames;
      const ownNames = views.get(lib!)?.get(inst.pkgName);
      for (const pin of inst.t0x10s) {
        if (pin.pinIndex <= 0) continue;
        result.pins++;
        const at = `${where} pin ${pin.pinIndex}`;
        const number = device?.pinMap[pin.pinIndex - 1];
        const resolved = resolvePinNumber(pin, inst, pmd, inst.sectionIndex);
        if (!number) result.unnumbered++;
        else if (resolved !== number) {
          result.differences.push(`${at}: number ${resolved}, the file has ${number}`);
        }
        const ignored = device?.pinIgnore[pin.pinIndex - 1] ?? false;
        if (isPinIgnored(pin, inst, pmd, inst.sectionIndex) !== ignored) {
          result.differences.push(`${at}: Pin Ignore ${!ignored}, the file has ${ignored}`);
        }
        const name = ownNames?.[pin.pinIndex - 1];
        if (ownNames && pinNames?.[pin.pinIndex - 1] !== name) {
          result.differences.push(
            `${at}: name ${pinNames?.[pin.pinIndex - 1]}, the file has ${name}`
          );
        }
      }
    }
  }
  return result;
}
