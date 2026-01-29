/**
 * Altium Record Parser
 *
 * Parses the binary FileHeader stream from Altium .SchDoc files
 * into structured record objects.
 *
 * Based on the Python Altium-Schematic-Parser library parsing logic.
 */

import type { AltiumRecord, AltiumSchematic } from './types.js';

/**
 * Split buffer by the 5-byte delimiter pattern.
 *
 * The pattern is: XXX\x00\x00| where XXX are any 3 bytes
 * We look for the \x00\x00| sequence and include the 3 bytes before it
 */
const splitByDelimiter = (buffer: Buffer): Buffer[] => {
  const segments: Buffer[] = [];
  let start = 0;

  for (let i = 0; i < buffer.length - 2; i++) {
    // Look for \x00\x00|
    if (
      buffer[i] === 0x00 &&
      buffer[i + 1] === 0x00 &&
      buffer[i + 2] === 0x7c // '|'
    ) {
      // The delimiter includes 3 bytes before \x00\x00|
      // So we capture up to i-3 (or start if we're at the beginning)
      const delimiterStart = Math.max(start, i - 3);
      if (delimiterStart > start) {
        segments.push(buffer.subarray(start, delimiterStart));
      }
      // Skip past the delimiter (3 bytes + \x00\x00|)
      start = i + 3;
      i = start - 1; // Will be incremented by loop
    }
  }

  // Add the last segment
  if (start < buffer.length) {
    segments.push(buffer.subarray(start));
  }

  return segments;
};

/**
 * Parse a single segment into a record object.
 *
 * Format: KEY=VALUE|KEY=VALUE|...
 */
const parseSegment = (segment: Buffer, index: number): AltiumRecord => {
  const record: AltiumRecord = { index };

  // Convert to string, handling potential encoding issues
  const str = segment.toString('utf-8');

  // Split by pipe character
  const pairs = str.split('|');

  for (const pair of pairs) {
    if (!pair) continue;

    // Split by first equals sign only (value may contain '=')
    const eqIndex = pair.indexOf('=');
    if (eqIndex === -1) continue;

    const key = pair.substring(0, eqIndex).trim();
    const value = pair.substring(eqIndex + 1);

    if (key) {
      // Store with original key casing
      record[key] = value;
    }
  }

  return record;
};

/**
 * Parse the FileHeader stream buffer into an AltiumSchematic structure.
 *
 * The stream format uses a 5-byte delimiter pattern: XXX\x00\x00|
 * where XXX are 3 arbitrary bytes (length indicator).
 */
export const parseRecords = (buffer: Buffer): AltiumSchematic => {
  // Skip first 5 bytes and last byte (as per Python implementation)
  const trimmedBuffer = buffer.subarray(5, buffer.length - 1);

  // Split by the delimiter pattern: .{3}\x00\x00|
  // This pattern is: 3 bytes (length) + 2 null bytes + pipe
  const segments = splitByDelimiter(trimmedBuffer);

  // Parse each segment into a record
  const datums: AltiumRecord[] = [];

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment.length === 0) continue;

    const record = parseSegment(segment, i);
    if (Object.keys(record).length > 1) {
      // Has more than just index
      datums.push(record);
    }
  }

  // Separate header records from other records
  const header = datums.filter((d) => 'HEADER' in d);
  const records = datums.filter((d) => 'RECORD' in d);

  return { header, records };
};

/**
 * Find all records matching a key-value pair.
 */
export const findRecords = (
  schematic: AltiumSchematic,
  key: string,
  value: string
): AltiumRecord[] => {
  const found: AltiumRecord[] = [];

  const searchRecord = (record: AltiumRecord): void => {
    if (record[key] === value) {
      found.push(record);
    }
    if (record.children) {
      for (const child of record.children) {
        searchRecord(child);
      }
    }
  };

  for (const record of schematic.records) {
    searchRecord(record);
  }

  return found;
};
