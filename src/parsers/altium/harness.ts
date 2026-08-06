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

/** Connector side whose geometry is verified against a real design. */
const HARNESS_SIDE_ENTRIES_LEFT = "1";

interface PositionedRecord {
  RECORD?: string;
  Name?: string;
  DistanceFromTop?: string;
  "Location.X"?: string;
  "Location.Y"?: string;
  XSize?: string;
  HarnessConnectorSide?: string;
}

/**
 * Give every harness entry the coordinate at which wires meet it.
 *
 * Entries carry only a `DistanceFromTop` and inherit their position from the
 * harness connector that owns them. `OwnerIndex` is present on some entries and
 * absent on others, so ownership is taken from stream order: entries follow
 * their connector.
 *
 * Only `HarnessConnectorSide=1` is positioned, because that is the arrangement
 * confirmed against a real design. Entries on an unverified side are left
 * without coordinates, so they simply do not participate in connectivity rather
 * than inventing a connection that may not exist.
 */
export const positionHarnessEntries = (records: PositionedRecord[]): number => {
  let connector: PositionedRecord | undefined;
  let positioned = 0;

  for (const record of records) {
    if (record.RECORD === "215") {
      connector = record;
      continue;
    }
    if (record.RECORD !== "216" || !connector) continue;
    if (connector.HarnessConnectorSide !== HARNESS_SIDE_ENTRIES_LEFT) continue;

    const originX = Number(connector["Location.X"]);
    const originY = Number(connector["Location.Y"]);
    const distance = Number(record.DistanceFromTop);
    if (!Number.isFinite(originX) || !Number.isFinite(originY) || !Number.isFinite(distance)) {
      continue;
    }

    record["Location.X"] = String(originX);
    record["Location.Y"] = String(originY - distance * HARNESS_ENTRY_PITCH);
    positioned++;
  }

  return positioned;
};
