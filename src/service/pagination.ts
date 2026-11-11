import {
  isErrorResult,
  type ComponentNote,
  type ErrorResult,
  type NetNameWarning,
} from "../types.js";

/** The fields a paged result adds, and the notes it trims to the page. */
export interface Paged {
  notes?: string[];
  next_offset?: number;
  component_notes?: ComponentNote[];
  net_name_warnings?: NetNameWarning[];
}

/**
 * `maxResults` items from `offset`, with a note saying which entries of `field`
 * they are and the offset of the next page. A list that fits whole is returned
 * as it is.
 */
export const pageEntries = <T>(
  items: T[],
  field: string,
  maxResults: number,
  offset: number
): { items: T[]; note?: string; next_offset?: number } => {
  const total = items.length;
  if (offset === 0 && total <= maxResults) return { items };

  const page = items.slice(offset, offset + maxResults);
  const end = offset + page.length;
  const note =
    page.length === 0
      ? `offset ${offset} is past the last of ${total} ${field} entries.`
      : `${field} shows entries ${offset + 1}-${end} of ${total}.` +
        (end < total ? ` Pass offset=${end} for the next page.` : "");
  return { items: page, note, ...(end < total && { next_offset: end }) };
};

/** Page the list a result carries in `field`. */
export const pageField = <R extends Paged, K extends keyof R & string>(
  result: R | ErrorResult,
  field: K,
  maxResults: number,
  offset: number
): R | ErrorResult => {
  if (isErrorResult(result)) return result;
  const page = pageEntries(result[field] as unknown[], field, maxResults, offset);
  return withPage(result, field, page.items as R[K], page);
};

/**
 * Page items that sit in groups, counting across the groups in order. Each
 * group comes back with its items on this page; a group with none is left out.
 */
export const pageGroups = <G, T>(
  groups: (readonly [G, T[]])[],
  field: string,
  maxResults: number,
  offset: number
): { groups: [G, T[]][]; note?: string; next_offset?: number } => {
  const entries = groups.flatMap(([group, items]) => items.map((item) => [group, item] as const));
  const page = pageEntries(entries, field, maxResults, offset);
  if (page.note === undefined) return { groups: groups.map(([g, items]) => [g, items]) };
  const paged = new Map<G, T[]>();
  for (const [group, item] of page.items) paged.set(group, [...(paged.get(group) ?? []), item]);
  return { ...page, groups: [...paged] };
};

/** Page a result whose `results` group lists by design, counting across all of them. */
export const pageResults = <T, R extends Paged & { results: Record<string, T[]> }>(
  result: R | ErrorResult,
  maxResults: number,
  offset: number
): R | ErrorResult => {
  if (isErrorResult(result)) return result;
  const page = pageGroups(Object.entries(result.results), "results", maxResults, offset);
  if (page.note === undefined) return result;
  return withPage(result, "results", Object.fromEntries(page.groups) as R["results"], page);
};

/**
 * Page a query_component result's pins. A refdes several parts share pages
 * their pins together, part by part.
 */
export const pagePins = <
  R extends Paged & {
    pins?: Record<string, unknown>;
    components?: { pins: Record<string, unknown> }[];
  },
>(
  result: R | ErrorResult,
  maxResults: number,
  offset: number
): R | ErrorResult => {
  if (isErrorResult(result)) return result;
  const parts = result.components ?? [result as { pins: Record<string, unknown> }];
  const page = pageGroups(
    parts.map((part) => [part, Object.entries(part.pins)] as const),
    "pins",
    maxResults,
    offset
  );
  if (page.note === undefined) return result;
  const paged = page.groups.map(([part, pins]) => ({ ...part, pins: Object.fromEntries(pins) }));
  return result.components
    ? withPage(result, "components", paged as R["components"], page)
    : withPage(result, "pins", paged[0]?.pins ?? {}, page);
};

/** Every string in a value, at any depth. */
const stringsIn = (value: unknown, found = new Set<string>()): Set<string> => {
  if (typeof value === "string") found.add(value);
  else if (Array.isArray(value)) for (const v of value) stringsIn(v, found);
  else if (value && typeof value === "object")
    for (const v of Object.values(value)) stringsIn(v, found);
  return found;
};

/** A page, with the component notes and net name warnings cut to the parts and nets it shows. */
const withPage = <R extends Paged, K extends keyof R>(
  result: R,
  field: K,
  items: R[K],
  page: { note?: string; next_offset?: number }
): R => {
  if (page.note === undefined) return result;
  const { component_notes: _c, net_name_warnings: _w, ...rest } = result;
  const shown = stringsIn({ ...rest, [field]: items });
  const componentNotes = result.component_notes
    ?.map((n) => ({ ...n, refdes: n.refdes.filter((r) => shown.has(r)) }))
    .filter((n) => n.refdes.length > 0);
  const warnings = result.net_name_warnings?.filter((w) => shown.has(w.net));
  return {
    ...rest,
    [field]: items,
    ...(componentNotes?.length && { component_notes: componentNotes }),
    ...(warnings?.length && { net_name_warnings: warnings }),
    notes: [...(result.notes ?? []), page.note],
    ...(page.next_offset !== undefined && { next_offset: page.next_offset }),
  } as R;
};
