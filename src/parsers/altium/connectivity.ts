/**
 * Altium Connectivity Detection
 *
 * Uses spatial indexing and Union-Find for O(n) connectivity detection
 * instead of O(n²) pairwise comparisons.
 */

import type { AltiumRecord } from "./types.js";
import { RECORD_TYPES, identifierKey } from "./types.js";
import {
  COORDINATE_SCALE,
  TOUCH_TOLERANCE,
  pointOnSegment,
  pointsTouch,
  type Point as Coordinate,
} from "./coordinates.js";

type LineSegment = [Coordinate, Coordinate];

/**
 * Union-Find data structure for efficient connected component detection
 */
class UnionFind {
  private parent: Map<number, number> = new Map();
  private rank: Map<number, number> = new Map();

  find(x: number): number {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      this.rank.set(x, 0);
    }
    if (this.parent.get(x) !== x) {
      this.parent.set(x, this.find(this.parent.get(x)!));
    }
    return this.parent.get(x)!;
  }

  union(x: number, y: number): void {
    let rootX = this.find(x);
    let rootY = this.find(y);
    if (rootX === rootY) return;

    const rankX = this.rank.get(rootX)!;
    const rankY = this.rank.get(rootY)!;

    if (rankX < rankY) {
      [rootX, rootY] = [rootY, rootX];
    }
    this.parent.set(rootY, rootX);
    if (rankX === rankY) {
      this.rank.set(rootX, rankX + 1);
    }
  }
}

/**
 * Grid-based spatial index for fast neighbor lookup. A device occupies every cell
 * within TOUCH_TOLERANCE of it, so devices that touch across a cell edge share a cell.
 */
class SpatialIndex {
  private cellSize: number;
  private grid: Map<string, number[]> = new Map();
  private segmentCells: Map<number, Set<string>> = new Map();

  constructor(cellSize = COORDINATE_SCALE) {
    this.cellSize = cellSize;
  }

  private cellsForSegment(p1: Coordinate, p2: Coordinate): Set<string> {
    const cells = new Set<string>();
    const [x1, y1] = p1;
    const [x2, y2] = p2;

    const minCx = Math.floor((Math.min(x1, x2) - TOUCH_TOLERANCE) / this.cellSize);
    const maxCx = Math.floor((Math.max(x1, x2) + TOUCH_TOLERANCE) / this.cellSize);
    const minCy = Math.floor((Math.min(y1, y2) - TOUCH_TOLERANCE) / this.cellSize);
    const maxCy = Math.floor((Math.max(y1, y2) + TOUCH_TOLERANCE) / this.cellSize);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        cells.add(`${cx},${cy}`);
      }
    }
    return cells;
  }

  addDevice(device: AltiumRecord): void {
    if (!device.coords || device.coords.length === 0) return;

    const deviceIdx = device.index;
    const allCells = new Set<string>();

    for (const coord of device.coords) {
      for (const cell of this.cellsForSegment(coord, coord)) allCells.add(cell);
    }

    const recordType = device.RECORD;
    if (
      (recordType === RECORD_TYPES.WIRE ||
        recordType === RECORD_TYPES.BUS ||
        recordType === RECORD_TYPES.PIN ||
        recordType === RECORD_TYPES.PORT ||
        recordType === RECORD_TYPES.BUS_ENTRY) &&
      device.coords.length > 1
    ) {
      for (let i = 0; i < device.coords.length - 1; i++) {
        const segCells = this.cellsForSegment(device.coords[i], device.coords[i + 1]);
        for (const cell of segCells) {
          allCells.add(cell);
        }
      }
    }

    this.segmentCells.set(deviceIdx, allCells);
    for (const cell of allCells) {
      if (!this.grid.has(cell)) {
        this.grid.set(cell, []);
      }
      this.grid.get(cell)!.push(deviceIdx);
    }
  }

  getCandidates(device: AltiumRecord): Set<number> {
    const cells = this.segmentCells.get(device.index);
    if (!cells) return new Set();

    const candidates = new Set<number>();
    for (const cell of cells) {
      const devicesInCell = this.grid.get(cell);
      if (devicesInCell) {
        for (const idx of devicesInCell) {
          candidates.add(idx);
        }
      }
    }
    candidates.delete(device.index);
    return candidates;
  }
}

/**
 * Get line segments for a device.
 *
 * A bus line is a polyline like a wire and a bus entry a two-point segment
 * like a pin. Neither is passed here by the net extractor, which never lets a
 * bus join a net; bus.ts groups them on their own to find which range
 * identifiers a bus reaches.
 */
const getLineSegments = (device: AltiumRecord): LineSegment[] => {
  if (!device.coords || device.coords.length === 0) {
    return [];
  }

  if (
    (device.RECORD === RECORD_TYPES.WIRE || device.RECORD === RECORD_TYPES.BUS) &&
    device.coords.length > 1
  ) {
    const segments: LineSegment[] = [];
    for (let i = 0; i < device.coords.length - 1; i++) {
      segments.push([device.coords[i], device.coords[i + 1]]);
    }
    return segments;
  }

  if (
    (device.RECORD === RECORD_TYPES.PIN ||
      device.RECORD === RECORD_TYPES.PORT ||
      device.RECORD === RECORD_TYPES.BUS_ENTRY) &&
    device.coords.length > 1
  ) {
    return [[device.coords[0], device.coords[1]]];
  }

  const point = device.coords[0];
  return [[point, point]];
};

/**
 * Check if a point lies on any of the given line segments.
 */
const pointOnAnySegment = (point: Coordinate, segments: LineSegment[]): boolean => {
  for (const segment of segments) {
    if (pointOnSegment(point, segment)) {
      return true;
    }
  }
  return false;
};

/**
 * Check if two devices are connected.
 *
 * Connectivity is determined by:
 * 1. For wires: line segment intersection
 * 2. For other devices: point overlap on wire segment
 * 3. Special case: power ports/net labels with same TEXT value
 */
export const isConnected = (deviceA: AltiumRecord, deviceB: AltiumRecord): boolean => {
  const segmentsA = getLineSegments(deviceA);
  const segmentsB = getLineSegments(deviceB);

  // Two pins meet tip to tip or not at all. A wire may end anywhere along a pin,
  // as imported designs draw them, but a pin's inner end is its body: pins drawn
  // from one point, or overlapping along one line, stay apart.
  if (deviceA.RECORD === RECORD_TYPES.PIN && deviceB.RECORD === RECORD_TYPES.PIN) {
    const tipA = deviceA.coords?.[deviceA.coords.length - 1];
    const tipB = deviceB.coords?.[deviceB.coords.length - 1];
    return tipA !== undefined && tipB !== undefined && pointsTouch(tipA, tipB);
  }

  for (const segment of segmentsA) {
    for (const vertex of segment) {
      if (pointOnAnySegment(vertex, segmentsB)) {
        return true;
      }
    }
  }

  for (const segment of segmentsB) {
    for (const vertex of segment) {
      if (pointOnAnySegment(vertex, segmentsA)) {
        return true;
      }
    }
  }

  // Harness entries carrying the same signal of the same bundle are the two ends
  // of one net, however the wires reaching them are labelled.
  if (
    deviceA.RECORD === RECORD_TYPES.HARNESS_ENTRY &&
    deviceB.RECORD === RECORD_TYPES.HARNESS_ENTRY &&
    typeof deviceA.harnessSignal === "string" &&
    typeof deviceB.harnessSignal === "string" &&
    identifierKey(deviceA.harnessSignal) === identifierKey(deviceB.harnessSignal)
  ) {
    return true;
  }

  // Special case: named devices with the same name are connected by that name
  // (see namedDeviceKey).
  const keyA = namedDeviceKey(deviceA);
  return keyA !== undefined && keyA === namedDeviceKey(deviceB);
};

/**
 * The name under which a device joins others of its kind without a wire, or
 * undefined for a device that only joins by geometry.
 *
 * Power ports and net labels of one name, in any case, are one net. Ports of one
 * name are one net too, but a port never joins a net label: Altium's connectivity guide
 * states that a port called `Inta` does not connect to a net label called
 * `Inta`, they must be wired. A sheet entry never joins by name at all: several
 * sheet symbols may carry entries of one name that lead to different nets.
 */
const namedDeviceKey = (device: AltiumRecord): string | undefined => {
  const name = device.Text ?? device.TEXT ?? device.Name ?? device.NAME;
  if (name === undefined || name === null || name === "") return undefined;
  if (device.RECORD === RECORD_TYPES.POWER_PORT || device.RECORD === RECORD_TYPES.NET_LABEL) {
    return `label:${identifierKey(String(name))}`;
  }
  if (device.RECORD === RECORD_TYPES.PORT) return `port:${identifierKey(String(name))}`;
  return undefined;
};

/**
 * Find all connected components using spatial indexing and Union-Find.
 * This is O(n) average case instead of O(n²).
 */
export const findAllConnectedComponents = (devices: AltiumRecord[]): AltiumRecord[][] => {
  if (devices.length === 0) return [];

  const spatialIndex = new SpatialIndex();
  for (const device of devices) {
    spatialIndex.addDevice(device);
  }

  const uf = new UnionFind();
  const deviceByIndex = new Map<number, AltiumRecord>();
  for (const d of devices) {
    deviceByIndex.set(d.index, d);
    uf.find(d.index); // Initialize
  }

  // Collect the devices that join by name (see namedDeviceKey)
  const globalLabels = new Map<string, number[]>();
  for (const device of devices) {
    const key = namedDeviceKey(device);
    if (key === undefined) continue;
    if (!globalLabels.has(key)) {
      globalLabels.set(key, []);
    }
    globalLabels.get(key)!.push(device.index);
  }

  // Collect harness entries by the signal they carry. Two entries of one bundle
  // named alike are the same net wherever they are drawn, so a wire label that
  // differs from one end of the harness to the other does not split it.
  const harnessSignals = new Map<string, number[]>();
  for (const device of devices) {
    if (device.RECORD !== RECORD_TYPES.HARNESS_ENTRY) continue;
    const signal = device.harnessSignal;
    if (typeof signal !== "string" || !signal) continue;
    const key = identifierKey(signal);
    if (!harnessSignals.has(key)) {
      harnessSignals.set(key, []);
    }
    harnessSignals.get(key)!.push(device.index);
  }

  // Union geometrically connected devices (only check candidates in same cells)
  for (const device of devices) {
    const candidates = spatialIndex.getCandidates(device);
    for (const candidateIdx of candidates) {
      const candidate = deviceByIndex.get(candidateIdx)!;
      if (isConnected(device, candidate)) {
        uf.union(device.index, candidateIdx);
      }
    }
  }

  // Union globally-named devices (power ports/net labels with same text)
  for (const indices of globalLabels.values()) {
    if (indices.length > 1) {
      const first = indices[0];
      for (let i = 1; i < indices.length; i++) {
        uf.union(first, indices[i]);
      }
    }
  }

  // Union the harness entries that carry one signal
  for (const indices of harnessSignals.values()) {
    if (indices.length > 1) {
      const first = indices[0];
      for (let i = 1; i < indices.length; i++) {
        uf.union(first, indices[i]);
      }
    }
  }

  // Group devices by their root
  const components = new Map<number, AltiumRecord[]>();
  for (const device of devices) {
    const root = uf.find(device.index);
    if (!components.has(root)) {
      components.set(root, []);
    }
    components.get(root)!.push(device);
  }

  return Array.from(components.values());
};

/**
 * Find all devices directly connected to the given device.
 */
export const findNeighbors = (device: AltiumRecord, allDevices: AltiumRecord[]): AltiumRecord[] => {
  const neighbors: AltiumRecord[] = [];

  for (const other of allDevices) {
    if (other.index === device.index) {
      continue;
    }

    if (isConnected(device, other)) {
      neighbors.push(other);
    }
  }

  return neighbors;
};

/**
 * Find all devices connected to a starting device using DFS.
 * Note: This is kept for backwards compatibility but the new
 * findAllConnectedComponents() is preferred for performance.
 */
export const findConnectedDevices = (
  startDevice: AltiumRecord,
  allDevices: AltiumRecord[],
  visited: AltiumRecord[] = []
): AltiumRecord[] => {
  const alreadyVisited = visited.some((v) => v.index === startDevice.index);
  if (alreadyVisited) {
    return visited;
  }

  visited.push(startDevice);
  const neighbors = findNeighbors(startDevice, allDevices);

  for (const neighbor of neighbors) {
    findConnectedDevices(neighbor, allDevices, visited);
  }

  return visited;
};
