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
 * Work out, for every sheet, which of its nets carry the sheet's number.
 *
 * Altium suffixes a sheet-local net whether or not another sheet happens to
 * reuse the name: the MiSKo3 board carries `VBAT_8` for a `VBAT` label drawn on
 * sheet 8 alone. So the suffix follows from the net being the sheet's own, not
 * from a collision, and a name two sheets do reuse is separated as a
 * consequence rather than as a special case.
 *
 * Only a net a designer named is suffixed. A net named after one of its own
 * pins, `NetC3_1`, is already unique across the board because the refdes is,
 * and Altium leaves those alone: every board read for this carries them bare.
 *
 * Returns one rename map per sheet, in the order the sheets were given.
 */
export const planLocalNetRenames = (
  sheets: readonly SheetNetScope[],
  scope: NetIdentifierScope
): Map<string, string>[] => {
  // Every name the project already uses, on any sheet. A suffixed name that
  // collides with one of these is a name the design gave to something else.
  const namesInUse = new Set<string>();
  for (const sheet of sheets) {
    for (const netName of sheet.netIdentifiers.keys()) namesInUse.add(netName);
  }

  return sheets.map((sheet) => {
    const renames = new Map<string, string>();
    if (!sheet.sheetNumber) return renames;

    for (const [netName, kinds] of sheet.netIdentifiers) {
      if (!isSheetBound(kinds, scope)) continue;
      // A name the designer wrote, rather than one derived from a pin. A power
      // port counts: where the scope makes it local, the supply it names is
      // this sheet's own and is numbered with the rest.
      if (!kinds.label && !kinds.powerPort) continue;

      // Some sheet may already draw a net actually called `SCL_2`. Folding the
      // renamed net into it would invent a connection that the design does not
      // make, which is the very fault this pass exists to remove, so the name
      // is left alone and the nets merge as they always have. The whole project
      // is checked, not just this sheet: the nets are merged by name afterwards,
      // so a collision with any other sheet's net lands just as wrongly.
      const suffixed = `${netName}_${sheet.sheetNumber}`;
      if (namesInUse.has(suffixed)) continue;

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
