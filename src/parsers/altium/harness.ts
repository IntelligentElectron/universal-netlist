/**
 * Signal harnesses on a sheet: where connectors and entries sit, which bundle each
 * connector carries, and which signal each entry is.
 */

import { RECORD_TYPES, type RecordFields } from "./types.js";
import { field, ownerIndex, recordName } from "./records.js";
import {
  COORDINATE_SCALE,
  edgePoint,
  entryOffset,
  pointOnPolyline,
  pointsTouch,
  polylinePoints,
  portEnds,
  scaledField,
  scaledPoint,
  sheetEntryPoint,
  type Point,
} from "./coordinates.js";
import { UnionFind } from "./union-find.js";

/** A `.Harness` file: each harness type's member names. */
export type HarnessDefinitions = Map<string, string[]>;

/** Parse a `.Harness` file, one `TypeName=Member1,Member2,...` per line. */
export const parseHarnessDefinitions = (content: string): HarnessDefinitions => {
  const definitions: HarnessDefinitions = new Map();
  for (const line of content.split(/\r?\n/)) {
    const separator = line.indexOf("=");
    const typeName = line.slice(0, Math.max(separator, 0)).trim();
    if (separator <= 0 || !typeName) continue;
    const members = line
      .slice(separator + 1)
      .split(",")
      .map((member) => member.trim())
      .filter((member) => member.length > 0);
    if (members.length > 0) definitions.set(typeName, members);
  }
  return definitions;
};

/**
 * A harness type's signals, a member that is itself a harness resolved to its own
 * signals, qualified by the member (`PGND.OP_OUT`). A type reached from itself ends there.
 */
export const resolveHarnessMembers = (
  typeName: string,
  definitions: HarnessDefinitions,
  nestedTypes: ReadonlyMap<string, string> = new Map(),
  visited: ReadonlySet<string> = new Set()
): string[] => {
  const members = definitions.get(typeName);
  if (!members || visited.has(typeName)) return [];
  const seen = new Set(visited).add(typeName);
  return members.flatMap((member) => {
    const nestedType = nestedTypes.get(member);
    const nested = nestedType
      ? resolveHarnessMembers(nestedType, definitions, nestedTypes, seen)
      : [];
    return nested.length === 0 ? [member] : nested.map((signal) => `${member}.${signal}`);
  });
};

/** The harness type each harness entry name declares, which the `.Harness` file does not. */
export const collectNestedHarnessTypes = (
  records: readonly RecordFields[]
): Map<string, string> => {
  const nested = new Map<string, string>();
  for (const record of records) {
    if (record.RECORD !== RECORD_TYPES.HARNESS_ENTRY) continue;
    const name = field(record, "Name");
    const harnessType = field(record, "HarnessType");
    if (name && harnessType) nested.set(String(name), String(harnessType));
  }
  return nested;
};

/** The edge opposite each edge: 0 left, 1 right, 2 top, 3 bottom. */
const OPPOSITE_EDGE: Readonly<Record<string, string>> = { "0": "1", "1": "0", "2": "3", "3": "2" };

/** A harness connector, its entries, and the point its bundle leaves from. */
export interface HarnessConnector {
  connector: RecordFields;
  entries: RecordFields[];
  primary: Point;
}

/** Write a scaled point onto a record as `Location` and its `_Frac` fields. */
const setLocation = (record: RecordFields, [x, y]: Point): void => {
  const [baseX, baseY] = [Math.trunc(x / COORDINATE_SCALE), Math.trunc(y / COORDINATE_SCALE)];
  record["Location.X"] = String(baseX);
  record["Location.Y"] = String(baseY);
  record["Location.X_Frac"] = String(x - baseX * COORDINATE_SCALE);
  record["Location.Y_Frac"] = String(y - baseY * COORDINATE_SCALE);
};

/**
 * A sheet's harness connectors, each entry given its `Location`. An entry belongs to the
 * connector before it in the stream. `HarnessConnectorSide` names the edge the bundle
 * leaves from, at `PrimaryConnectionPosition`; entries sit on the opposite edge unless
 * their `Side` names one. A connector without coordinates is left out, entries and all.
 */
export const readHarnessConnectors = (records: RecordFields[]): HarnessConnector[] => {
  const connectors: HarnessConnector[] = [];
  let current: HarnessConnector | undefined;
  for (const record of records) {
    if (record.RECORD === RECORD_TYPES.HARNESS_CONNECTOR) {
      current = undefined;
      if (field(record, "Location.X") === undefined || field(record, "Location.Y") === undefined) {
        continue;
      }
      const leaves = String(field(record, "HarnessConnectorSide") ?? "0");
      current = {
        connector: record,
        entries: [],
        primary: edgePoint(record, leaves, scaledField(record, "PrimaryConnectionPosition")),
      };
      connectors.push(current);
    } else if (record.RECORD === RECORD_TYPES.HARNESS_ENTRY && current) {
      current.entries.push(record);
      const leaves = String(field(current.connector, "HarnessConnectorSide") ?? "0");
      const side = field(record, "Side") ?? OPPOSITE_EDGE[leaves] ?? "1";
      setLocation(record, edgePoint(current.connector, String(side), entryOffset(record)));
    }
  }
  return connectors;
};

/** Separates a bundle from a member in a signal key; no name contains it. */
const SIGNAL_SEPARATOR = "\u0000";

/** The key of member `member` of bundle `bundle`. A nested bundle's identity is such a key. */
export const harnessSignalKey = (bundle: string, member: string): string =>
  `${bundle}${SIGNAL_SEPARATOR}${member}`;

/** A signal key's bundle and member; the member follows the last separator. */
export const splitHarnessSignalKey = (key: string): { bundle: string; member: string } => {
  const separator = key.lastIndexOf(SIGNAL_SEPARATOR);
  return separator < 0
    ? { bundle: key, member: "" }
    : { bundle: key.slice(0, separator), member: key.slice(separator + 1) };
};

/** The identity of a bundle leaving its sheet through the port `name`. */
export const portBundle = (name: string): string => `port|${name}`;

/** The identity of a bundle reaching entry `name` of the sheet symbol at `symbolIndex`. */
export const entryBundle = (symbolIndex: number, name: string): string =>
  `entry|${symbolIndex}|${name}`;

const smaller = (current: string | undefined, candidate: string): string =>
  current === undefined || candidate < current ? candidate : current;

/**
 * Give every harness entry its signal key and, on a labelled harness, its net name
 * `<label>.<entry>`; return the identity groups of every bundle known by more than one.
 *
 * `records` are the sheet's `FileHeader` records, which `OwnerIndex` counts; `lines` are
 * its signal harness records.
 *
 * A connector's bundle is identified by what it reaches: harness lines joined where a
 * vertex of one touches the other, ports and sheet entries on those lines or on its
 * primary, and entries of other connectors, whose member it then is. A bundle reaching
 * none is local to its sheet.
 */
export const assignHarnessSignals = (
  connectors: HarnessConnector[],
  records: readonly RecordFields[],
  lines: readonly RecordFields[]
): string[][] => {
  const groups = new UnionFind<number>();
  const polylines = lines.map((line, offset) => ({
    node: connectors.length + offset,
    points: polylinePoints(line),
  }));
  polylines.forEach((line, i) => {
    for (const other of polylines.slice(i + 1)) {
      const meets = (a: readonly Point[], b: readonly Point[]): boolean =>
        a.some((vertex) => pointOnPolyline(vertex, b));
      if (meets(line.points, other.points) || meets(other.points, line.points)) {
        groups.union(line.node, other.node);
      }
    }
  });
  /** The line a point touches, one it meets at a vertex first. */
  const lineAt = (point: Point): number | undefined =>
    (
      polylines.find(({ points }) => points.some((vertex) => pointsTouch(point, vertex))) ??
      polylines.find(({ points }) => pointOnPolyline(point, points))
    )?.node;

  const identities = new Map<number, Set<string>>();
  const identify = (node: number, identity: string): void => {
    (identities.get(node) ?? identities.set(node, new Set()).get(node)!).add(identity);
  };
  const labels = new Map<number, string>();
  /** Port ends and sheet entries, which a connector may meet directly. */
  const ends: { point: Point; identity: string; typed: boolean }[] = [];

  for (const record of records) {
    if (record.RECORD === RECORD_TYPES.NET_LABEL) {
      const text = field(record, "Text") ?? field(record, "Name");
      const node = lineAt(scaledPoint(record));
      if (text && node !== undefined) labels.set(node, smaller(labels.get(node), String(text)));
      continue;
    }
    const name = recordName(record);
    if (!name) continue;
    const typed = Boolean(field(record, "HarnessType"));
    if (record.RECORD === RECORD_TYPES.PORT) {
      for (const point of portEnds(record)) ends.push({ point, identity: portBundle(name), typed });
    } else if (record.RECORD === RECORD_TYPES.SHEET_ENTRY) {
      const owner = ownerIndex(record);
      const symbol = owner === undefined ? undefined : records[owner];
      if (symbol?.RECORD !== RECORD_TYPES.SHEET_SYMBOL) continue;
      const point = sheetEntryPoint(symbol, record);
      ends.push({ point, identity: entryBundle(owner!, name), typed });
    }
  }
  // A port or sheet entry on a harness line carries the bundle, harness-typed or not.
  for (const { point, identity } of ends) {
    const node = lineAt(point);
    if (node !== undefined) identify(node, identity);
  }

  const attached = new Set<number>();
  connectors.forEach(({ primary }, id) => {
    const line = lineAt(primary);
    if (line !== undefined) {
      groups.union(line, id);
      attached.add(id);
    }
    for (const end of ends) {
      if (!pointsTouch(end.point, primary)) continue;
      identify(id, end.identity);
      attached.add(id);
    }
  });

  // An entry meeting a harness line, another connector's primary, or a harness-typed port
  // or sheet entry carries a nested bundle: that member of its connector's bundle.
  const nested: { node: number; parent: number; member: string }[] = [];
  connectors.forEach(({ entries }, parent) => {
    for (const entry of entries) {
      const member = recordName(entry);
      if (!member) continue;
      const point = scaledPoint(entry);
      const node = connectors.length + polylines.length + nested.length;
      let reaches = false;
      const line = lineAt(point);
      if (line !== undefined) {
        groups.union(line, node);
        reaches = true;
      }
      connectors.forEach((child, id) => {
        if (id === parent || !pointsTouch(child.primary, point)) return;
        groups.union(id, node);
        attached.add(id);
        reaches = true;
      });
      const typed = Boolean(field(entry, "HarnessType"));
      for (const end of ends) {
        if (!(end.typed || typed) || !pointsTouch(end.point, point)) continue;
        identify(node, end.identity);
        reaches = true;
      }
      if (reaches) nested.push({ node, parent, member });
    }
  });

  const identitiesByRoot = new Map<number, Set<string>>();
  for (const [node, names] of identities) {
    const root = groups.find(node);
    const merged = identitiesByRoot.get(root) ?? identitiesByRoot.set(root, new Set()).get(root)!;
    for (const name of names) merged.add(name);
  }
  const labelByRoot = new Map<number, string>();
  for (const [node, label] of labels) {
    const root = groups.find(node);
    labelByRoot.set(root, smaller(labelByRoot.get(root), label));
  }

  const bundles = new Map<number, string>();
  const bundleOf = (root: number, visiting: ReadonlySet<number>): string => {
    const known = bundles.get(root);
    if (known !== undefined) return known;
    const names = new Set(identitiesByRoot.get(root));
    const inside = new Set([...visiting, root]);
    for (const { node, parent, member } of nested) {
      const parentRoot = groups.find(parent);
      if (groups.find(node) !== root || inside.has(parentRoot)) continue;
      names.add(harnessSignalKey(bundleOf(parentRoot, inside), member));
    }
    identitiesByRoot.set(root, names);
    const bundle = names.size > 0 ? [...names].sort()[0] : `local|${root}`;
    bundles.set(root, bundle);
    return bundle;
  };

  connectors.forEach(({ entries }, id) => {
    if (!attached.has(id)) return;
    const root = groups.find(id);
    const bundle = bundleOf(root, new Set());
    const label = labelByRoot.get(root);
    for (const entry of entries) {
      const member = recordName(entry);
      if (!member) continue;
      entry.harnessSignal = harnessSignalKey(bundle, member);
      if (label !== undefined) entry.harnessNetName = `${label}.${member}`;
    }
  });
  for (const { node } of nested) bundleOf(groups.find(node), new Set());

  return [...identitiesByRoot.values()]
    .filter((names) => names.size > 1)
    .map((names) => [...names].sort());
};
