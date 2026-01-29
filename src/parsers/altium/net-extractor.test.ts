/**
 * Altium Net Extractor Tests
 *
 * Tests the core algorithm for extracting nets from Altium schematics.
 */

import { describe, it, expect } from 'vitest';
import { extractNets, determineNetList } from './net-extractor.js';
import { RECORD_TYPES } from './types.js';
import type { AltiumRecord, AltiumSchematic } from './types.js';

const COORDINATE_SCALE = 10000;

function scale(value: number): number {
  return value * COORDINATE_SCALE;
}

function scalePoint(x: number, y: number): [number, number] {
  return [scale(x), scale(y)];
}

describe('extractNets', () => {
  it('should extract a simple net from connected wire and pin', () => {
    const schematic: AltiumSchematic = {
      header: [],
      records: [
        {
          index: 0,
          RECORD: RECORD_TYPES.COMPONENT,
          children: [
            {
              index: 1,
              RECORD: RECORD_TYPES.PIN,
              Designator: '1',
              'Location.X': '100',
              'Location.Y': '0',
              PinLength: '0',
              PinConglomerate: '0',
            } as AltiumRecord,
            {
              index: 2,
              RECORD: RECORD_TYPES.DESIGNATOR,
              Text: 'U1',
            } as AltiumRecord,
          ],
        } as AltiumRecord,
        {
          index: 3,
          RECORD: RECORD_TYPES.WIRE,
          X1: '100',
          Y1: '0',
          X2: '200',
          Y2: '0',
        } as AltiumRecord,
      ],
    };

    const nets = extractNets(schematic);
    expect(nets.length).toBeGreaterThan(0);
  });

  it('should assign net name from power port', () => {
    const schematic: AltiumSchematic = {
      header: [],
      records: [
        {
          index: 0,
          RECORD: RECORD_TYPES.POWER_PORT,
          Text: 'VCC',
          'Location.X': '100',
          'Location.Y': '100',
        } as AltiumRecord,
        {
          index: 1,
          RECORD: RECORD_TYPES.WIRE,
          X1: '100',
          Y1: '100',
          X2: '200',
          Y2: '100',
        } as AltiumRecord,
      ],
    };

    const nets = extractNets(schematic);
    const vccNet = nets.find((n) => n.name === 'VCC');
    expect(vccNet).toBeDefined();
    expect(vccNet!.devices.length).toBe(2);
  });

  it('should ignore pins that do not match the current part', () => {
    const schematic: AltiumSchematic = {
      header: [],
      records: [
        {
          index: 0,
          RECORD: RECORD_TYPES.COMPONENT,
          CURRENTPARTID: '1',
          children: [
            {
              index: 1,
              RECORD: RECORD_TYPES.PIN,
              Designator: '1',
              OwnerIndex: '0',
              OWNERPARTID: '2', // Different part ID - should be ignored
              'Location.X': '0',
              'Location.Y': '0',
              PinLength: '0',
              PinConglomerate: '0',
            } as AltiumRecord,
            {
              index: 2,
              RECORD: RECORD_TYPES.DESIGNATOR,
              Text: 'U1',
            } as AltiumRecord,
          ],
        } as AltiumRecord,
        {
          index: 3,
          RECORD: RECORD_TYPES.WIRE,
          X1: '0',
          Y1: '0',
          X2: '100',
          Y2: '0',
        } as AltiumRecord,
      ],
    };

    const nets = extractNets(schematic);
    const hasPin = nets.some((net) =>
      net.devices.some((device) => device.RECORD === RECORD_TYPES.PIN)
    );
    expect(hasPin).toBe(false);
  });

  it('should handle disconnected devices as separate nets', () => {
    const schematic: AltiumSchematic = {
      header: [],
      records: [
        {
          index: 0,
          RECORD: RECORD_TYPES.WIRE,
          X1: '0',
          Y1: '0',
          X2: '100',
          Y2: '0',
        } as AltiumRecord,
        {
          index: 1,
          RECORD: RECORD_TYPES.WIRE,
          X1: '1000',
          Y1: '1000',
          X2: '1100',
          Y2: '1000',
        } as AltiumRecord,
      ],
    };

    const nets = extractNets(schematic);
    expect(nets.length).toBe(2);
  });

  it('should chain connected wires into single net', () => {
    const schematic: AltiumSchematic = {
      header: [],
      records: [
        {
          index: 0,
          RECORD: RECORD_TYPES.WIRE,
          X1: '0',
          Y1: '0',
          X2: '100',
          Y2: '0',
        } as AltiumRecord,
        {
          index: 1,
          RECORD: RECORD_TYPES.WIRE,
          X1: '100',
          Y1: '0',
          X2: '200',
          Y2: '0',
        } as AltiumRecord,
        {
          index: 2,
          RECORD: RECORD_TYPES.WIRE,
          X1: '200',
          Y1: '0',
          X2: '300',
          Y2: '0',
        } as AltiumRecord,
      ],
    };

    const nets = extractNets(schematic);
    expect(nets.length).toBe(1);
    expect(nets[0].devices.length).toBe(3);
  });

  it('should connect power ports with same Text globally', () => {
    const schematic: AltiumSchematic = {
      header: [],
      records: [
        {
          index: 0,
          RECORD: RECORD_TYPES.POWER_PORT,
          Text: 'GND',
          'Location.X': '0',
          'Location.Y': '0',
        } as AltiumRecord,
        {
          index: 1,
          RECORD: RECORD_TYPES.POWER_PORT,
          Text: 'GND',
          'Location.X': '10000',
          'Location.Y': '10000',
        } as AltiumRecord,
      ],
    };

    const nets = extractNets(schematic);
    const gndNet = nets.find((n) => n.name === 'GND');
    expect(gndNet).toBeDefined();
    expect(gndNet!.devices.length).toBe(2);
  });

  it('should handle empty schematic', () => {
    const schematic: AltiumSchematic = {
      header: [],
      records: [],
    };

    const nets = extractNets(schematic);
    expect(nets).toEqual([]);
  });
});

describe('Pin coordinate calculation', () => {
  it('should calculate pin endpoint at 0 degrees rotation', () => {
    const schematic: AltiumSchematic = {
      header: [],
      records: [
        {
          index: 0,
          RECORD: RECORD_TYPES.PIN,
          'Location.X': '100',
          'Location.Y': '100',
          PinLength: '200',
          PinConglomerate: '0', // 0 * 90 = 0 degrees
        } as AltiumRecord,
      ],
    };

    const nets = extractNets(schematic);
    // Pin endpoint at (300, 100) = (100 + 200*cos(0), 100 + 200*sin(0))
    expect(nets[0].devices[0].coords).toEqual([scalePoint(100, 100), scalePoint(300, 100)]);
  });

  it('should calculate pin endpoint at 90 degrees rotation', () => {
    const schematic: AltiumSchematic = {
      header: [],
      records: [
        {
          index: 0,
          RECORD: RECORD_TYPES.PIN,
          'Location.X': '100',
          'Location.Y': '100',
          PinLength: '200',
          PinConglomerate: '1', // 1 * 90 = 90 degrees
        } as AltiumRecord,
      ],
    };

    const nets = extractNets(schematic);
    // Pin endpoint at (100, 300) = (100 + 200*cos(90), 100 + 200*sin(90))
    expect(nets[0].devices[0].coords).toEqual([scalePoint(100, 100), scalePoint(100, 300)]);
  });

  it('should handle fractional coordinates', () => {
    const schematic: AltiumSchematic = {
      header: [],
      records: [
        {
          index: 0,
          RECORD: RECORD_TYPES.PIN,
          'Location.X': '1',
          'Location.X_Frac': '2500',
          'Location.Y': '0',
          'Location.Y_Frac': '0',
          PinLength: '1',
          PinLength_Frac: '2500',
          PinConglomerate: '0',
        } as AltiumRecord,
        {
          index: 1,
          RECORD: RECORD_TYPES.WIRE,
          X1: '2',
          X1_Frac: '5000',
          Y1: '0',
          Y1_Frac: '0',
          X2: '3',
          X2_Frac: '0',
          Y2: '0',
          Y2_Frac: '0',
        } as AltiumRecord,
      ],
    };

    const nets = extractNets(schematic);
    expect(nets.length).toBe(1);
    expect(nets[0].devices.length).toBe(2);
  });
});

describe('Net naming', () => {
  it('should name net from net label', () => {
    const schematic: AltiumSchematic = {
      header: [],
      records: [
        {
          index: 0,
          RECORD: RECORD_TYPES.NET_LABEL,
          Text: 'DATA_BUS',
          'Location.X': '500',
          'Location.Y': '500',
        } as AltiumRecord,
        {
          index: 1,
          RECORD: RECORD_TYPES.WIRE,
          X1: '500',
          Y1: '500',
          X2: '600',
          Y2: '500',
        } as AltiumRecord,
      ],
    };

    const nets = extractNets(schematic);
    const dataBusNet = nets.find((n) => n.name === 'DATA_BUS');
    expect(dataBusNet).toBeDefined();
  });

  it('should leave name null when no naming source', () => {
    const schematic: AltiumSchematic = {
      header: [],
      records: [
        {
          index: 0,
          RECORD: RECORD_TYPES.WIRE,
          X1: '0',
          Y1: '0',
          X2: '100',
          Y2: '0',
        } as AltiumRecord,
      ],
    };

    const nets = extractNets(schematic);
    expect(nets[0].name).toBeNull();
  });
});

describe('determineNetList', () => {
  it('should return schematic with nets array added', () => {
    const schematic: AltiumSchematic = {
      header: [{ index: 0, HEADER: 'test' }],
      records: [
        {
          index: 1,
          RECORD: RECORD_TYPES.WIRE,
          X1: '0',
          Y1: '0',
          X2: '100',
          Y2: '0',
        } as AltiumRecord,
      ],
    };

    const result = determineNetList(schematic);
    expect(result.header).toEqual(schematic.header);
    expect(result.records).toEqual(schematic.records);
    expect(result.nets).toBeDefined();
    expect(Array.isArray(result.nets)).toBe(true);
  });
});
