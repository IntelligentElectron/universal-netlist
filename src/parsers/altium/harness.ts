/**
 * Altium Signal Harness support.
 *
 * A signal harness bundles several signals into one drawn connection. The bundle's
 * membership is not stored in the `.SchDoc` at all: each document has a sibling
 * `<name>.Harness` text file listing one type per line.
 *
 * See docs/altium-format.md for the record layout.
 */

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
 * Harness types nest: an entry of one type may itself be a harness. In HELIOS-R
 * the `PGND` entry of `Channel_interface` carries `HarnessType=PGND_Domain`, so
 * the bundle also carries `PGND_Domain`'s members. Flattening one level drops
 * them silently.
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
  records: readonly { RECORD?: string; Name?: string; HarnessType?: string }[]
): Map<string, string> => {
  const nested = new Map<string, string>();
  for (const record of records) {
    if (record.RECORD !== "216") continue;
    const name = record.Name;
    const harnessType = record.HarnessType;
    if (name && harnessType) nested.set(name, harnessType);
  }
  return nested;
};

/**
 * Grid units per `DistanceFromTop` step on a harness connector.
 *
 * Derived from pulp-bio/HELIOS-R: its connector sits at Location.Y=670 with
 * entries at DistanceFromTop 1, 2, 9, 10 and 13, and the five wires that land on
 * it end at y = 660, 650, 580, 570 and 540 — exactly Location.Y - n * 10.
 */
const HARNESS_ENTRY_PITCH = 10;

/**
 * Denominator of `DistanceFromTop_Frac1`.
 *
 * An entry may sit half a step down: HELIOS-R's `channel.SchDoc` writes
 * `DistanceFromTop=1 | DistanceFromTop_Frac1=500000` for an entry whose wire
 * ends 15 grid units below the connector's top, so 500000 is half a step.
 */
const DISTANCE_FRACTION_SCALE = 1_000_000;

/** Units per whole coordinate, matching the `_Frac` fields on Location records. */
const COORDINATE_SCALE = 10000;

/**
 * Value of `Side` on an entry, and of `HarnessConnectorSide` on a connector.
 *
 * The two fields describe the same arrangement from opposite ends and are never
 * both written: an entry marked `Side=1` sits on the connector's right edge,
 * while a connector marked `HarnessConnectorSide=1` puts its entries on the left
 * edge and the bundle's outgoing connection on the right.
 */
const SIDE_FLAG = "1";

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
  Side?: string;
  HarnessConnectorSide?: string;
  LocationCount?: string;
  /** Which signal of which bundle this entry carries; see assignHarnessSignals. */
  harnessSignal?: string;
  /** The name Altium gives this entry's net when the harness line itself is labelled. */
  harnessNetName?: string;
  [key: string]: unknown;
}

/** A point in the same scaled units the net extractor works in. */
type Point = readonly [number, number];

/** One harness connector together with the entries drawn on its edge. */
export interface HarnessConnector {
  /** The RECORD=215 connector itself. */
  connector: HarnessRecord;
  /** Its RECORD=216 entries, in stream order. */
  entries: HarnessRecord[];
  /** Where the bundle leaves the connector, meeting a harness or a port. */
  primary: Point;
}

const toNumber = (value: unknown): number => {
  if (value === undefined || value === null || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const scaled = (base: unknown, frac: unknown): number =>
  Math.round(toNumber(base) * COORDINATE_SCALE + toNumber(frac));

const pointKey = (point: Point): string => `${point[0]},${point[1]}`;

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
 * How far below the connector's top edge an entry sits, in whole grid steps.
 *
 * The step count is a fixed-point value: `DistanceFromTop` counts whole steps and
 * `DistanceFromTop_Frac1` the fraction of one. Both are absent for an entry on
 * the top edge itself.
 */
const entryDistanceFromTop = (entry: HarnessRecord): number =>
  toNumber(entry.DistanceFromTop) +
  toNumber(entry.DistanceFromTop_Frac1) / DISTANCE_FRACTION_SCALE;

/**
 * Whether a connector's entries are drawn on its right edge rather than its left.
 *
 * The entry's own `Side` is authoritative where it is written; otherwise the
 * connector's `HarnessConnectorSide` says it, inverted, because that field names
 * the side the bundle leaves from. Verified on 364 of the 365 entries across
 * pulp-bio/HELIOS-R and qfsae/pcb: each lands exactly on a wire end.
 */
const entriesOnRightEdge = (connector: HarnessRecord, entry: HarnessRecord): boolean =>
  entry.Side === SIDE_FLAG || connector.HarnessConnectorSide !== SIDE_FLAG;

/**
 * Read the harness connectors of a sheet, giving every entry the coordinate at
 * which wires meet it.
 *
 * Entries carry only a distance below the connector's top edge and inherit the
 * rest of their position from the connector that owns them. `OwnerIndex` is
 * present on some entries and absent on others, so ownership is taken from
 * stream order: entries follow their connector.
 *
 * An entry whose connector has no coordinates is left unpositioned, and the net
 * extractor skips it, rather than being placed at the origin where every other
 * such entry would appear to touch it.
 */
export const readHarnessConnectors = (records: HarnessRecord[]): HarnessConnector[] => {
  const connectors: HarnessConnector[] = [];
  let current: HarnessConnector | undefined;

  for (const record of records) {
    if (record.RECORD === "215") {
      const originX = scaled(record["Location.X"], record["Location.X_Frac"]);
      const originY = scaled(record["Location.Y"], record["Location.Y_Frac"]);
      const width = scaled(record.XSize, undefined);
      // The bundle leaves from the edge opposite the entries, at the height
      // `PrimaryConnectionPosition` gives below the connector's top.
      const leavesRight = record.HarnessConnectorSide === SIDE_FLAG;
      current = {
        connector: record,
        entries: [],
        primary: [
          leavesRight ? originX + width : originX,
          originY - scaled(record.PrimaryConnectionPosition, undefined),
        ],
      };
      connectors.push(current);
      continue;
    }

    if (record.RECORD !== "216" || !current) continue;
    current.entries.push(record);

    const connector = current.connector;
    const originX = scaled(connector["Location.X"], connector["Location.X_Frac"]);
    const originY = scaled(connector["Location.Y"], connector["Location.Y_Frac"]);
    if (connector["Location.X"] === undefined || connector["Location.Y"] === undefined) continue;

    const width = entriesOnRightEdge(connector, record) ? scaled(connector.XSize, undefined) : 0;
    setScaledLocation(
      record,
      originX + width,
      originY - entryDistanceFromTop(record) * HARNESS_ENTRY_PITCH * COORDINATE_SCALE
    );
  }

  return connectors;
};

/**
 * Whether a point lies on the segment between two others.
 *
 * Harness lines are drawn on the grid, so the test is exact rather than
 * tolerant: a point is on the segment when it is collinear with the ends and
 * between them.
 */
const pointOnSegment = (point: Point, start: Point, end: Point): boolean => {
  const cross =
    (end[0] - start[0]) * (point[1] - start[1]) - (end[1] - start[1]) * (point[0] - start[0]);
  if (cross !== 0) return false;
  return (
    point[0] >= Math.min(start[0], end[0]) &&
    point[0] <= Math.max(start[0], end[0]) &&
    point[1] >= Math.min(start[1], end[1]) &&
    point[1] <= Math.max(start[1], end[1])
  );
};

/** The vertices of a polyline record, in scaled units. */
const polylinePoints = (record: HarnessRecord): Point[] => {
  const points: Point[] = [];
  const count = toNumber(record.LocationCount);
  for (let i = 1; i <= count; i++) {
    points.push([
      scaled(record[`X${i}`], record[`X${i}_Frac`]),
      scaled(record[`Y${i}`], record[`Y${i}_Frac`]),
    ]);
  }
  return points;
};

/** A record's own position, in scaled units. */
const recordLocation = (record: HarnessRecord): Point => [
  scaled(record["Location.X"], record["Location.X_Frac"]),
  scaled(record["Location.Y"], record["Location.Y_Frac"]),
];

/**
 * The two ends of a port, in scaled units.
 *
 * A port is drawn as a horizontal box `Width` wide, and whichever end faces the
 * harness connector is the end the bundle meets, so both count.
 */
const portEnds = (port: HarnessRecord): Point[] => {
  const [x, y] = recordLocation(port);
  return [
    [x, y],
    [x + scaled(port.Width, undefined), y],
  ];
};

/**
 * Where a sheet entry meets a harness line on the parent sheet.
 *
 * A sheet entry is placed the way a harness entry is: it inherits its position
 * from the sheet symbol it belongs to, sits `DistanceFromTop` grid steps below
 * that symbol's top edge, and takes the left edge unless `Side` puts it on the
 * right. Verified against all 44 harness-typed sheet entries in qfsae/pcb and
 * pulp-bio/HELIOS-R, each of which lands exactly on a harness line vertex.
 */
const sheetEntryLocation = (symbol: HarnessRecord, entry: HarnessRecord): Point => {
  const [originX, originY] = recordLocation(symbol);
  const width = entry.Side === SIDE_FLAG ? scaled(symbol.XSize, undefined) : 0;
  return [
    originX + width,
    originY - entryDistanceFromTop(entry) * HARNESS_ENTRY_PITCH * COORDINATE_SCALE,
  ];
};

/** Separates a bundle name from a member name; neither can contain it. */
const SIGNAL_SEPARATOR = "\u0000";

/** Build the signal key a harness member is known by. */
export const harnessSignalKey = (bundle: string, member: string): string =>
  `${bundle}${SIGNAL_SEPARATOR}${member}`;

/** Split a signal key back into the bundle and member it was built from. */
export const splitHarnessSignalKey = (key: string): { bundle: string; member: string } => {
  const separator = key.indexOf(SIGNAL_SEPARATOR);
  if (separator < 0) return { bundle: key, member: "" };
  return { bundle: key.slice(0, separator), member: key.slice(separator + 1) };
};

class BundleGroups {
  private parent = new Map<number, number>();

  find(x: number): number {
    if (!this.parent.has(x)) this.parent.set(x, x);
    const seen = this.parent.get(x)!;
    if (seen !== x) this.parent.set(x, this.find(seen));
    return this.parent.get(x)!;
  }

  union(x: number, y: number): void {
    const rootX = this.find(x);
    const rootY = this.find(y);
    if (rootX !== rootY) this.parent.set(rootY, rootX);
  }
}

/**
 * Pick the smaller of two candidate names, so a bundle reached from several
 * places settles on one regardless of the order the records were read in.
 */
const preferredName = (current: string | undefined, candidate: string): string =>
  current === undefined || candidate < current ? candidate : current;

/**
 * Everything a sheet draws that a bundle can be identified or named by.
 */
export interface HarnessSheetObjects {
  /**
   * The `FileHeader` records in stream order.
   *
   * Ports, net labels, sheet symbols and their entries are read from here.
   * Order matters: a sheet entry inherits its position from the sheet symbol it
   * follows, exactly as a harness entry does from its connector.
   */
  records: readonly HarnessRecord[];
  /** RECORD=218 signal harness lines, from the `Additional` stream. */
  buses: readonly HarnessRecord[];
  /** Identifies bundles that never leave this sheet. */
  sheetKey: string;
}

/**
 * Say which signal every harness entry carries, and what Altium calls its net.
 *
 * A harness connector bundles its entries and hands the bundle off from its
 * primary connection point, which meets either a signal harness polyline
 * (RECORD=218) or a harness-typed port (RECORD=18 with a `HarnessType`).
 * Connectors reaching the same polyline, or the same port, carry the same
 * bundle, so their entries of a given name are one signal — which is what lets
 * a net be traced through a harness whatever the wires either side are
 * labelled, the harness elements being, in Altium's words, "names of the
 * containers that carry the nets, not the names of the nets themselves".
 *
 * A bundle is identified by the port it reaches, because a port name is global:
 * the sheet on the other side names its own connectors from the same port and
 * arrives at the same signal keys, which is how a harness crosses a sheet
 * boundary. A bundle reaching no port is local to its sheet and identified by
 * `sheetKey`.
 *
 * Naming follows Altium's rule that harness elements do not name nets, with one
 * exception: a net label placed on the signal harness line names the harness,
 * and every net it carries is then called `<harness label>.<entry name>` in
 * place of whatever the wire itself was labelled.
 *
 * Entries of a connector that reaches neither a harness line nor a port are
 * left alone: they connect through geometry only, as they did before.
 */
export const assignHarnessSignals = (
  connectors: HarnessConnector[],
  sheet: HarnessSheetObjects
): string[][] => {
  // Group everything that meets the same signal harness line. Each line is a
  // node of its own, so a harness drawn as several joined lines, or one with
  // three or more objects on it, still forms a single bundle.
  const groups = new BundleGroups();
  const lineNode = (offset: number): number => connectors.length + offset;
  const pointToLine = new Map<string, number>();
  const lineShapes: { node: number; points: Point[] }[] = [];
  sheet.buses.forEach((bus, offset) => {
    const points = polylinePoints(bus);
    lineShapes.push({ node: lineNode(offset), points });
    for (const point of points) {
      const key = pointKey(point);
      // A line meeting another line at a vertex is the same harness.
      const met = pointToLine.get(key);
      if (met !== undefined) groups.union(met, lineNode(offset));
      else pointToLine.set(key, lineNode(offset));
    }
  });

  /**
   * The harness line a point touches.
   *
   * Objects meet a line at one of its vertices, which is how every connector,
   * port and sheet entry in the sampled designs attaches. A net label naming the
   * harness instead sits somewhere along it, so the whole run has to be walked.
   */
  const lineAt = (point: Point): number | undefined => {
    const vertex = pointToLine.get(pointKey(point));
    if (vertex !== undefined) return vertex;
    for (const shape of lineShapes) {
      for (let i = 0; i + 1 < shape.points.length; i++) {
        if (pointOnSegment(point, shape.points[i], shape.points[i + 1])) return shape.node;
      }
    }
    return undefined;
  };

  /** Bundle names that reach a harness line, and the line group they reach. */
  const namesByNode = new Map<number, Set<string>>();
  const nameAt = (node: number, name: string): void => {
    const names = namesByNode.get(node) ?? new Set<string>();
    names.add(name);
    namesByNode.set(node, names);
  };
  const labelByNode = new Map<number, string>();
  const portByPoint = new Map<string, string>();

  let symbol: HarnessRecord | undefined;
  for (const record of sheet.records) {
    if (record.RECORD === "15") {
      symbol = record;
      continue;
    }

    if (record.RECORD === "25") {
      // A net label sitting on a harness line names that harness.
      const text = record.Text ?? record.Name;
      const node = lineAt(recordLocation(record));
      if (text && node !== undefined) {
        labelByNode.set(node, preferredName(labelByNode.get(node), String(text)));
      }
      continue;
    }

    if (record.RECORD === "18" && record.HarnessType) {
      const name = record.Name ?? record.Text;
      if (!name) continue;
      for (const end of portEnds(record)) {
        const key = pointKey(end);
        portByPoint.set(key, String(name));
        const node = lineAt(end);
        if (node !== undefined) nameAt(node, String(name));
      }
      continue;
    }

    // A harness-typed sheet entry is the parent sheet's end of a bundle that a
    // child sheet knows by the port of the same name. Two of them joined by a
    // harness line are two names for one bundle.
    if (record.RECORD === "16" && record.HarnessType && symbol) {
      const name = record.Name ?? record.Text;
      if (!name) continue;
      const node = lineAt(sheetEntryLocation(symbol, record));
      if (node !== undefined) nameAt(node, String(name));
    }
  }

  const attached = new Set<number>();
  const portNames = new Map<number, string>();
  connectors.forEach((connector, id) => {
    const key = pointKey(connector.primary);

    const line = lineAt(connector.primary);
    if (line !== undefined) {
      groups.union(line, id);
      attached.add(id);
    }

    const portName = portByPoint.get(key);
    if (portName !== undefined) {
      portNames.set(id, portName);
      attached.add(id);
    }
  });

  // Resolve every name against the final groups: a connector joined to a port
  // through a harness line shares that line's group, and so its name.
  const identityByRoot = new Map<number, string>();
  const labelByRoot = new Map<number, string>();
  const linkedByRoot = new Map<number, Set<string>>();
  for (const [id, name] of portNames) {
    const root = groups.find(id);
    identityByRoot.set(root, preferredName(identityByRoot.get(root), name));
  }
  for (const [node, label] of labelByNode) {
    const root = groups.find(node);
    labelByRoot.set(root, preferredName(labelByRoot.get(root), label));
  }
  for (const [node, names] of namesByNode) {
    const root = groups.find(node);
    const linked = linkedByRoot.get(root) ?? new Set<string>();
    for (const name of names) {
      linked.add(name);
      identityByRoot.set(root, preferredName(identityByRoot.get(root), name));
    }
    linkedByRoot.set(root, linked);
  }

  connectors.forEach((connector, id) => {
    if (!attached.has(id)) return;
    const root = groups.find(id);
    const bundle = identityByRoot.get(root) ?? `${sheet.sheetKey}#${root}`;
    const harnessLabel = labelByRoot.get(root);

    for (const entry of connector.entries) {
      const member = entry.Name ?? entry.Text;
      if (!member) continue;
      entry.harnessSignal = harnessSignalKey(bundle, String(member));
      if (harnessLabel !== undefined) entry.harnessNetName = `${harnessLabel}.${String(member)}`;
    }
  });

  return [...linkedByRoot.values()].filter((names) => names.size > 1).map((names) => [...names]);
};
