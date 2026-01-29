/**
 * Parser for Cadence .pstxprt.dat files
 * Extracts component details (MPN, description)
 */

import { readFile } from 'fs/promises';
import type { ComponentDetails } from '../../types.js';

/**
 * Result from parsing pstxprt.dat
 * - components: Component details (mpn, description, pins)
 * - partNames: Map of refdes to Cadence part name (for cross-referencing with pstchip.dat)
 */
export interface PstxprtResult {
  components: ComponentDetails;
  partNames: Map<string, string>;
}

/**
 * Parse a .pstxprt.dat file and extract component information.
 * Returns both components and a partNames map for cross-referencing.
 */
export const parsePstxprt = async (filePath: string): Promise<PstxprtResult> => {
  const content = await readFile(filePath, 'utf-8');
  return parsePstxprtContent(content);
};

/**
 * Parse pstxprt file content (pure function for testing).
 */
export const parsePstxprtContent = (content: string): PstxprtResult => {
  const lines = content.split('\n').map((line) => line.trim());

  const componentDetails: ComponentDetails = {};
  const partNames = new Map<string, string>();
  let currentRefdes: string | null = null;
  let currentPartName: string | null = null;
  let currentProperties: Record<string, string> = {};

  const saveCurrentComponent = (): void => {
    if (currentRefdes !== null) {
      const component: ComponentDetails[string] = { pins: {} };

      // MPN: use MFGR_PN if available, otherwise fall back to part name string
      const mpn = currentProperties['MFGR_PN'] || currentPartName || null;
      component.mpn = mpn;

      const description = currentProperties['DESCR'];
      if (description) {
        component.description = description;
      }

      componentDetails[currentRefdes] = component;

      // Store part name separately for cross-referencing with pstchip.dat
      if (currentPartName) {
        partNames.set(currentRefdes, currentPartName);
      }
    }
  };

  for (const line of lines) {
    // PART_NAME alone is a section header; PART_NAME='...' is a property
    if (line === 'PART_NAME') {
      saveCurrentComponent();
      currentRefdes = null;
      currentPartName = null;
      currentProperties = {};
    } else if (currentRefdes === null && line) {
      // Component line ends with ':' or ':;'
      if (line.includes(' ') && (line.endsWith(':') || line.endsWith(':;'))) {
        const match = line.match(/^(\S+)\s+'([^']+)'/);
        if (match) {
          currentRefdes = match[1];
          currentPartName = match[2];
        } else {
          const [refdes] = line.split(' ', 1);
          currentRefdes = refdes;
        }
      }
    } else if (line.includes('=')) {
      const [key, ...valueParts] = line.split('=');
      const value = valueParts
        .join('=')
        .trim()
        .replace(/^['"]|['";,]+$/g, '');
      currentProperties[key.trim()] = value;
    }
  }

  saveCurrentComponent();

  return { components: componentDetails, partNames };
};
