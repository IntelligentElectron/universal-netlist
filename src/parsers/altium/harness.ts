/**
 * Altium Signal Harness support.
 *
 * A signal harness bundles several signals into one drawn connection. The bundle's
 * membership is not stored in the `.SchDoc` at all: each document has a sibling
 * `<name>.Harness` text file listing one type per line.
 *
 * See docs/altium-format.md for the record layout.
 */

import {
  COORDINATE_SCALE,
  edgePoint,
  entryOffset,
  field,
  pointOnSegment,
  pointsTouch,
  polylinePoints,
  portEnds,
  scaledField,
  scaledPoint,
  sheetEntryPoint,
  type Point,
} from "./coordinates.js";
import { UnionFind } from "./union-find.js";

/** Harness type name -> the member names it bundles, as written in the file. */
export type HarnessDefinitions = Map<string, string[]>;

/**
 * Parse a `.Harness` sidecar file.
 *
 * Format is one type per line, `TypeName=Member1,Member2,...`:
 *
 *   AGND_Domain=PULSE_OUT,PULSE_IN,AGND,VDD5,STDN,TEMPOUT
 *   Channel_interface=PGND,V_LASER_P,3V3_P,AGND,VDD5_A
 *
 * A member may itself name another harness type; see resolveHarnessMembers.
 */
export const parseHarnessDefinitions = (content: string): HarnessDefinitions => {
  const definitions: HarnessDefinitions = new Map();

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;

    const typeName = trimmed.slice(0, separator).trim();
    if (!typeName) continue;

    const members = trimmed
      .slice(separator + 1)
      .split(",")
      .map((member) => member.trim())
      .filter((member) => member.length > 0);

    if (members.length > 0) definitions.set(typeName, members);
  }

  return definitions;
};

/**
 * Which harness type a member name expands to, when that member is itself a
 * bundle rather than a single signal.
 *
 * This mapping does NOT come from the `.Harness` file, which lists member names
 * only. It is declared on the harness entry record:
 *
 *   RECORD=216 | Name=PGND | HarnessType=PGND_Domain
 *
 * so building it requires the `Additional` stream records, not just the sidecar.
 */
export type NestedHarnessTypes = ReadonlyMap<string, string>;

/**
 * Resolve a harness type to the flat set of signals it carries.
 *
 * Harness types nest: an entry of one type may itself be a harness. Where a
 * `PGND` entry of an interface bundle carries `HarnessType=PGND_Domain`, the
 * bundle also carries `PGND_Domain`'s members. Flattening one level drops them
 * silently.
 *
 * Nested members are qualified with the entry that reached them (`PGND.OP_OUT`),
 * so a signal name appearing in two branches stays distinct.
 *
 * A type reachable from itself stops at the repeat rather than recursing forever.
 */
export const resolveHarnessMembers = (
  typeName: string,
  definitions: HarnessDefinitions,
  nestedTypes: NestedHarnessTypes = new Map(),
  visited: ReadonlySet<string> = new Set()
): string[] => {
  const members = definitions.get(typeName);
  if (!members || visited.has(typeName)) return [];

  const seen = new Set(visited).add(typeName);
  const resolved: string[] = [];

  for (const member of members) {
    const nestedType = nestedTypes.get(member);
    const nested = nestedType
      ? resolveHarnessMembers(nestedType, definitions, nestedTypes, seen)
      : [];

    if (nested.length === 0) {
      resolved.push(member);
      continue;
    }

    for (const nestedMember of nested) {
      resolved.push(`${member}.${nestedMember}`);
    }
  }

  return resolved;
};

/**
 * Build the member-to-nested-type map from harness entry records.
 *
 * Pass the records of a parsed schematic (which must include the `Additional`
 * stream, or there will be no harness entries in it at all).
 */
export const collectNestedHarnessTypes = (
  records: readonly Readonly<Record<string, unknown>>[]
): Map<string, string> => {
  const nested = new Map<string, string>();
  for (const record of records) {
    if (record.RECORD !== "216") continue;
    const name = field(record, "Name");
    const harnessType = field(record, "HarnessType");
    if (name && harnessType) nested.set(String(name), String(harnessType));
  }
  return nested;
};

/** The name an identifier is written with, `Name` or else `Text`. */
const recordName = (record: HarnessRecord): string | undefined => {
  const name = field(record, "Name") ?? field(record, "Text");
  return name === undefined || name === null || name === "" ? undefined : String(name);
};

/**
 * The edge opposite each edge. A connector's `HarnessConnectorSide` names the edge
 * its bundle leaves from (0 left, 1 right, 2 top, 3 bottom), and its entries sit on
 * the opposite edge unless an entry's own `Side` says otherwise.
 */
const OPPOSITE_EDGE: Readonly<Record<string, string>> = { "0": "1", "1": "0", "2": "3", "3": "2" };

export interface HarnessRecord {
  RECORD?: string;
  Name?: string;
  Text?: string;
  HarnessType?: string;
  DistanceFromTop?: string;
  DistanceFromTop_Frac1?: string;
  PrimaryConnectionPosition?: string;
  "Location.X"?: string;
  "Location.Y"?: string;
  "Location.X_Frac"?: string;
  "Location.Y_Frac"?: string;
  Width?: string;
  XSize?: string;
  YSize?: string;
  Side?: string;
  HarnessConnectorSide?: string;
  LocationCount?: string;
  /** Which signal of which bundle this entry carries; see assignHarnessSignals. */
  harnessSignal?: string;
  /** The name Altium gives this entry's net when the harness line itself is labelled. */
  harnessNetName?: string;
  [key: string]: unknown;
}

/** One harness connector together with the entries drawn on its edge. */
export interface HarnessConnector {
  /** The RECORD=215 connector itself. */
  connector: HarnessRecord;
  /** Its RECORD=216 entries, in stream order. */
  entries: HarnessRecord[];
  /** Where the bundle leaves the connector, meeting a harness or a port. */
  primary: Point;
}

/** Write a scaled coordinate back onto a record as Altium's base/fraction pair. */
const setScaledLocation = (record: HarnessRecord, x: number, y: number): void => {
  const baseX = Math.trunc(x / COORDINATE_SCALE);
  const baseY = Math.trunc(y / COORDINATE_SCALE);
  record["Location.X"] = String(baseX);
  record["Location.Y"] = String(baseY);
  record["Location.X_Frac"] = String(x - baseX * COORDINATE_SCALE);
  record["Location.Y_Frac"] = String(y - baseY * COORDINATE_SCALE);
};

/**
 * Read the harness connectors of a sheet, giving every entry the coordinate at
 * which wires meet it.
 *
 * Entries carry only a distance along the connector's edge and inherit the rest
 * of their position from the connector that owns them. `OwnerIndex` is
 * present on some entries and absent on others, so ownership is taken from
 * stream order: entries follow their connector.
 *
 * A connector that carries no coordinates is passed over altogether, entries and
 * all. Read as written it would sit at the origin, where its outgoing connection
 * could be taken for any harness line or port that happens to reach that point,
 * and a bundle identity drawn from there travels across the whole project.
 */
export const readHarnessConnectors = (records: HarnessRecord[]): HarnessConnector[] => {
  const connectors: HarnessConnector[] = [];
  let current: HarnessConnector | undefined;

  for (const record of records) {
    if (record.RECORD === "215") {
      current = undefined;
      if (field(record, "Location.X") === undefined || field(record, "Location.Y") === undefined) {
        continue;
      }

      current = {
        connector: record,
        entries: [],
        primary: edgePoint(
          record,
          String(field(record, "HarnessConnectorSide") ?? "0"),
          scaledField(record, "PrimaryConnectionPosition")
        ),
      };
      connectors.push(current);
      continue;
    }

    if (record.RECORD !== "216" || !current) continue;
    current.entries.push(record);

    const leaves = String(field(current.connector, "HarnessConnectorSide") ?? "0");
    const side = field(record, "Side") ?? OPPOSITE_EDGE[leaves] ?? "1";
    setScaledLocation(record, ...edgePoint(current.connector, String(side), entryOffset(record)));
  }

  return connectors;
};

/** Separates a bundle name from a member name; neither can contain it. */
const SIGNAL_SEPARATOR = "\u0000";

/** Build the signal key a harness member is known by. */
export const harnessSignalKey = (bundle: string, member: string): string =>
  `${bundle}${SIGNAL_SEPARATOR}${member}`;

/**
 * Split a signal key back into the bundle and member it was built from. A nested
 * bundle is itself a signal key, so the member follows the last separator.
 */
export const splitHarnessSignalKey = (key: string): { bundle: string; member: string } => {
  const separator = key.lastIndexOf(SIGNAL_SEPARATOR);
  if (separator < 0) return { bundle: key, member: "" };
  return { bundle: key.slice(0, separator), member: key.slice(separator + 1) };
};

/**
 * Pick the smaller of two candidate names, so a bundle reached from several
 * places settles on one regardless of the order the records were read in.
 */
const preferredName = (current: string | undefined, candidate: string): string =>
  current === undefined || candidate < current ? candidate : current;

/** The identity of a bundle that leaves its sheet through the harness port `name`. */
export const portBundle = (name: string): string => `port|${name}`;

/**
 * The identity of a bundle that reaches the harness entry `name` of the sheet symbol
 * at `symbolIndex`, the record's position among the sheet's `FileHeader` records.
 */
export const entryBundle = (symbolIndex: number, name: string): string =>
  `entry|${symbolIndex}|${name}`;

/** Everything a sheet draws that a bundle can be identified or named by. */
export interface HarnessSheetObjects {
  /**
   * The `FileHeader` records in stream order. A sheet entry inherits its position
   * from the sheet symbol it follows.
   */
  records: readonly HarnessRecord[];
  /** RECORD=218 signal harness lines, from the `Additional` stream. */
  buses: readonly HarnessRecord[];
}

/**
 * Say which signal every harness entry carries, and what Altium calls its net.
 *
 * A harness connector hands its bundle off at its primary connection point, which
 * meets a signal harness line, a harness-typed port or an entry of another
 * connector. Connectors reaching one line or one port carry one bundle, so their
 * entries of one name are one signal, whatever the wires either side are labelled.
 *
 * A bundle is identified by the ports and sheet entries it reaches (portBundle,
 * entryBundle), which the project resolves across sheets, and by the connector
 * entries it leaves from (the parent bundle's signal key); a bundle reaching none
 * is local to its sheet. A net label on the harness line names the nets it carries
 * `<label>.<entry name>`.
 *
 * Returns the identities of every bundle known by more than one.
 */
export const assignHarnessSignals = (
  connectors: HarnessConnector[],
  sheet: HarnessSheetObjects
): string[][] => {
  // Each line is a node of its own, so a harness drawn as several joined lines is
  // still one bundle.
  const groups = new UnionFind<number>();
  const lines = sheet.buses.map((bus, offset) => ({
    node: connectors.length + offset,
    points: polylinePoints(bus),
  }));
  const onSegments = (point: Point, points: readonly Point[]): boolean =>
    points.some((vertex, i) => i > 0 && pointOnSegment(point, [points[i - 1], vertex]));
  // Lines join where a vertex of one touches the other anywhere.
  lines.forEach((line, i) => {
    for (const other of lines.slice(i + 1)) {
      const meets = (a: readonly Point[], b: readonly Point[]): boolean =>
        a.some((vertex) => b.some((point) => pointsTouch(vertex, point)) || onSegments(vertex, b));
      if (meets(line.points, other.points) || meets(other.points, line.points)) {
        groups.union(line.node, other.node);
      }
    }
  });

  /** The harness line a point touches, at a vertex or along a segment. */
  const lineAt = (point: Point): number | undefined =>
    (
      lines.find(({ points }) => points.some((vertex) => pointsTouch(point, vertex))) ??
      lines.find(({ points }) => onSegments(point, points))
    )?.node;

  const identitiesByNode = new Map<number, Set<string>>();
  const identify = (node: number, identity: string): void => {
    const identities = identitiesByNode.get(node) ?? new Set<string>();
    identities.add(identity);
    identitiesByNode.set(node, identities);
  };
  const labelByNode = new Map<number, string>();
  /** Port ends and sheet entries, which a connector may meet without a harness line. */
  const ends: { point: Point; identity: string; typed: boolean }[] = [];

  let symbol: { record: HarnessRecord; index: number } | undefined;
  for (const [index, record] of sheet.records.entries()) {
    if (record.RECORD === "15") {
      symbol = { record, index };
      continue;
    }

    if (record.RECORD === "25") {
      const text = field(record, "Text") ?? field(record, "Name");
      const node = lineAt(scaledPoint(record));
      if (text && node !== undefined) {
        labelByNode.set(node, preferredName(labelByNode.get(node), String(text)));
      }
      continue;
    }

    // A port or sheet entry on a harness line carries the bundle, `HarnessType` or not.
    const name = recordName(record);
    if (!name) continue;

    const typed = field(record, "HarnessType") !== undefined;
    if (record.RECORD === "18") {
      for (const point of portEnds(record)) ends.push({ point, identity: portBundle(name), typed });
    } else if (record.RECORD === "16" && symbol) {
      const point = sheetEntryPoint(symbol.record, record);
      ends.push({ point, identity: entryBundle(symbol.index, name), typed });
    }
  }
  for (const { point, identity } of ends) {
    const node = lineAt(point);
    if (node !== undefined) identify(node, identity);
  }

  const attached = new Set<number>();
  connectors.forEach((connector, id) => {
    const line = lineAt(connector.primary);
    if (line !== undefined) {
      groups.union(line, id);
      attached.add(id);
    }
    for (const end of ends) {
      if (!pointsTouch(end.point, connector.primary)) continue;
      identify(id, end.identity);
      attached.add(id);
    }
  });

  // An entry meeting a harness line, another connector's primary, or a harness-typed
  // port or sheet entry carries a nested bundle: that member of its own connector's
  // bundle. An entry meeting a plain port is a single signal.
  const nested: { node: number; parent: number; member: string }[] = [];
  connectors.forEach((connector, parent) => {
    for (const entry of connector.entries) {
      const member = recordName(entry);
      if (!member) continue;
      const point = scaledPoint(entry);
      const node = connectors.length + lines.length + nested.length;
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
      const typed = field(entry, "HarnessType") !== undefined;
      for (const end of ends) {
        if (!(end.typed || typed) || !pointsTouch(end.point, point)) continue;
        identify(node, end.identity);
        reaches = true;
      }
      if (reaches) nested.push({ node, parent, member });
    }
  });

  const identitiesByRoot = new Map<number, Set<string>>();
  for (const [node, identities] of identitiesByNode) {
    const root = groups.find(node);
    const merged = identitiesByRoot.get(root) ?? new Set<string>();
    for (const identity of identities) merged.add(identity);
    identitiesByRoot.set(root, merged);
  }
  const labelByRoot = new Map<number, string>();
  for (const [node, label] of labelByNode) {
    const root = groups.find(node);
    labelByRoot.set(root, preferredName(labelByRoot.get(root), label));
  }

  const bundles = new Map<number, string>();
  const bundleOf = (root: number, visiting: ReadonlySet<number>): string => {
    const known = bundles.get(root);
    if (known !== undefined) return known;
    const identities = new Set(identitiesByRoot.get(root));
    const inside = new Set([...visiting, root]);
    for (const { node, parent, member } of nested) {
      const parentRoot = groups.find(parent);
      if (groups.find(node) !== root || inside.has(parentRoot)) continue;
      identities.add(harnessSignalKey(bundleOf(parentRoot, inside), member));
    }
    identitiesByRoot.set(root, identities);
    const bundle = identities.size > 0 ? [...identities].sort()[0] : `local|${root}`;
    bundles.set(root, bundle);
    return bundle;
  };

  connectors.forEach((connector, id) => {
    if (!attached.has(id)) return;
    const root = groups.find(id);
    const bundle = bundleOf(root, new Set());
    const harnessLabel = labelByRoot.get(root);

    for (const entry of connector.entries) {
      const member = recordName(entry);
      if (!member) continue;
      entry.harnessSignal = harnessSignalKey(bundle, member);
      if (harnessLabel !== undefined) entry.harnessNetName = `${harnessLabel}.${member}`;
    }
  });
  for (const { node } of nested) bundleOf(groups.find(node), new Set());

  return [...identitiesByRoot.values()]
    .filter((identities) => identities.size > 1)
    .map((identities) => [...identities].sort());
};
