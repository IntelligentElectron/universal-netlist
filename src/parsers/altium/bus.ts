/**
 * Buses.
 *
 * A bus carries several signals and connects nothing by itself. A wire meets it through a
 * bus entry, the wire's net label naming which member it is, and the bus leaves the sheet
 * through a range identifier (`AD[0..11]` on a port, sheet entry or harness entry) or a
 * `Repeat(NAME)` sheet entry. Each member net is given a carrier for every identifier its
 * bus reaches, which links it across sheets as a plain port or entry would.
 */

import {
  RECORD_TYPES,
  type AltiumNet,
  type AltiumRecord,
  type AltiumSchematic,
  type BusCarrier,
} from "./types.js";
import { fieldText, flattenHierarchy, recordName } from "./records.js";
import {
  busMemberTest,
  expandBusRange,
  identifierKey,
  rangePrefix,
  repeatBaseName,
  repeatChannels,
} from "./notation.js";
import { sheetSymbolDesignator } from "./sheet-hierarchy.js";
import { findAllConnectedComponents } from "./connectivity.js";
import {
  pointOnPolyline,
  pointOnSegment,
  polylinePoints,
  scaledPoint,
  type Point,
} from "./coordinates.js";

const BUS_IDENTIFIERS = new Set<string | undefined>([
  RECORD_TYPES.PORT,
  RECORD_TYPES.SHEET_ENTRY,
  RECORD_TYPES.HARNESS_ENTRY,
]);

/** Whether a record is a port, sheet entry or harness entry written as a range or `Repeat()`. */
export const isBusIdentifier = (record: AltiumRecord): boolean =>
  BUS_IDENTIFIERS.has(record.RECORD) && busMemberTest(recordName(record) ?? "") !== undefined;

const labelsOf = (net: AltiumNet): string[] => [
  ...new Set(
    net.devices
      .filter((device) => device.RECORD === RECORD_TYPES.NET_LABEL)
      .map((device) => fieldText(device, "Text"))
      .filter((label): label is string => label !== undefined)
  ),
];

const isRange = (name: string): boolean => rangePrefix(name) !== undefined;

/** One connected run of bus lines and bus entries. */
class BusRun {
  readonly vertices = new Set<string>();
  readonly segments: [Point, Point][] = [];

  add(points: Point[]): void {
    for (const point of points) this.vertices.add(`${point[0]},${point[1]}`);
    for (let i = 1; i < points.length; i++) this.segments.push([points[i - 1], points[i]]);
  }

  touches(point: Point): boolean {
    return (
      this.vertices.has(`${point[0]},${point[1]}`) ||
      this.segments.some((segment) => pointOnSegment(point, segment))
    );
  }

  absorb(other: BusRun): void {
    for (const vertex of other.vertices) this.vertices.add(vertex);
    this.segments.push(...other.segments);
  }
}

/** A sheet's net labels in range notation, where each is drawn. */
interface RangeLabel {
  label: string;
  at: Point;
}

/** A sheet's bus runs, runs carrying one range label folded into one. */
const busRuns = (
  records: readonly AltiumRecord[],
  rangeLabels: readonly RangeLabel[]
): BusRun[] => {
  const busRecords = records.filter(
    (record) => record.RECORD === RECORD_TYPES.BUS || record.RECORD === RECORD_TYPES.BUS_ENTRY
  );
  for (const record of busRecords) {
    record.coords =
      record.RECORD === RECORD_TYPES.BUS
        ? polylinePoints(record)
        : [scaledPoint(record), scaledPoint(record, "Corner")];
  }
  const runs = findAllConnectedComponents(busRecords).map((members) => {
    const run = new BusRun();
    for (const record of members) run.add(record.coords ?? []);
    return run;
  });

  const merged = new Map<BusRun, BusRun>();
  const resolve = (run: BusRun): BusRun => {
    let root = run;
    while (merged.has(root)) root = merged.get(root)!;
    return root;
  };
  const runByLabel = new Map<string, BusRun>();
  for (const { label, at } of rangeLabels) {
    const run = runs.find((candidate) => candidate.touches(at));
    if (!run) continue;
    const seen = runByLabel.get(identifierKey(label));
    if (!seen) {
      runByLabel.set(identifierKey(label), run);
      continue;
    }
    const [target, source] = [resolve(seen), resolve(run)];
    if (target === source) continue;
    target.absorb(source);
    merged.set(source, target);
  }
  return runs.filter((run) => !merged.has(run));
};

const netTouchesPoint = (net: AltiumNet, point: Point): boolean =>
  net.devices.some(
    (device) => device.RECORD === RECORD_TYPES.WIRE && pointOnPolyline(point, device.coords ?? [])
  );

/**
 * Attach every bus member net to the identifiers its bus reaches, and return a pinless
 * net for each member no net on the sheet labels.
 *
 * A net is on a run when one of its wires ends on it, or when a label names a member of a
 * range the run carries: a label names its net wherever it is drawn. An identifier is on
 * a run when it sits on the run or on a wire of a net that does. A `Repeat(NAME)` entry
 * hands member `n` to channel `n`: it accepts `NAME<n>` and, when every range on its run
 * spells one prefix, that range's members too.
 */
export const attachBusMembers = (schematic: AltiumSchematic, nets: AltiumNet[]): AltiumNet[] => {
  const records = flattenHierarchy(schematic);
  const identifiers = records.filter(isBusIdentifier);
  if (identifiers.length === 0) return [];

  const identifierNet = new Map<AltiumRecord, AltiumNet>();
  for (const net of nets) {
    for (const device of net.devices) if (isBusIdentifier(device)) identifierNet.set(device, net);
  }

  const virtual: AltiumNet[] = [];
  const carried = new Set<AltiumRecord>();
  const rangeLabels: RangeLabel[] = records
    .filter((record) => record.RECORD === RECORD_TYPES.NET_LABEL)
    .map((record) => ({ label: fieldText(record, "Text") ?? "", at: scaledPoint(record) }))
    .filter(({ label }) => isRange(label));
  const netLabels = new Map(nets.map((net) => [net, labelsOf(net)]));

  for (const run of busRuns(records, rangeLabels)) {
    const touching = nets.filter((net) =>
      net.devices.some(
        (device) =>
          device.RECORD === RECORD_TYPES.WIRE &&
          (device.coords ?? []).some((point) => run.touches(point))
      )
    );
    const onRun = identifiers.filter((identifier) => {
      const points = identifier.coords ?? [];
      if (points.some((point) => run.touches(point))) return true;
      const own = identifierNet.get(identifier);
      if (own && touching.includes(own)) return true;
      return points.some((point) => touching.some((net) => netTouchesPoint(net, point)));
    });
    if (onRun.length === 0) continue;
    for (const identifier of onRun) carried.add(identifier);

    const ranges = [
      ...rangeLabels.filter(({ at }) => run.touches(at)).map(({ label }) => label),
      ...onRun.map((identifier) => recordName(identifier) ?? "").filter(isRange),
    ];
    const rangeTests = ranges.map((name) => busMemberTest(name)!);
    const named = (label: string): boolean => rangeTests.some((test) => test(label));
    const attached = [
      ...touching,
      ...nets.filter((net) => !touching.includes(net) && netLabels.get(net)!.some(named)),
    ];
    const prefixes = new Set(ranges.map((name) => identifierKey(rangePrefix(name)!)));
    const indexedPrefix = prefixes.size === 1 ? [...prefixes][0] : undefined;

    const tests = onRun.map((identifier) => {
      const name = recordName(identifier) ?? "";
      const own = busMemberTest(name)!;
      const base = repeatBaseName(name);
      const matches =
        base !== undefined && indexedPrefix !== undefined
          ? (label: string) => own(label) || named(label)
          : own;
      return { identifier, matches, base };
    });
    // A `Repeat(NAME)` member's channel is its digits after the run's range prefix, or
    // after `NAME`: `X12` on a bus `X1[1..2]` into `Repeat(X)` is channel 2.
    const carry = (test: (typeof tests)[number], member: string): BusCarrier => {
      if (test.base === undefined) return { device: test.identifier, member };
      const prefix = indexedPrefix !== undefined && named(member) ? indexedPrefix : test.base;
      return {
        device: test.identifier,
        member,
        channel: parseInt(member.slice(prefix.length), 10),
      };
    };

    const labelled = new Set<string>();
    for (const net of attached) {
      for (const label of netLabels.get(net)!) {
        const carriers = tests.filter(({ matches }) => matches(label)).map((t) => carry(t, label));
        if (carriers.length === 0) continue;
        labelled.add(identifierKey(label));
        net.busCarriers = [...(net.busCarriers ?? []), ...carriers];
      }
    }

    const unlabelled = new Set<string>();
    for (const { identifier } of tests) {
      for (const member of expandBusRange(recordName(identifier) ?? "")) {
        if (!labelled.has(identifierKey(member))) unlabelled.add(member);
      }
    }
    for (const member of unlabelled) {
      const carriers = tests.filter(({ matches }) => matches(member)).map((t) => carry(t, member));
      virtual.push({ name: null, devices: [], busCarriers: carriers });
    }
  }

  const unbussed = identifiers.filter((identifier) => !carried.has(identifier));
  return [...virtual, ...attachRepeatWires(records, nets, netLabels, unbussed)];
};

/**
 * Attach the channels of `Repeat(NAME)` entries on a wire that reaches no bus: under
 * the wire's label `L`, channel `n` carries `L<n>`, the sheet's net of that name.
 */
const attachRepeatWires = (
  records: readonly AltiumRecord[],
  nets: AltiumNet[],
  netLabels: ReadonlyMap<AltiumNet, readonly string[]>,
  identifiers: readonly AltiumRecord[]
): AltiumNet[] => {
  const repeats = identifiers.filter(
    (entry) =>
      entry.RECORD === RECORD_TYPES.SHEET_ENTRY &&
      repeatBaseName(recordName(entry) ?? "") !== undefined
  );
  if (repeats.length === 0) return [];

  const channelsOf = new Map<AltiumRecord, number[]>();
  for (const symbol of records) {
    if (symbol.RECORD !== RECORD_TYPES.SHEET_SYMBOL) continue;
    const channels = repeatChannels(sheetSymbolDesignator(symbol)).map(({ index }) => index);
    for (const entry of symbol.children ?? []) channelsOf.set(entry, channels);
  }
  const netsByLabel = new Map<string, AltiumNet[]>();
  for (const net of nets) {
    for (const label of netLabels.get(net)!) {
      const key = identifierKey(label);
      (netsByLabel.get(key) ?? netsByLabel.set(key, []).get(key)!).push(net);
    }
  }

  const membersByWire = new Map<AltiumNet, Map<string, BusCarrier[]>>();
  for (const entry of repeats) {
    const points = entry.coords ?? [];
    for (const net of nets) {
      if (!points.some((point) => netTouchesPoint(net, point))) continue;
      const labels = netLabels.get(net)!;
      const label =
        net.name !== null && labels.includes(net.name) ? net.name : [...labels].sort()[0];
      if (label === undefined) continue;
      const members = membersByWire.get(net) ?? membersByWire.set(net, new Map()).get(net)!;
      for (const channel of channelsOf.get(entry) ?? []) {
        const member = `${label}${channel}`;
        const key = identifierKey(member);
        (members.get(key) ?? members.set(key, []).get(key)!).push({
          device: entry,
          member,
          channel,
        });
      }
    }
  }

  const virtual: AltiumNet[] = [];
  for (const members of membersByWire.values()) {
    for (const [key, carriers] of members) {
      const labelled = netsByLabel.get(key) ?? [];
      for (const other of labelled) other.busCarriers = [...(other.busCarriers ?? []), ...carriers];
      if (labelled.length === 0) virtual.push({ name: null, devices: [], busCarriers: carriers });
    }
  }
  return virtual;
};
