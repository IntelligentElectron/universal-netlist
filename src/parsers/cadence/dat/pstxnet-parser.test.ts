/**
 * Tests for pstxnet parser
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { parsePstxnet, parsePstxnetContent } from './pstxnet-parser.js';

describe('parsePstxnetContent', () => {
  it('should parse a simple netlist with one net and two components', () => {
    const content = `
NET_NAME
'NET_A'
NODE_NAME R1 1
NODE_NAME U1 2
NET_NAME
'NET_B'
NODE_NAME R1 2
NODE_NAME C1 1
`;

    const result = parsePstxnetContent(content);

    expect(result).toEqual({
      NET_A: {
        R1: ['1'],
        U1: ['2'],
      },
      NET_B: {
        R1: ['2'],
        C1: ['1'],
      },
    });
  });

  it('should handle multiple pins on the same component', () => {
    const content = `
NET_NAME
'VDD'
NODE_NAME U1 1
NODE_NAME U1 3
NODE_NAME U1 5
NODE_NAME R1 1
`;

    const result = parsePstxnetContent(content);

    expect(result).toEqual({
      VDD: {
        U1: ['1', '3', '5'],
        R1: ['1'],
      },
    });
  });

  it('should handle empty netlist', () => {
    const content = '';
    const result = parsePstxnetContent(content);
    expect(result).toEqual({});
  });

  it('should handle netlist with no connections', () => {
    const content = `
NET_NAME
'FLOATING_NET'
`;

    const result = parsePstxnetContent(content);

    expect(result).toEqual({
      FLOATING_NET: {},
    });
  });

  it('should handle nets with special characters in names', () => {
    const content = `
NET_NAME
'PP3V3_SYS'
NODE_NAME U11 12
NODE_NAME C23 1
NET_NAME
'I2C_SCL'
NODE_NAME U5 10
NODE_NAME R10 2
`;

    const result = parsePstxnetContent(content);

    expect(result).toEqual({
      PP3V3_SYS: {
        U11: ['12'],
        C23: ['1'],
      },
      I2C_SCL: {
        U5: ['10'],
        R10: ['2'],
      },
    });
  });
});

describe('parsePstxnet', () => {
  const testDir = join(process.cwd(), '__test-pstxnet__');
  const testFile = join(testDir, 'test.pstxnet.dat');

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // Ignore cleanup errors in tests
    }
  });

  it('should parse a simple netlist from file', async () => {
    const content = `
NET_NAME
'NET_A'
NODE_NAME R1 1
NODE_NAME U1 2
`;

    await writeFile(testFile, content);
    const result = await parsePstxnet(testFile);

    expect(result).toEqual({
      NET_A: {
        R1: ['1'],
        U1: ['2'],
      },
    });
  });
});
