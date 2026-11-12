/**
 * Duplicate reference designators, as the tools report them.
 *
 * A parser that finds one refdes on several different parts keys each part as
 * `<refdes>~<n>`, which no EDA tool accepts as a reference, so the key cannot
 * collide with a real one. The key only keeps the parts' pins apart: results
 * show the schematic's refdes and DUPLICATE_REFDES_ERROR on each part.
 *
 * One part that draws the same section more than once, with copies that do
 * not wire a pin to two different nets, stays one part: it carries a
 * RepeatedSection instead, and its record says so in `error`.
 */

import type { ParsedNetlist } from "./types.js";
import { naturalSort } from "./circuit-traversal.js";

export const DUPLICATE_REFDES_ERROR = "Reference designator is duplicated";

/** One part of a duplicated refdes: its internal key, and the pages it is drawn on. */
export interface DuplicatePart {
  key: string;
  /** Page names, each with its block placement when the page is reused by several. */
  pages: string[];
}

/** A section one part draws more than once, and the page of each placement. */
export interface RepeatedSection {
  /** The section letter, omitted for a part with a single section. */
  section?: string;
  pages: string[];
}

const SUFFIX = /~\d+$/;

export const duplicateKey = (refdes: string, n: number): string => `${refdes}~${n}`;

/** Whether a component key is one part of a duplicated refdes. */
export const isDuplicateKey = (key: string): boolean => SUFFIX.test(key);

/** The refdes the schematic gives a component key. */
export const displayRefdes = (key: string): string => key.replace(SUFFIX, "");

/** What run_erc reports for one duplicated refdes. */
export interface DuplicateRefdesFinding {
  part_count: number;
  pages: string[];
}

export const duplicateFinding = (parts: DuplicatePart[]): DuplicateRefdesFinding => ({
  part_count: parts.length,
  pages: [...new Set(parts.flatMap((part) => part.pages))].sort(naturalSort),
});

const times = (n: number): string => (n === 2 ? "twice" : `${n} times`);

/** "Section F is placed twice (pages 15_POWER, 18_DISPLAY)" */
export const describeRepeatedSection = (repeat: RepeatedSection): string =>
  `${repeat.section ? `Section ${repeat.section} is placed` : "Placed"} ${times(repeat.pages.length)} (pages ${repeat.pages.join(", ")})`;

/** Every duplicated refdes and repeated section in a netlist, described for an error message. */
export const describeDuplicates = (netlist: ParsedNetlist): string =>
  [
    ...Object.entries(netlist.duplicateRefdes ?? {}).map(([refdes, parts]) => {
      const { part_count, pages } = duplicateFinding(parts);
      return `${refdes} is used by ${part_count} different parts, on pages ${pages.join(", ")}`;
    }),
    ...Object.entries(netlist.repeatedSections ?? {}).flatMap(([refdes, repeats]) =>
      repeats.map((repeat) => `${refdes}: ${describeRepeatedSection(repeat)}`)
    ),
  ].join("; ");

/**
 * The error a component's record carries: DUPLICATE_REFDES_ERROR for a part
 * that shares its refdes with another, and what it draws more than once.
 */
export const componentError = (netlist: ParsedNetlist, key: string): string | undefined => {
  const errors = [
    ...(isDuplicateKey(key) ? [DUPLICATE_REFDES_ERROR] : []),
    ...(netlist.repeatedSections?.[key] ?? []).map(describeRepeatedSection),
  ];
  return errors.length > 0 ? errors.join("; ") : undefined;
};

/** The default for callers without a netlist: only a duplicated refdes is known. */
export const keyError = (key: string): string | undefined =>
  isDuplicateKey(key) ? DUPLICATE_REFDES_ERROR : undefined;
