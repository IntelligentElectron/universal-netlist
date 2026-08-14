/**
 * Sheet-local net scoping
 *
 * A net that never leaves the sheet it is drawn on belongs to that sheet alone,
 * so the same name on two sheets describes two different pieces of copper.
 * Altium keeps those apart on the board by appending the sheet number; this is
 * where a project's sheets are read for that, and where the renaming is planned.
 */

import type { NetConnections, ComponentDetails, ParsedNetlist } from "../../types.js";
import type { NetIdentifierScope } from "./project-options.js";
import { netLabelsAreGlobal, powerPortsAreGlobal } from "./project-options.js";

/** The kinds of net identifier drawn on one net, which decide how far it reaches. */
export interface NetIdentifierKinds {
  /** A port or a sheet entry, which carries the net off the sheet under any scope. */
  portOrEntry: boolean;
  /** A power port, global except under Strict Hierarchical. */
  powerPort: boolean;
  /** A net label, which reaches other sheets only under Global. */
  label: boolean;
  /** A signal harness, whose members are matched across sheets by signal key. */
  harness: boolean;
}

export const noNetIdentifiers = (): NetIdentifierKinds => ({
  portOrEntry: false,
  powerPort: false,
  label: false,
  harness: false,
});

/**
 * Whether a net stays on the sheet it is drawn on.
 *
 * A net leaves its sheet through a port, a sheet entry or a power port, so a
 * net carrying one of those is the same net wherever else it appears and keeps
 * a single name across the project. A net carrying none of them is named only
 * by a label its designer wrote or by one of its own pins, and two sheets that
 * happen to use that name are describing two different nets.
 *
 * The scope decides which identifiers count. Under Global a net label reaches
 * every sheet, so it holds a net open too; under Strict Hierarchical even a
 * power port is local.
 */
export const isSheetBound = (kinds: NetIdentifierKinds, scope: NetIdentifierScope): boolean => {
  if (kinds.portOrEntry || kinds.harness) return false;
  if (kinds.powerPort && powerPortsAreGlobal(scope)) return false;
  if (kinds.label && netLabelsAreGlobal(scope)) return false;
  return true;
};

/** One sheet's contribution to the project, as the scoping pass needs to see it. */
export interface SheetNetScope {
  /** The sheet's `SheetNumber` document parameter, when it carries one. */
  sheetNumber?: string;
  /** Which kinds of net identifier each of this sheet's nets carries. */
  netIdentifiers: ReadonlyMap<string, NetIdentifierKinds>;
}

/**
 * Work out, for every sheet, which of its nets have to be renamed to keep them
 * apart from a same-named net on another sheet.
 *
 * Only a name genuinely claimed by two or more sheets is taken apart. One sheet
 * claiming a name is the ordinary case and keeps the bare name, which is what
 * keeps this from renaming most of a project.
 *
 * Returns one rename map per sheet, in the order the sheets were given.
 */
export const planLocalNetRenames = (
  sheets: readonly SheetNetScope[],
  scope: NetIdentifierScope
): Map<string, string>[] => {
  const sheetsClaiming = new Map<string, number>();
  for (const sheet of sheets) {
    for (const [netName, kinds] of sheet.netIdentifiers) {
      if (!isSheetBound(kinds, scope)) continue;
      sheetsClaiming.set(netName, (sheetsClaiming.get(netName) ?? 0) + 1);
    }
  }

  return sheets.map((sheet) => {
    const renames = new Map<string, string>();
    if (!sheet.sheetNumber) return renames;

    for (const [netName, kinds] of sheet.netIdentifiers) {
      if (!isSheetBound(kinds, scope)) continue;
      if ((sheetsClaiming.get(netName) ?? 0) < 2) continue;

      // A sheet may already draw a net actually called `SCL_2`. Folding the
      // renamed net into it would invent a connection that the design does not
      // make, which is the very fault this pass exists to remove, so the name
      // is left alone and the nets merge as they always have.
      const suffixed = `${netName}_${sheet.sheetNumber}`;
      if (sheet.netIdentifiers.has(suffixed)) continue;

      renames.set(netName, suffixed);
    }
    return renames;
  });
};

/** Apply a rename map to a netlist, folding pins and component pin references with it. */
export const applyNetRenames = (
  netlist: ParsedNetlist,
  renames: ReadonlyMap<string, string>
): void => {
  if (renames.size === 0) return;

  renameNets(netlist.nets, renames);
  renameComponentPinNets(netlist.components, renames);
};

const renameNets = (nets: NetConnections, renames: ReadonlyMap<string, string>): void => {
  for (const [from, to] of renames) {
    const connections = nets[from];
    if (!connections) continue;
    delete nets[from];

    const target = (nets[to] ??= {});
    for (const [refdes, pins] of Object.entries(connections)) {
      target[refdes] = [...new Set([...(target[refdes] ?? []), ...pins])];
    }
  }
};

const renameComponentPinNets = (
  components: ComponentDetails,
  renames: ReadonlyMap<string, string>
): void => {
  for (const component of Object.values(components)) {
    for (const [pinNumber, entry] of Object.entries(component.pins)) {
      if (typeof entry === "string") {
        const renamed = renames.get(entry);
        if (renamed) component.pins[pinNumber] = renamed;
      } else {
        const renamed = renames.get(entry.net);
        if (renamed) entry.net = renamed;
      }
    }
  }
};
