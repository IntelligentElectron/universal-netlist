/**
 * Parser for Cadence .pstxnet.dat files
 * Extracts net connections in the format: { netName: { refdes: [pinNumbers] } }
 */

import { readFile } from 'fs/promises';
import type { NetConnections } from '../../types.js';

/**
 * Parse a .pstxnet.dat file and extract net connections.
 * Pure function that reads from disk and returns parsed data.
 */
export const parsePstxnet = async (filePath: string): Promise<NetConnections> => {
  const content = await readFile(filePath, 'utf-8');
  return parsePstxnetContent(content);
};

/**
 * Parse pstxnet file content (pure function for testing).
 */
export const parsePstxnetContent = (content: string): NetConnections => {
  const lines = content.split('\n').map((line) => line.trim());

  const netConnections: NetConnections = {};
  let currentNet: string | null = null;
  let currentPins: Array<[string, string]> = [];

  const saveCurrentNet = (): void => {
    if (currentNet !== null) {
      const netDict: { [refdes: string]: string[] } = {};
      for (const [refdes, pinNumber] of currentPins) {
        if (!netDict[refdes]) {
          netDict[refdes] = [];
        }
        netDict[refdes].push(pinNumber);
      }
      netConnections[currentNet] = netDict;
    }
  };

  for (const line of lines) {
    if (line === 'NET_NAME') {
      saveCurrentNet();
      currentNet = null;
      currentPins = [];
    } else if (currentNet === null && line.startsWith("'") && line.endsWith("'")) {
      currentNet = line.slice(1, -1);
    } else if (line.startsWith('NODE_NAME')) {
      const parts = line.split(/\s+/);
      if (parts.length >= 3) {
        const refdes = parts[1];
        const pinNumber = parts[2];
        currentPins.push([refdes, pinNumber]);
      }
    }
  }

  saveCurrentNet();

  return netConnections;
};
