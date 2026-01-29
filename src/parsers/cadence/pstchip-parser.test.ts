/**
 * Tests for pstchip parser
 *
 * Tests the parsing logic for Cadence pstchip.dat files which contain
 * chip definitions with pin name to pin number mappings.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { parsePstchip } from './pstchip-parser.js';

describe('parsePstchip', () => {
  const testDir = join(__dirname, '__test-pstchip__');
  const testFile = join(testDir, 'test.pstchip.dat');

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true, maxRetries: 3 });
    } catch (error) {
      console.warn('Test cleanup warning:', error);
    }
  });

  it('should parse part with pins and body properties', async () => {
    const content = `
primitive 'IC_PACKAGE'
pin
'A1':
PIN_NUMBER='(1)';
end_pin;
pin
'B2':
PIN_NUMBER='(2)';
end_pin;
body
HEIGHT='1.5mm';
WIDTH='10mm';
`;

    await writeFile(testFile, content);
    const result = await parsePstchip(testFile);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      part_name: 'IC_PACKAGE',
      pins: {
        A1: '1',
        B2: '2',
      },
      body_properties: {
        HEIGHT: '1.5mm',
        WIDTH: '10mm',
      },
    });
  });

  it('should parse multiple parts in one file', async () => {
    const content = `
primitive 'PART_A'
pin
'PIN1':
PIN_NUMBER='(1)';
end_pin;
body
TYPE='IC';

primitive 'PART_B'
pin
'GND':
PIN_NUMBER='(99)';
end_pin;
body
TYPE='CONNECTOR';
`;

    await writeFile(testFile, content);
    const result = await parsePstchip(testFile);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      part_name: 'PART_A',
      pins: { PIN1: '1' },
      body_properties: { TYPE: 'IC' },
    });
    expect(result[1]).toEqual({
      part_name: 'PART_B',
      pins: { GND: '99' },
      body_properties: { TYPE: 'CONNECTOR' },
    });
  });

  it('should handle empty file', async () => {
    await writeFile(testFile, '');
    const result = await parsePstchip(testFile);
    expect(result).toEqual([]);
  });

  it('should handle part with no pins or body properties', async () => {
    const content = `
primitive 'SIMPLE_PART'
`;

    await writeFile(testFile, content);
    const result = await parsePstchip(testFile);

    expect(result).toEqual([
      {
        part_name: 'SIMPLE_PART',
        pins: {},
        body_properties: {},
      },
    ]);
  });

  it('should handle special characters in pin names', async () => {
    const content = `
primitive 'COMPLEX_PART'
pin
'USB_D+':
PIN_NUMBER='(5)';
end_pin;
pin
'USB_D-':
PIN_NUMBER='(6)';
end_pin;
pin
'~RESET':
PIN_NUMBER='(12)';
end_pin;
`;

    await writeFile(testFile, content);
    const result = await parsePstchip(testFile);

    expect(result).toHaveLength(1);
    expect(result[0].pins).toEqual({
      'USB_D+': '5',
      'USB_D-': '6',
      '~RESET': '12',
    });
  });
});
