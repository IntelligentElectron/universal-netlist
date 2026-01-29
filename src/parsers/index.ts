/**
 * EDA Project Format Registry
 *
 * Unified discovery and parsing across all supported EDA tools.
 * To add a new format (e.g., KiCad):
 * 1. Create parsers/kicad/ folder with discovery.ts and index.ts
 * 2. Implement EDAProjectFormatHandler in index.ts
 * 3. Import and register the handler here
 */

import type { DiscoveredDesign, ParsedNetlist, EDAProjectFormatHandler } from '../types.js';
import { cadenceHandler } from './cadence/index.js';
import { altiumHandler } from './altium/index.js';

// Re-export handlers for direct access
export { cadenceHandler } from './cadence/index.js';
export { altiumHandler } from './altium/index.js';

/**
 * Registry of all supported EDA project format handlers.
 * Add new handlers here to support additional EDA tools.
 */
const handlers: EDAProjectFormatHandler[] = [cadenceHandler, altiumHandler];

/**
 * Find a handler that can process the given file path.
 */
export const findHandler = (filePath: string): EDAProjectFormatHandler | undefined =>
  handlers.find((h) => h.canHandle(filePath));

/**
 * Discover all designs of all supported formats in a directory.
 */
export const discoverDesigns = async (rootDir: string): Promise<DiscoveredDesign[]> => {
  const results = await Promise.all(handlers.map((h) => h.discoverDesigns(rootDir)));
  return results.flat().sort((a, b) => a.name.localeCompare(b.name));
};

/**
 * Parse a design file using the appropriate handler.
 */
export const parseDesign = async (designPath: string): Promise<ParsedNetlist> => {
  const handler = findHandler(designPath);
  if (!handler) {
    throw new Error(`Unsupported design format: ${designPath}`);
  }
  return handler.parse(designPath);
};

/**
 * Get all registered handlers.
 */
export const getHandlers = (): readonly EDAProjectFormatHandler[] => handlers;

/**
 * Get all supported file extensions across all handlers.
 */
export const getSupportedExtensions = (): string[] =>
  handlers.flatMap((h) => [...h.extensions]);
