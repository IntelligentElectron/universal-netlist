/**
 * Duplicate reference designators
 *
 * Several PlacedInstances sharing one refdes are normally the units of one
 * multi-unit part. A schematic can also give one refdes to two different
 * parts, which Cadence will not netlist. Every later stage keys parts and pins
 * by refdes, so those parts would merge into one record whose metadata comes
 * from one part and whose pins come from the other. This pass tells the two
 * cases apart and gives each part of a duplicated refdes its own internal key
 * (see duplicateKey), so both reach the netlist intact.
 *
 * A part can also draw one of its sections twice. Whether that is still one
 * part depends on the wiring, which is only known once connectivity is built,
 * so such a copy is keyed apart here and mergeRepeatedSections folds it back
 * when no pin of the two copies sits on two different nets.
 */

import type { PageData } from "./page-parser.js";
import type { PlacedInstance } from "./structures.js";
import { MANUFACTURER_PN_KEYS, PART_NUMBER_KEYS, readProperty } from "./component-builder.js";
import { isValidRefdes } from "../../../circuit-traversal.js";
import {
  duplicateKey,
  type DuplicatePart,
  type RepeatedSection,
} from "../../../duplicate-refdes.js";
import { getPinNet, type ComponentDetails, type NetConnections } from "../../../types.js";

interface PartGroup {
  pkg: string;
  internalPn?: string;
  mpn?: string;
  /** The page of each placement of each section. */
  sections: Map<number, string[]>;
  /** The part this one would have joined but for drawing a section it already has. */
  twinOf?: number;
}

/** Two part numbers disagree only when both are recorded: a unit may leave them blank. */
const differs = (a: string | undefined, b: string | undefined): boolean =>
  a !== undefined && b !== undefined && a.trim() !== b.trim();

const pageLabel = (page: PageData): string => {
  const block = page.placement?.path.join("/");
  return block ? `${page.name} (block ${block})` : page.name;
};

const unique = (pages: string[]): string[] => [...new Set(pages)];

/** Page names in natural order: 9 before 10. */
const byPage = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true });

const pagesOf = (group: PartGroup): string[] =>
  unique([...group.sections.values()].flat()).sort(byPage);

export interface DuplicateRefdesResult {
  /** Each duplicated refdes and its parts, in the order the pages list them. */
  duplicates: Record<string, DuplicatePart[]>;
  /** The key each renamed instance now carries, by `<dbId>|<refdes>`. */
  renamed: Map<string, string>;
  /** Per refdes, its parts' sections, for mergeRepeatedSections. */
  groups: Map<string, PartGroup[]>;
}

/**
 * Give every part of a duplicated refdes its own key.
 *
 * An instance joins an existing part of its refdes when it comes from the same
 * package, carries no conflicting part number, and draws a section that part
 * has not drawn yet. Otherwise it is another part.
 */
export function separateDuplicateRefdes(
  pages: PageData[],
  strLst: string[]
): DuplicateRefdesResult {
  const groups = new Map<string, PartGroup[]>();
  const partOf = new Map<PlacedInstance, number>();

  for (const page of pages) {
    for (const inst of page.placedInstances) {
      const refdes = inst.reference;
      if (!refdes || !isValidRefdes(refdes)) continue;
      // Libraries name one package's sections in either case (PAD_1x9, PAD_1X9).
      const pkg = inst.sourcePackage.replace(/_\d+$/, "").toUpperCase();
      const internalPn = readProperty(inst.prefixProperties, strLst, PART_NUMBER_KEYS);
      const mpn = readProperty(inst.prefixProperties, strLst, MANUFACTURER_PN_KEYS);

      const parts = groups.get(refdes) ?? [];
      groups.set(refdes, parts);
      const sameKind = (part: PartGroup): boolean =>
        part.pkg === pkg && !differs(part.internalPn, internalPn) && !differs(part.mpn, mpn);
      let index = parts.findIndex(
        (part) => sameKind(part) && !part.sections.has(inst.sectionIndex)
      );
      if (index === -1) {
        const twin = parts.findIndex(sameKind);
        index = parts.push({ pkg, sections: new Map(), ...(twin !== -1 && { twinOf: twin }) }) - 1;
      }
      const part = parts[index];
      part.sections.set(inst.sectionIndex, [
        ...(part.sections.get(inst.sectionIndex) ?? []),
        pageLabel(page),
      ]);
      part.internalPn ??= internalPn;
      part.mpn ??= mpn;
      partOf.set(inst, index);
    }
  }

  const duplicates: Record<string, DuplicatePart[]> = {};
  const renamed = new Map<string, string>();
  for (const [refdes, parts] of groups) {
    if (parts.length < 2) continue;
    duplicates[refdes] = parts.map((part, i) => ({
      key: duplicateKey(refdes, i + 1),
      pages: pagesOf(part),
    }));
  }
  if (Object.keys(duplicates).length === 0) return { duplicates, renamed, groups };

  for (const page of pages) {
    page.placedInstances = page.placedInstances.map((inst): PlacedInstance => {
      const parts = duplicates[inst.reference];
      const index = partOf.get(inst);
      if (!parts || index === undefined) return inst;
      const key = parts[index].key;
      renamed.set(`${inst.dbId}|${inst.reference}`, key);
      return { ...inst, reference: key };
    });
  }
  return { duplicates, renamed, groups };
}

/** Move every pin a net gives `from` to `to`. */
const renameInNets = (nets: NetConnections, from: string, to: string): void => {
  for (const conns of Object.values(nets)) {
    const pins = conns[from];
    if (!pins) continue;
    delete conns[from];
    conns[to] = [...new Set([...(conns[to] ?? []), ...pins])];
  }
};

/**
 * Fold each copy split off for drawing a section its part already has back
 * into that part, unless the two wire one pin to two different nets. A pin no
 * net reaches on one copy (`NC`) takes the other copy's net.
 *
 * Updates `result.duplicates`, the nets and components, and the occurrence
 * refdes a variant resolves through, and returns the sections each refdes
 * draws more than once.
 */
export function mergeRepeatedSections(
  result: DuplicateRefdesResult,
  nets: NetConnections,
  components: ComponentDetails,
  occurrenceRefdes: Map<number, string>
): Record<string, RepeatedSection[]> {
  const repeated: Record<string, RepeatedSection[]> = {};
  const renameOccurrences = (from: string, to: string): void => {
    for (const [id, refdes] of occurrenceRefdes) if (refdes === from) occurrenceRefdes.set(id, to);
  };

  for (const [refdes, parts] of Object.entries(result.duplicates)) {
    const groups = result.groups.get(refdes)!;
    const mergedInto = new Map<number, number>();
    const root = (i: number): number => (mergedInto.has(i) ? root(mergedInto.get(i)!) : i);

    groups.forEach((group, k) => {
      if (group.twinOf === undefined) return;
      const j = root(group.twinOf);
      const into = components[parts[j].key];
      const from = components[parts[k].key];
      if (!into || !from) return;
      const conflict = Object.entries(from.pins).some(([pin, entry]) => {
        const theirs = into.pins[pin];
        if (theirs === undefined) return false;
        const a = getPinNet(entry);
        const b = getPinNet(theirs);
        return a !== b && a !== "NC" && b !== "NC";
      });
      if (conflict) return;

      for (const [pin, entry] of Object.entries(from.pins)) {
        if (into.pins[pin] === undefined || getPinNet(into.pins[pin]) === "NC")
          into.pins[pin] = entry;
      }
      renameInNets(nets, parts[k].key, parts[j].key);
      const nc = nets.NC?.[parts[j].key];
      if (nc) {
        const still = nc.filter((pin) => getPinNet(into.pins[pin]) === "NC");
        if (still.length > 0) nets.NC[parts[j].key] = still;
        else delete nets.NC[parts[j].key];
        if (Object.keys(nets.NC).length === 0) delete nets.NC;
      }
      delete components[parts[k].key];
      renameOccurrences(parts[k].key, parts[j].key);
      mergedInto.set(k, j);

      const target = groups[j];
      for (const [section, pages] of group.sections) {
        target.sections.set(
          section,
          [...(target.sections.get(section) ?? []), ...pages].sort(byPage)
        );
      }
    });
    if (mergedInto.size === 0) continue;

    const kept = parts.filter((_, i) => !mergedInto.has(i));
    kept.forEach((part) => {
      const i = parts.indexOf(part);
      part.pages = pagesOf(groups[i]);
      const repeats = [...groups[i].sections]
        .sort(([a], [b]) => a - b)
        .filter(([, pages]) => pages.length > 1)
        .map(([section, pages]) => ({
          ...(groups[i].sections.size > 1 && { section: String.fromCharCode(65 + section) }),
          pages,
        }));
      if (repeats.length > 0) repeated[kept.length === 1 ? refdes : part.key] = repeats;
    });

    if (kept.length > 1) {
      result.duplicates[refdes] = kept;
      continue;
    }
    delete result.duplicates[refdes];
    const key = kept[0].key;
    components[refdes] = components[key];
    delete components[key];
    renameInNets(nets, key, refdes);
    renameOccurrences(key, refdes);
  }
  return repeated;
}
