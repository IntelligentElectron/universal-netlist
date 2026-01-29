/**
 * Altium Connectivity Detection
 *
 * Uses spatial indexing and Union-Find for O(n) connectivity detection
 * instead of O(n²) pairwise comparisons.
 */

import type { AltiumRecord } from './types.js';
import { RECORD_TYPES } from './types.js';

type Coordinate = [number, number];
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
 * Grid-based spatial index for fast neighbor lookup
 */
class SpatialIndex {
  private cellSize: number;
  private grid: Map<string, number[]> = new Map();
  private pointToDevices: Map<string, number[]> = new Map();
  private segmentCells: Map<number, Set<string>> = new Map();

  constructor(cellSize = 10000) {
    this.cellSize = cellSize;
  }

  private cellKey(x: number, y: number): string {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    return `${cx},${cy}`;
  }

  private coordKey(x: number, y: number): string {
    return `${x},${y}`;
  }

  private cellsForSegment(p1: Coordinate, p2: Coordinate): Set<string> {
    const cells = new Set<string>();
    const [x1, y1] = p1;
    const [x2, y2] = p2;

    const minCx = Math.floor(Math.min(x1, x2) / this.cellSize);
    const maxCx = Math.floor(Math.max(x1, x2) / this.cellSize);
    const minCy = Math.floor(Math.min(y1, y2) / this.cellSize);
    const maxCy = Math.floor(Math.max(y1, y2) / this.cellSize);

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
      const coordKeyStr = this.coordKey(coord[0], coord[1]);
      if (!this.pointToDevices.has(coordKeyStr)) {
        this.pointToDevices.set(coordKeyStr, []);
      }
      this.pointToDevices.get(coordKeyStr)!.push(deviceIdx);

      const cellKeyStr = this.cellKey(coord[0], coord[1]);
      allCells.add(cellKeyStr);
    }

    const recordType = device.RECORD;
    if (
      (recordType === RECORD_TYPES.WIRE || recordType === RECORD_TYPES.PIN) &&
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

  getPointToDevices(): Map<string, number[]> {
    return this.pointToDevices;
  }
}

/**
 * Get line segments for a device.
 */
const getLineSegments = (device: AltiumRecord): LineSegment[] => {
  if (!device.coords || device.coords.length === 0) {
    return [];
  }

  if (device.RECORD === RECORD_TYPES.WIRE && device.coords.length > 1) {
    const segments: LineSegment[] = [];
    for (let i = 0; i < device.coords.length - 1; i++) {
      segments.push([device.coords[i], device.coords[i + 1]]);
    }
    return segments;
  }

  if (device.RECORD === RECORD_TYPES.PIN && device.coords.length > 1) {
    return [[device.coords[0], device.coords[1]]];
  }

  const point = device.coords[0];
  return [[point, point]];
};

/**
 * Check if a point lies on a line segment.
 */
const pointOnSegment = (point: Coordinate, segment: LineSegment): boolean => {
  const [p1, p2] = segment;
  const [px, py] = point;

  const minX = Math.min(p1[0], p2[0]);
  const maxX = Math.max(p1[0], p2[0]);
  const minY = Math.min(p1[1], p2[1]);
  const maxY = Math.max(p1[1], p2[1]);

  return px >= minX && px <= maxX && py >= minY && py <= maxY;
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

  // Special case: power ports AND net labels with same Text are connected globally
  const isGloballyNamedDevice = (d: AltiumRecord): boolean =>
    d.RECORD === RECORD_TYPES.POWER_PORT || d.RECORD === RECORD_TYPES.NET_LABEL;

  const deviceAText = deviceA.Text ?? deviceA.TEXT;
  const deviceBText = deviceB.Text ?? deviceB.TEXT;

  if (
    isGloballyNamedDevice(deviceA) &&
    isGloballyNamedDevice(deviceB) &&
    deviceAText &&
    deviceBText &&
    deviceAText === deviceBText
  ) {
    return true;
  }

  return false;
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

  // Collect globally-named devices (power ports and net labels)
  const globalLabels = new Map<string, number[]>();
  for (const device of devices) {
    if (device.RECORD === RECORD_TYPES.POWER_PORT || device.RECORD === RECORD_TYPES.NET_LABEL) {
      const text = (device.Text ?? device.TEXT) as string | undefined;
      if (text) {
        if (!globalLabels.has(text)) {
          globalLabels.set(text, []);
        }
        globalLabels.get(text)!.push(device.index);
      }
    }
  }

  // Union devices sharing exact coordinates
  for (const deviceIndices of spatialIndex.getPointToDevices().values()) {
    if (deviceIndices.length > 1) {
      const first = deviceIndices[0];
      for (let i = 1; i < deviceIndices.length; i++) {
        uf.union(first, deviceIndices[i]);
      }
    }
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
