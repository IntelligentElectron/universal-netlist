/**
 * `AppendSheetNumberToLocalNets`: a net a sheet names and keeps to itself carries the
 * sheet's `SheetNumber`, so same-named local nets on two sheets stay apart.
 */

import {
  netLabelsAreGlobal,
  powerPortsAreGlobal,
  type NetIdentifierScope,
} from "./project-options.js";

/** The identifier kinds on one net. */
export interface NetIdentifierKinds {
  port: boolean;
  /** A sheet entry leads into a child sheet; the net stays its sheet's own. */
  entry: boolean;
  powerPort: boolean;
  label: boolean;
  /** A harness member, matched across sheets by signal. */
  harness: boolean;
}

export const noNetIdentifiers = (): NetIdentifierKinds => ({
  port: false,
  entry: false,
  powerPort: false,
  label: false,
  harness: false,
});

/**
 * Whether a net stays on its sheet: no port or harness carries it off, nor a power port
 * or net label the scope makes global.
 */
export const isSheetBound = (kinds: NetIdentifierKinds, scope: NetIdentifierScope): boolean =>
  !kinds.port &&
  !kinds.harness &&
  !(kinds.powerPort && powerPortsAreGlobal(scope)) &&
  !(kinds.label && netLabelsAreGlobal(scope));

/** One sheet, as sheet numbering reads it. */
export interface SheetNetScope {
  sheetNumber?: string;
  netIdentifiers: ReadonlyMap<string, NetIdentifierKinds>;
}

/**
 * Each sheet's renames to `<name>_<SheetNumber>`, in the order the sheets are given.
 *
 * A sheet-bound net named by a label, or by a power port the scope makes local, takes
 * its sheet's number whether or not another sheet uses the name; a pin name stays bare.
 * Where only one sheet claims a name, the number follows that net onto sheets carrying
 * it onward through a port or harness. A harness member `<label>.<entry>` takes the
 * number of the one sheet labelling its bundle. No rename takes a name already in use.
 */
export const planLocalNetRenames = (
  sheets: readonly SheetNetScope[],
  scope: NetIdentifierScope
): Map<string, string>[] => {
  const namesInUse = new Set(sheets.flatMap((sheet) => [...sheet.netIdentifiers.keys()]));
  const numbered = (name: string, number: string): string => `${name}_${number}`;
  const renames = sheets.map(() => new Map<string, string>());

  const claims = new Map<string, { sheet: number; number: string }[]>();
  sheets.forEach((sheet, index) => {
    if (!sheet.sheetNumber) return;
    for (const [name, kinds] of sheet.netIdentifiers) {
      if (!isSheetBound(kinds, scope) || (!kinds.label && !kinds.powerPort)) continue;
      if (namesInUse.has(numbered(name, sheet.sheetNumber))) continue;
      (claims.get(name) ?? claims.set(name, []).get(name)!).push({
        sheet: index,
        number: sheet.sheetNumber,
      });
    }
  });

  // The numbered sheets that label each name, under any scope but Global.
  const labelledOn = new Map<string, Set<string>>();
  for (const sheet of netLabelsAreGlobal(scope) ? [] : sheets) {
    if (!sheet.sheetNumber) continue;
    for (const [name, kinds] of sheet.netIdentifiers) {
      if (!kinds.label) continue;
      (labelledOn.get(name) ?? labelledOn.set(name, new Set()).get(name)!).add(sheet.sheetNumber);
    }
  }

  const memberNumbers = new Map<string, string>();
  for (const sheet of sheets) {
    for (const [name, kinds] of sheet.netIdentifiers) {
      const dot = name.indexOf(".");
      const on = kinds.harness && dot > 0 ? labelledOn.get(name.slice(0, dot)) : undefined;
      if (on?.size === 1) memberNumbers.set(name, [...on][0]);
    }
  }

  for (const [name, claimants] of claims) {
    if (claimants.length > 1) {
      for (const { sheet, number } of claimants) renames[sheet].set(name, numbered(name, number));
      continue;
    }
    const [{ sheet: claimant, number }] = claimants;
    sheets.forEach((sheet, index) => {
      const kinds = sheet.netIdentifiers.get(name);
      if (index !== claimant && (!kinds || isSheetBound(kinds, scope))) return;
      renames[index].set(name, numbered(name, number));
    });
  }

  // Applied last, so a member's two ends still merge under one name.
  for (const [name, number] of memberNumbers) {
    if (namesInUse.has(numbered(name, number))) continue;
    sheets.forEach((sheet, index) => {
      if (sheet.netIdentifiers.has(name)) renames[index].set(name, numbered(name, number));
    });
  }

  return renames;
};
