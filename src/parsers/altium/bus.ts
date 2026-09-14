/**
 * Altium buses.
 *
 * A bus (`RECORD=26`) is a polyline drawn like a wire that carries several
 * signals at once. It connects nothing by itself: a wire joins it through a
 * bus entry (`RECORD=37`, a short diagonal from `Location` to `Corner`), and
 * the wire's net label says which of the bus's signals that wire is. The bus
 * leaves the sheet through an identifier written in range notation, `AD[0..11]`
 * on a port, a sheet entry or a harness entry, or `Repeat(NAME)` on the entry
 * of a repeated sheet symbol, which carries every member across the boundary.
 *
 * So a bus member is a net, labelled on this sheet, that the parser can only
 * join to its counterpart elsewhere through the range identifier the bus
 * reaches. This module finds those identifiers for each labelled net and
 * records them as `busCarriers` on the net; the cross-sheet link code turns
 * each carrier into the same identity claim a plain port or entry makes.
 *
 * Verified on the misko3 fixture: all 16 range identifiers land on a bus
 * vertex, all 136 bus entries land on a bus, and 127 of the 131 wires meeting
 * a bus entry carry a label within one of the ranges. See docs/altium-format.md.
 */

import type { AltiumRecord, AltiumNet, AltiumSchematic, BusCarrier } from "./types.js";
import { RECORD_TYPES, identifierKey } from "./types.js";
import { findAllConnectedComponents } from "./connectivity.js";
import { flattenHierarchy } from "./hierarchy.js";
import { pointOnSegment, polylinePoints, scaledPoint, type Point } from "./coordinates.js";
import { expandRepeatChannels } from "./structure-parser.js";

type Segment = [Point, Point];

const unescapeAltiumOverbar = (name: string): string =>
  name.includes("\\") ? name.replace(/\\/g, "") : name;

const RANGE = /^(.+)\[(\d+)\.\.(\d+)\]$/;
const REPEAT = /^Repeat\((.+)\)$/i;

/**
 * The members a range identifier carries, as a test on a wire's label.
 *
 * `AD[0..11]` carries `AD0` to `AD11`. `Repeat(NAME)` carries `NAME1`,
 * `NAME2`, ... one per channel of the repeated sheet; how many is decided by
 * the symbol, so any `NAME<n>` counts here and the link code pairs the index
 * with a channel. Anything else is not a bus identifier.
 */
export const busMemberTest = (name: string): ((label: string) => boolean) | undefined => {
  const plain = unescapeAltiumOverbar(name);
  const range = plain.match(RANGE);
  if (range) {
    const [, prefix, startText, endText] = range;
    const start = parseInt(startText, 10);
    const end = parseInt(endText, 10);
    const low = Math.min(start, end);
    const high = Math.max(start, end);
    return (label) => {
      const key = identifierKey(label);
      if (!key.startsWith(identifierKey(prefix))) return false;
      const rest = key.slice(prefix.length);
      if (!/^\d+$/.test(rest)) return false;
      const index = parseInt(rest, 10);
      return index >= low && index <= high;
    };
  }
  const repeat = plain.match(REPEAT);
  if (repeat) {
    const prefix = repeat[1].trim();
    return (label) =>
      identifierKey(label).startsWith(identifierKey(prefix)) &&
      /^\d+$/.test(label.slice(prefix.length));
  }
  return undefined;
};

/** Every member of a finite range, `AD[0..2]` giving `AD0`, `AD1`, `AD2`. */
export const expandBusRange = (name: string): string[] => {
  const range = unescapeAltiumOverbar(name).match(RANGE);
  if (!range) return [];
  const [, prefix, startText, endText] = range;
  const start = parseInt(startText, 10);
  const end = parseInt(endText, 10);
  const step = start <= end ? 1 : -1;
  const members: string[] = [];
  for (let index = start; step > 0 ? index <= end : index >= end; index += step) {
    members.push(`${prefix}${index}`);
  }
  return members;
};

/** The base name of a `Repeat(NAME)` identifier, or undefined for any other. */
export const repeatBaseName = (name: string): string | undefined => {
  const repeat = unescapeAltiumOverbar(name).match(REPEAT);
  return repeat ? repeat[1].trim() : undefined;
};

const recordName = (record: AltiumRecord): string =>
  String(record.Name ?? record.NAME ?? record.Text ?? record.TEXT ?? "");

const BUS_IDENTIFIER_TYPES = new Set<string>([
  RECORD_TYPES.PORT,
  RECORD_TYPES.SHEET_ENTRY,
  RECORD_TYPES.HARNESS_ENTRY,
]);

/** Whether a record is a port, sheet entry or harness entry in range notation. */
export const isBusIdentifier = (record: AltiumRecord): boolean =>
  record.RECORD !== undefined &&
  BUS_IDENTIFIER_TYPES.has(record.RECORD) &&
  busMemberTest(recordName(record)) !== undefined;

/** Give bus lines and bus entries the coordinates the connectivity code reads. */
const placeBusRecord = (record: AltiumRecord): void => {
  if (record.RECORD === RECORD_TYPES.BUS) {
    record.coords = polylinePoints(record);
  } else if (record.RECORD === RECORD_TYPES.BUS_ENTRY) {
    record.coords = [scaledPoint(record), scaledPoint(record, "Corner")];
  }
};

const pointKey = (point: Point): string => `${point[0]},${point[1]}`;

/** One connected run of bus lines and bus entries. */
class BusRun {
  readonly points = new Set<string>();
  readonly segments: Segment[] = [];

  add(coords: Point[]): void {
    for (const point of coords) this.points.add(pointKey(point));
    for (let i = 0; i + 1 < coords.length; i++) this.segments.push([coords[i], coords[i + 1]]);
  }

  touches(point: Point): boolean {
    if (this.points.has(pointKey(point))) return true;
    return this.segments.some((segment) => pointOnSegment(point, segment));
  }
}

/**
 * Fold together the runs that carry one bus label.
 *
 * A net label on a bus names the bus, and as with a wire the name joins every
 * bus on the sheet that carries it: the ld_harness top sheet draws
 * `OP_OUT_P[1..9]` on one bus beside the channel symbol and again on another
 * beside the connector, and only the label says they are one.
 */
const joinLabelledRuns = (runs: BusRun[], records: readonly AltiumRecord[]): BusRun[] => {
  const runByLabel = new Map<string, BusRun>();
  const merged = new Map<BusRun, BusRun>();
  const resolve = (run: BusRun): BusRun => {
    let root = run;
    while (merged.get(root) !== undefined) root = merged.get(root)!;
    return root;
  };
  for (const record of records) {
    if (record.RECORD !== RECORD_TYPES.NET_LABEL) continue;
    const text = record.Text ?? record.TEXT;
    if (text === undefined || text === null || text === "") continue;
    const label = unescapeAltiumOverbar(String(text));
    if (!RANGE.test(label)) continue;
    const point = scaledPoint(record);
    const run = runs.find((candidate) => candidate.touches(point));
    if (!run) continue;
    const seen = runByLabel.get(identifierKey(label));
    if (!seen) {
      runByLabel.set(identifierKey(label), run);
      continue;
    }
    const target = resolve(seen);
    const source = resolve(run);
    if (target === source) continue;
    for (const key of source.points) target.points.add(key);
    target.segments.push(...source.segments);
    merged.set(source, target);
  }
  return runs.filter((run) => !merged.has(run));
};

const segmentsOf = (record: AltiumRecord): Segment[] => {
  const coords = (record.coords ?? []) as Point[];
  const segments: Segment[] = [];
  for (let i = 0; i + 1 < coords.length; i++) segments.push([coords[i], coords[i + 1]]);
  if (coords.length === 1) segments.push([coords[0], coords[0]]);
  return segments;
};

const netTouchesRun = (net: AltiumNet, run: BusRun): boolean =>
  net.devices.some(
    (device) =>
      device.RECORD === RECORD_TYPES.WIRE &&
      ((device.coords ?? []) as Point[]).some((point) => run.touches(point))
  );

const netTouchesPoint = (net: AltiumNet, point: Point): boolean =>
  net.devices.some(
    (device) =>
      device.RECORD === RECORD_TYPES.WIRE &&
      segmentsOf(device).some((segment) => pointOnSegment(point, segment))
  );

const labelsOf = (net: AltiumNet): string[] => {
  const labels = new Set<string>();
  for (const device of net.devices) {
    if (device.RECORD !== RECORD_TYPES.NET_LABEL) continue;
    const text = device.Text ?? device.TEXT;
    if (text !== undefined && text !== null && text !== "") {
      labels.add(unescapeAltiumOverbar(String(text)));
    }
  }
  return [...labels];
};

/** The range labels drawn on a run, `FMC1_P[32..1]` on the bus itself. */
const rangeLabelsOn = (run: BusRun, records: readonly AltiumRecord[]): string[] => {
  const labels: string[] = [];
  for (const record of records) {
    if (record.RECORD !== RECORD_TYPES.NET_LABEL) continue;
    const label = unescapeAltiumOverbar(String(record.Text ?? record.TEXT ?? ""));
    if (RANGE.test(label) && run.touches(scaledPoint(record))) labels.push(label);
  }
  return labels;
};

/**
 * Attach every bus member net to the range identifiers its bus reaches.
 *
 * Buses and bus entries are grouped into runs by geometry. A net is on a run
 * when one of its wires ends on it, which is where a bus entry's outer end
 * sits; an identifier is on a run when it sits on the run itself or on a wire
 * of a net that does. A net's labels are then matched against every
 * identifier of the run, and each match is recorded as a carrier on the net.
 *
 * A member no wire on this sheet labels still crosses the boundary: a bus
 * drawn from one sheet symbol's `A[0..7]` straight to another's links the two
 * without naming anything here. Such members are returned as pinless nets
 * carrying only their identifiers, so the link code still joins the two sides.
 *
 * `Repeat(NAME)` gives no members of its own, so it only ever joins nets that
 * are labelled. Nor does it insist on its own name: Altium hands member `n`
 * of whatever bus reaches the entry to channel `n`, and the FMC-DIO board
 * carries `FMC1_P8` from the bus `FMC1_P[32..1]` into channel 8 of
 * `Repeat(FMC_P)`. So a `Repeat(NAME)` entry accepts `NAME<n>` and, when
 * every range on the run spells one prefix, that range's members too; a run
 * carrying two prefixes could hand one channel two members, and there the
 * entry keeps to its own name.
 */
export const attachBusMembers = (schematic: AltiumSchematic, nets: AltiumNet[]): AltiumNet[] => {
  const records = flattenHierarchy(schematic);
  const identifiers = records.filter(isBusIdentifier);
  if (identifiers.length === 0) return [];

  const busRecords = records.filter(
    (record) => record.RECORD === RECORD_TYPES.BUS || record.RECORD === RECORD_TYPES.BUS_ENTRY
  );
  for (const record of busRecords) placeBusRecord(record);

  const runs = joinLabelledRuns(
    findAllConnectedComponents(busRecords).map((members) => {
      const run = new BusRun();
      for (const record of members) run.add((record.coords ?? []) as Point[]);
      return run;
    }),
    records
  );

  const virtual: AltiumNet[] = [];
  const carried = new Set<AltiumRecord>();
  const identifierNet = new Map<AltiumRecord, AltiumNet>();
  for (const net of nets) {
    for (const device of net.devices) if (isBusIdentifier(device)) identifierNet.set(device, net);
  }

  for (const run of runs) {
    // A net is on the run when a wire of its ends there, or when it is
    // labelled with a member of a range the bus itself is labelled with: the
    // label names the member wherever on the sheet it is drawn, as any net
    // label does, and the FMC-DIO top sheet wires its `FMC1_P8` nowhere near
    // the bus `FMC1_P[32..1]` that carries it into the channel symbol.
    // Geometry decides what is on the run: the nets whose wires end there, and
    // the identifiers that sit on it or on such a net.
    const touching = nets.filter((net) => netTouchesRun(net, run));
    const onRun = identifiers.filter((identifier) => {
      const coords = (identifier.coords ?? []) as Point[];
      if (coords.some((point) => run.touches(point))) return true;
      const own = identifierNet.get(identifier);
      if (own && touching.includes(own)) return true;
      return coords.some((point) => touching.some((net) => netTouchesPoint(net, point)));
    });
    if (onRun.length === 0) continue;
    for (const identifier of onRun) carried.add(identifier);

    // The ranges the run carries, as labels on the bus and as identifiers
    // written in range notation. Their members are named nets of the sheet,
    // so a net labelled with one is on the run wherever its wire is drawn.
    // When every range spells one prefix, a `Repeat(NAME)` entry on the run
    // takes their members by index as well.
    const ranges = [
      ...rangeLabelsOn(run, records),
      ...onRun.map(recordName).filter((name) => RANGE.test(unescapeAltiumOverbar(name))),
    ];
    const rangeTests = ranges.map((name) => busMemberTest(name)!);
    const named = (label: string): boolean => rangeTests.some((test) => test(label));
    const attached = [
      ...touching,
      ...nets.filter((net) => !touching.includes(net) && labelsOf(net).some(named)),
    ];
    const prefixes = new Set(ranges.map((name) => unescapeAltiumOverbar(name).match(RANGE)![1]));
    const indexedPrefix = prefixes.size === 1 ? [...prefixes][0] : undefined;

    const tests = onRun.map((identifier) => {
      const name = recordName(identifier);
      const own = busMemberTest(name)!;
      const base = repeatBaseName(name);
      const matches =
        base !== undefined && indexedPrefix !== undefined
          ? (label: string) => own(label) || named(label)
          : own;
      return { identifier, matches, base };
    });
    // A `Repeat(NAME)` carrier records the channel its member indexes: the
    // digits after the prefix. The run's range is the one that lists the
    // member, so its prefix is read first: `X12` on a bus `X1[1..2]` into
    // `Repeat(X)` is channel 2, not channel 12.
    const carry = (test: (typeof tests)[number], member: string): BusCarrier => {
      if (test.base === undefined) return { device: test.identifier, member };
      const prefix = indexedPrefix !== undefined && named(member) ? indexedPrefix : test.base;
      const channel = parseInt(member.slice(prefix.length), 10);
      return { device: test.identifier, member, channel };
    };

    const labelled = new Set<string>();
    for (const net of attached) {
      for (const label of labelsOf(net)) {
        const carriers = tests.filter(({ matches }) => matches(label)).map((t) => carry(t, label));
        if (carriers.length === 0) continue;
        labelled.add(label);
        net.busCarriers = [...(net.busCarriers ?? []), ...carriers];
      }
    }

    const unlabelled = new Set<string>();
    for (const { identifier } of tests) {
      for (const member of expandBusRange(recordName(identifier))) {
        if (!labelled.has(member)) unlabelled.add(member);
      }
    }
    for (const member of unlabelled) {
      const carriers = tests.filter(({ matches }) => matches(member)).map((t) => carry(t, member));
      virtual.push({ name: null, devices: [], busCarriers: carriers });
    }
  }

  const unbussed = identifiers.filter((identifier) => !carried.has(identifier));
  return [...virtual, ...attachRepeatWires(records, nets, unbussed)];
};

/**
 * Attach the channels of `Repeat(NAME)` entries whose wire reaches no bus.
 *
 * The wire's net label `L` names one member per channel: channel `n` carries `L<n>`,
 * the sheet's net of that name.
 */
const attachRepeatWires = (
  records: readonly AltiumRecord[],
  nets: AltiumNet[],
  identifiers: readonly AltiumRecord[]
): AltiumNet[] => {
  const repeats = identifiers.filter(
    (entry) =>
      entry.RECORD === RECORD_TYPES.SHEET_ENTRY && repeatBaseName(recordName(entry)) !== undefined
  );
  if (repeats.length === 0) return [];

  const channelsOf = new Map<AltiumRecord, number[]>();
  for (const symbol of records) {
    if (symbol.RECORD !== RECORD_TYPES.SHEET_SYMBOL) continue;
    const designator = (symbol.children ?? []).find((c) => c.RECORD === RECORD_TYPES.SHEET_NAME);
    const channels = expandRepeatChannels(designator ? recordName(designator) : "");
    for (const entry of symbol.children ?? []) {
      channelsOf.set(
        entry,
        channels.map((channel) => channel.index)
      );
    }
  }
  const netsByLabel = new Map<string, AltiumNet[]>();
  for (const net of nets) {
    for (const label of labelsOf(net)) {
      const key = identifierKey(label);
      netsByLabel.set(key, [...(netsByLabel.get(key) ?? []), net]);
    }
  }

  const virtual: AltiumNet[] = [];
  for (const net of nets) {
    const label = labelsOf(net).sort()[0];
    if (label === undefined) continue;
    const members = new Map<string, BusCarrier[]>();
    for (const entry of repeats) {
      if (!((entry.coords ?? []) as Point[]).some((point) => netTouchesPoint(net, point))) continue;
      for (const channel of channelsOf.get(entry) ?? []) {
        const member = `${label}${channel}`;
        const key = identifierKey(member);
        members.set(key, [...(members.get(key) ?? []), { device: entry, member, channel }]);
      }
    }
    for (const [key, carriers] of members) {
      const labelled = netsByLabel.get(key) ?? [];
      for (const other of labelled) other.busCarriers = [...(other.busCarriers ?? []), ...carriers];
      if (labelled.length === 0) virtual.push({ name: null, devices: [], busCarriers: carriers });
    }
  }
  return virtual;
};
