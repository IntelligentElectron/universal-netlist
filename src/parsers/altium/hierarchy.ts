/**
 * Altium Hierarchy Builder
 *
 * Converts a flat list of records into a hierarchical structure
 * using the OwnerIndex property to establish parent-child relationships.
 */

import type { AltiumRecord, AltiumSchematic } from './types.js';

/**
 * Build hierarchy from flat record list.
 *
 * Records with no OwnerIndex become root nodes.
 * Records with OwnerIndex are added as children to their owner.
 */
export const buildHierarchy = (schematic: AltiumSchematic): AltiumSchematic => {
  // Deep clone the records to avoid mutating the original
  const recordsCopy: AltiumRecord[] = schematic.records.map((r) => JSON.parse(JSON.stringify(r)));

  const hierarchy: AltiumRecord[] = [];

  // First pass: ensure all records have their index set
  for (let i = 0; i < recordsCopy.length; i++) {
    recordsCopy[i].index = i;
  }

  // Second pass: build parent-child relationships
  for (const current of recordsCopy) {
    const ownerIndexStr = current.OwnerIndex ?? current.OWNERINDEX;

    if (ownerIndexStr === undefined || ownerIndexStr === null || ownerIndexStr === '') {
      // No owner - this is a root record
      hierarchy.push(current);
    } else {
      // Has an owner - add as child
      const ownerIndex = parseInt(ownerIndexStr as string, 10);

      if (ownerIndex >= 0 && ownerIndex < recordsCopy.length) {
        const owner = recordsCopy[ownerIndex];

        if (!owner.children) {
          owner.children = [];
        }
        owner.children.push(current);
      } else {
        // Invalid owner index - treat as root
        hierarchy.push(current);
      }
    }
  }

  return {
    header: schematic.header,
    records: hierarchy,
  };
};

/**
 * Flatten a hierarchical schematic back to a list.
 */
export const flattenHierarchy = (schematic: AltiumSchematic): AltiumRecord[] => {
  const flat: AltiumRecord[] = [];

  const traverse = (record: AltiumRecord): void => {
    flat.push(record);
    if (record.children) {
      for (const child of record.children) {
        traverse(child);
      }
    }
  };

  for (const record of schematic.records) {
    traverse(record);
  }

  return flat;
};

/**
 * Get parts list (components only).
 *
 * Filters for RECORD="1" which represents components/parts.
 */
export const getPartsList = (schematic: AltiumSchematic): AltiumRecord[] => {
  return schematic.records.filter((r) => r.RECORD === '1');
};

/**
 * Find a record by its index.
 */
export const findRecordByIndex = (
  schematic: AltiumSchematic,
  index: number
): AltiumRecord | undefined => {
  const search = (records: AltiumRecord[]): AltiumRecord | undefined => {
    for (const record of records) {
      if (record.index === index) {
        return record;
      }
      if (record.children) {
        const found = search(record.children);
        if (found) return found;
      }
    }
    return undefined;
  };

  return search(schematic.records);
};
