/**
 * Hierarchy Expander
 *
 * Turns the occurrence tree of each view's Hierarchy stream and the parsed
 * pages into the flat page list the net and component builders consume: one
 * copy of a child schematic's pages per placement of the block that draws it,
 * and the root's pages once.
 *
 * A placement's pages are copies whose instances carry the reference
 * designators and pin numbers that placement's scope annotates, whose pin net ids are moved
 * into a range of their own so two placements of one drawing never share a
 * net by id, and which know where each of their hierarchical ports meets the
 * parent page. Naming a placement's nets and joining its ports to the parent's
 * nets is the net builder's job; this module only records what it needs.
 *
 * Pages of a schematic that no root reaches, and no block places, are passed
 * through unchanged, which is also what every page gets in a design with no
 * Hierarchy stream at all.
 */

import type { PageData } from "./page-parser.js";
import {
  buildOccurrenceRefdes,
  walkBlockOccurrences,
  type HierarchyScope,
  type HierarchyStream,
  type PartOccurrence,
} from "./hierarchy-parser.js";
import type { PlacedInstance, T0x10 } from "./structures.js";

/** Where a placed page's hierarchical port meets the parent page's wiring. */
export interface PortBinding {
  /** Index, in the expanded page list, of the parent page. */
  pageIdx: number;
  /** The block pin's position on the parent page, as `"x,y"`. */
  coord: string;
  /** The block pin's net id, already in the parent placement's range. */
  netId: number;
}

/** What a page copy needs to know about the placement it belongs to. */
export interface Placement {
  /**
   * Instance names from the root down, such as `["MV1"]`: the name each
   * block occurrence annotates, or the name drawn on the block where the
   * occurrence annotates none.
   */
  path: string[];
  /**
   * Appended to the placement's local net names, so two placements of one
   * drawing report two nets: `_` and the path joined with `_`, uppercase,
   * which is how Capture's flat netlist names them at any depth.
   */
  suffix: string;
  /** What this placement's pin net ids were moved up by; see NET_ID_SPAN. */
  netIdOffset: number;
  /**
   * Hierarchical port name, uppercase, to the parent block pin it connects. A
   * bus port keeps its range in the name, such as `DATA[7:0]`.
   */
  ports: Map<string, PortBinding>;
  /** The names the Hierarchy stream gives this placement's nets, uppercase. */
  canonicalNetNames: Set<string>;
}

/** The pages and derived tables the rest of the parser works from. */
export interface ExpandedDesign {
  pages: PageData[];
  /** The root scopes' net names, uppercase: the design's flat net name list. */
  canonicalNetNames: Set<string>;
  /** Occurrence id to the refdes reported for it, for the CIS variant store. */
  occurrenceRefdes: Map<number, string>;
}

/**
 * Net ids are 32-bit in the file. Each placement's pins move up by a multiple
 * of this, which keeps every placement's ids apart from every other's and from
 * the root's, and leaves the two sentinel values where the builder expects them.
 */
const NET_ID_SPAN = 2 ** 32;

/** Pins with these ids carry no net of their own and are left alone. */
const NO_CONNECT = 0;
const SENTINEL = 0xffffffff;

function shiftPin(pin: T0x10, offset: number): T0x10 {
  if (offset === 0 || pin.netId === NO_CONNECT || pin.netId === SENTINEL) return pin;
  return { ...pin, netId: pin.netId + offset };
}

/** The property that names an occurrence pin's number. */
const PIN_NUMBER_PROPERTY = "Number";

/**
 * The pin numbers an occurrence assigns, by pin index, or undefined when it
 * assigns none. Pin ordinal `i` in the occurrence is pin index `i + 1` on the
 * page record.
 */
function occurrencePinNumbers(
  part: PartOccurrence,
  strLst: readonly string[]
): Map<number, string> | undefined {
  let numbers: Map<number, string> | undefined;
  for (const pin of part.pins) {
    for (const [nameIdx, valIdx] of pin.properties) {
      if (strLst[nameIdx] !== PIN_NUMBER_PROPERTY) continue;
      const value = strLst[valIdx];
      if (!value) continue;
      (numbers ??= new Map()).set(pin.ordinal + 1, value);
    }
  }
  return numbers;
}

/** The inline reference of every instance on `pages`, by dbId. */
function inlineReferences(pages: Iterable<PageData>): Map<number, string> {
  const inline = new Map<number, string>();
  for (const page of pages) {
    for (const inst of page.placedInstances) {
      if (inst.reference && !inline.has(inst.dbId)) inline.set(inst.dbId, inst.reference);
    }
  }
  return inline;
}

/**
 * The views whose occurrence trees describe the design, in the order given.
 *
 * A view that another view's tree places as a block is one of that design's
 * blocks, and its own Hierarchy stream is the stale tree of a schematic that
 * was once the root; reading it as a root would list its parts a second time.
 * A second stream for the same schematic is dropped for the same reason. A
 * root whose pages are not in the file describes nothing here.
 */
function designRoots(
  roots: HierarchyStream[],
  pagesBySchematic: ReadonlyMap<string, PageData[]>
): HierarchyStream[] {
  const placedBy = new Map<string, Set<string>>();
  for (const root of roots) {
    for (const block of walkBlockOccurrences(root.scope)) {
      const schematic = block.schematic.toLowerCase();
      if (!placedBy.has(schematic)) placedBy.set(schematic, new Set());
      placedBy.get(schematic)!.add(root.schematic.toLowerCase());
    }
  }
  const seen = new Set<string>();
  return roots.filter((root) => {
    const schematic = root.schematic.toLowerCase();
    if (seen.has(schematic) || !pagesBySchematic.has(schematic)) return false;
    const placers = placedBy.get(schematic);
    if (placers && [...placers].some((placer) => placer !== schematic)) return false;
    seen.add(schematic);
    return true;
  });
}

/**
 * Expand the views' occurrence trees over the parsed pages.
 *
 * `pagesBySchematic` is keyed by the schematic's folder name under `Views/`,
 * lowercased. Root and block schematic names are matched to it the same way.
 *
 * With a usable root, the design is what its tree reaches: a schematic the
 * tree does not place is a sheet the design no longer uses, and Capture's own
 * netlist leaves it out too. A block that names a schematic already open above
 * it is a reference to another design file whose schematic shares the name,
 * so its contents are not in this file and the block is passed over. Without
 * any usable root, every page is read as it is.
 */
export function expandHierarchy(
  roots: HierarchyStream[],
  pagesBySchematic: Map<string, PageData[]>,
  strLst: readonly string[] = []
): ExpandedDesign {
  const pages: PageData[] = [];
  const canonicalNetNames = new Set<string>();
  const usableRoots = designRoots(roots, pagesBySchematic);
  const open: string[] = [];
  let placements = 0;

  const emit = (scope: HierarchyScope, schematic: string, placement?: Placement): void => {
    const source = pagesBySchematic.get(schematic.toLowerCase());
    if (!source) return;
    open.push(schematic.toLowerCase());

    const references = new Map<number, string>();
    const pinNumbers = new Map<number, Map<number, string>>();
    for (const part of scope.parts) {
      if (references.has(part.dbId)) continue;
      if (part.reference) references.set(part.dbId, part.reference);
      const numbers = occurrencePinNumbers(part, strLst);
      if (numbers) pinNumbers.set(part.dbId, numbers);
    }

    const offset = placement?.netIdOffset ?? 0;
    const copies: { page: PageData; pageIdx: number }[] = [];
    for (const page of source) {
      const copy: PageData = {
        ...page,
        placedInstances: page.placedInstances.map((inst): PlacedInstance => {
          const copy: PlacedInstance = {
            ...inst,
            reference: references.get(inst.dbId) ?? inst.reference,
            t0x10s: inst.t0x10s.map((pin) => shiftPin(pin, offset)),
          };
          const numbers = pinNumbers.get(inst.dbId);
          if (numbers) copy.pinNumbers = numbers;
          return copy;
        }),
        drawnInstances: page.drawnInstances.map((drawn) => ({
          ...drawn,
          pins: drawn.pins.map((pin) => shiftPin(pin, offset)),
        })),
      };
      if (placement) copy.placement = placement;
      copies.push({ page: copy, pageIdx: pages.length });
      pages.push(copy);
    }

    for (const { page: copy, pageIdx } of copies) {
      for (const drawn of copy.drawnInstances) {
        const block = scope.blocks.find((b) => b.dbId === drawn.dbId);
        if (!block || open.includes(block.schematic.toLowerCase())) continue;

        const ports = new Map<string, PortBinding>();
        for (const pin of drawn.pins) {
          const name = drawn.ports[pin.pinIndex - 1];
          if (!name) continue;
          ports.set(name.toUpperCase(), {
            pageIdx,
            coord: `${pin.pointX},${pin.pointY}`,
            netId: pin.netId,
          });
        }

        // Blocks are annotated like parts: the occurrence carries the name when
        // the design was annotated by occurrence, and the drawing keeps `X?`.
        const path = [...(placement?.path ?? []), block.reference || drawn.reference];
        placements++;
        emit(block.scope, block.schematic, {
          path,
          suffix: ("_" + path.join("_")).toUpperCase(),
          netIdOffset: placements * NET_ID_SPAN,
          ports,
          canonicalNetNames: new Set(block.scope.nets.map((net) => net.name.toUpperCase())),
        });
      }
    }
    open.pop();
  };

  for (const root of usableRoots) {
    for (const net of root.scope.nets) canonicalNetNames.add(net.name.toUpperCase());
    emit(root.scope, root.schematic);
  }

  if (usableRoots.length === 0) {
    for (const source of pagesBySchematic.values()) pages.push(...source);
  }

  const inline = inlineReferences([...pagesBySchematic.values()].flat());
  return { pages, canonicalNetNames, occurrenceRefdes: buildOccurrenceRefdes(usableRoots, inline) };
}
