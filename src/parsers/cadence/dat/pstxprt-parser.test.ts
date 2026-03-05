/**
 * Tests for pstxprt parser
 *
 * Tests the parsing logic for Cadence pstxprt.dat files which contain
 * component properties like descriptions and manufacturer part numbers.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { parsePstxprt } from './pstxprt-parser.js';

describe('parsePstxprt', () => {
  const testDir = join(__dirname, '__test-pstxprt__');
  const testFile = join(testDir, 'test.pstxprt.dat');

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

  it('should parse component with description only (mpn falls back to part name)', async () => {
    const content = `
PART_NAME
U1 'IC_PACKAGE':
DESCR='Microcontroller Unit';
PART_NAME
R1 'RES_0603':
DESCR='Resistor 10K';
`;

    await writeFile(testFile, content);
    const { components, partNames } = await parsePstxprt(testFile);

    expect(components).toEqual({
      U1: {
        mpn: 'IC_PACKAGE', // Falls back to part name when MFGR_PN is missing
        description: 'Microcontroller Unit',
        pins: {},
      },
      R1: {
        mpn: 'RES_0603', // Falls back to part name when MFGR_PN is missing
        description: 'Resistor 10K',
        pins: {},
      },
    });
    expect(partNames.get('U1')).toBe('IC_PACKAGE');
    expect(partNames.get('R1')).toBe('RES_0603');
  });

  it('should parse component with MPN', async () => {
    const content = `
PART_NAME
U5 'IC_CHIP':
MFGR_PN='STM32F103';
DESCR='ARM Cortex-M3 MCU';
`;

    await writeFile(testFile, content);
    const { components, partNames } = await parsePstxprt(testFile);

    expect(components).toEqual({
      U5: {
        mpn: 'STM32F103',
        description: 'ARM Cortex-M3 MCU',
        pins: {},
      },
    });
    expect(partNames.get('U5')).toBe('IC_CHIP');
  });

  it('should handle empty file', async () => {
    await writeFile(testFile, '');
    const { components, partNames } = await parsePstxprt(testFile);
    expect(components).toEqual({});
    expect(partNames.size).toBe(0);
  });

  it('should handle component with no properties (mpn falls back to part name)', async () => {
    const content = `
PART_NAME
C1 'CAP_0805':
`;

    await writeFile(testFile, content);
    const { components, partNames } = await parsePstxprt(testFile);

    expect(components).toEqual({
      C1: {
        mpn: 'CAP_0805', // Falls back to part name when MFGR_PN is missing
        pins: {},
      },
    });
    expect(partNames.get('C1')).toBe('CAP_0805');
  });

  it('should handle properties with special characters', async () => {
    const content = `
PART_NAME
U10 'MODULE_BGA':
DESCR='USB Type-C Controller (Rev. A)';
MFGR_PN='TUSB320HAIRWBR';
`;

    await writeFile(testFile, content);
    const { components, partNames } = await parsePstxprt(testFile);

    expect(components).toEqual({
      U10: {
        mpn: 'TUSB320HAIRWBR',
        description: 'USB Type-C Controller (Rev. A)',
        pins: {},
      },
    });
    expect(partNames.get('U10')).toBe('MODULE_BGA');
  });

  it('should fall back to part name string when MFGR_PN is missing', async () => {
    const content = `
PART_NAME
C1 'CAP_10UF_Y5V_10V_10%_0805':
DESCR='CAP, CER, 10UF';
`;

    await writeFile(testFile, content);
    const { components, partNames } = await parsePstxprt(testFile);

    expect(components).toEqual({
      C1: {
        mpn: 'CAP_10UF_Y5V_10V_10%_0805',
        description: 'CAP, CER, 10UF',
        pins: {},
      },
    });
    expect(partNames.get('C1')).toBe('CAP_10UF_Y5V_10V_10%_0805');
  });

  it('should prefer MFGR_PN over part name string when both exist', async () => {
    const content = `
PART_NAME
U1 'TPS65217_QFN':
MFGR_PN='TPS65217CRSLR';
DESCR='Power Management IC';
`;

    await writeFile(testFile, content);
    const { components, partNames } = await parsePstxprt(testFile);

    expect(components).toEqual({
      U1: {
        mpn: 'TPS65217CRSLR',
        description: 'Power Management IC',
        pins: {},
      },
    });
    // partNames still stores the Cadence part name for cross-referencing
    expect(partNames.get('U1')).toBe('TPS65217_QFN');
  });

  it('should handle component lines ending with :; (HDL format)', async () => {
    // Real format from BeagleBone Black pstxprt.dat
    const content = `
PART_NAME
 C1 'CAP_10UF_Y5V_10V_10%_0805_805_10UF,10V':;

SECTION_NUMBER 1
 '@BEAGLEBONEBLK_C.BEAGLEBONEBLACK(SCH_1):INS21459032@MASTER.CAP_10UF_Y5V_10V_10%_0805.NORMAL(CHIPS)':
 PRIM_FILE='.\\pstchip.dat',
 XY='(390,150)';

PART_NAME
 U2 'PWR_TPS65217_2_U_48_RSL_TPS65217C':;

SECTION_NUMBER 1
 '@BEAGLEBONEBLK_C.BEAGLEBONEBLACK(SCH_1):INS21416200@MASTER.PWR_TPS65217_2_U_48_RSL.NORMAL(CHIPS)':
 PRIM_FILE='.\\pstchip.dat';
`;

    await writeFile(testFile, content);
    const { components, partNames } = await parsePstxprt(testFile);

    expect(components['C1']).toEqual({
      mpn: 'CAP_10UF_Y5V_10V_10%_0805_805_10UF,10V',
      pins: {},
    });
    expect(components['U2']).toEqual({
      mpn: 'PWR_TPS65217_2_U_48_RSL_TPS65217C',
      pins: {},
    });
    expect(partNames.get('C1')).toBe('CAP_10UF_Y5V_10V_10%_0805_805_10UF,10V');
    expect(partNames.get('U2')).toBe('PWR_TPS65217_2_U_48_RSL_TPS65217C');
  });
});
