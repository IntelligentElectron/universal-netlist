/**
 * Altium Schematic Parser
 *
 * Parses Altium Designer .SchDoc files into the unified ParsedNetlist format.
 * Port of the Python Altium-Schematic-Parser library:
 * https://github.com/a3ng7n/Altium-Schematic-Parser
 *
 * Supports output formats:
 * - all-list: All records in a flattened list
 * - all-hierarchy: All records in owner/child hierarchy
 * - parts-list: Components/parts only
 * - net-list: Nets with connected devices
 */

import type {
  ParsedNetlist,
  NetConnections,
  ComponentDetails,
  PinEntry,
} from "../../types.js";
import { createPinEntry } from "../../types.js";
import type {
  AltiumSchematic,
  AltiumNet,
  AltiumRecord,
  OutputFormat,
} from "./types.js";
import {
  RECORD_TYPES,
  RECORD_TYPE_NAMES,
  PIN_ELECTRICAL_TYPES,
  POWER_PORT_STYLES,
} from "./types.js";
import { OleReader, readOleStream } from "./ole-reader.js";
import { parseRecords, findRecords } from "./record-parser.js";
import {
  buildHierarchy,
  getPartsList,
  flattenHierarchy,
  findRecordByIndex,
} from "./hierarchy.js";
import { extractNets, determineNetList } from "./net-extractor.js";

// Re-export types and utilities for external use
export type { AltiumSchematic, AltiumNet, AltiumRecord, OutputFormat };
export {
  RECORD_TYPES,
  RECORD_TYPE_NAMES,
  PIN_ELECTRICAL_TYPES,
  POWER_PORT_STYLES,
};
export { OleReader };
export { parseRecords, findRecords };
export { buildHierarchy, getPartsList, flattenHierarchy };
export { extractNets, determineNetList };

// Re-export schemas for validation
export * from "./schemas.js";

/**
 * Get component designator from a pin's parent.
 */
const getDesignatorFromPin = (
  pin: AltiumRecord,
  schematic: AltiumSchematic,
): string | null => {
  // Look up the parent component using OwnerIndex
  const ownerIndexValue = pin.OwnerIndex ?? pin.OWNERINDEX;
  if (
    ownerIndexValue !== undefined &&
    ownerIndexValue !== null &&
    ownerIndexValue !== ""
  ) {
    const ownerIndex = parseInt(String(ownerIndexValue), 10);
    const parent = findRecordByIndex(schematic, ownerIndex);

    if (parent?.children) {
      // Find the designator child (RECORD=34 with Text field)
      const designatorChild = parent.children.find(
        (c) => c.RECORD === RECORD_TYPES.DESIGNATOR,
      );
      const designatorText =
        designatorChild?.Text ??
        designatorChild?.TEXT ??
        designatorChild?.Name ??
        designatorChild?.NAME;
      if (
        designatorText !== undefined &&
        designatorText !== null &&
        designatorText !== ""
      ) {
        return String(designatorText);
      }
    }
  }

  return null;
};

/**
 * Get pin number from a pin record.
 *
 * Altium uses camelCase: Designator is the pin number (1, 2, 3...)
 * and Name is the pin function (VBAT, VCC, GND...)
 */
const getPinNumber = (pin: AltiumRecord): string | null => {
  // Try Designator first (pin number)
  if (
    pin.Designator !== undefined &&
    pin.Designator !== null &&
    pin.Designator !== ""
  ) {
    return String(pin.Designator);
  }
  if (
    pin.DESIGNATOR !== undefined &&
    pin.DESIGNATOR !== null &&
    pin.DESIGNATOR !== ""
  ) {
    return String(pin.DESIGNATOR);
  }
  // Fallback to Name (pin function name)
  if (pin.Name !== undefined && pin.Name !== null && pin.Name !== "") {
    return String(pin.Name);
  }
  if (pin.NAME !== undefined && pin.NAME !== null && pin.NAME !== "") {
    return String(pin.NAME);
  }

  return null;
};

/**
 * Convert Altium nets to ParsedNetlist NetConnections format.
 *
 * Transform: AltiumNet[] -> { netName: { refdes: [pinNumbers] } }
 */
const convertNets = (
  nets: AltiumNet[],
  schematic: AltiumSchematic,
): NetConnections => {
  const result: NetConnections = {};
  let unnamedNetCounter = 1;

  for (const net of nets) {
    const pinDevices = net.devices.filter(
      (device) => device.RECORD === RECORD_TYPES.PIN,
    );
    const hasNonPinDevices = net.devices.some(
      (device) => device.RECORD !== RECORD_TYPES.PIN,
    );

    if (pinDevices.length === 1 && !hasNonPinDevices) {
      continue;
    }

    // Generate name if not assigned
    const netName = net.name ?? `UnnamedNet${unnamedNetCounter++}`;

    // Group pins by their component (refdes)
    const pinsByComponent: Record<string, string[]> = {};

    for (const device of net.devices) {
      if (device.RECORD === RECORD_TYPES.PIN) {
        // Find the component refdes from parent
        const designator = getDesignatorFromPin(device, schematic);
        const pinNumber = getPinNumber(device);

        if (designator && pinNumber) {
          if (!pinsByComponent[designator]) {
            pinsByComponent[designator] = [];
          }
          if (!pinsByComponent[designator].includes(pinNumber)) {
            pinsByComponent[designator].push(pinNumber);
          }
        }
      }
    }

    // Only add net if it has pin connections
    if (Object.keys(pinsByComponent).length > 0) {
      result[netName] = pinsByComponent;
    }
  }

  return result;
};

/**
 * Populate component pin-to-net mappings from the nets data.
 *
 * The nets structure is: { netName: { refdes: [pinNumbers] } }
 * We need to reverse this to populate: components[refdes].pins[pin] = netName
 */
const populatePinNets = (
  components: ComponentDetails,
  nets: NetConnections,
): void => {
  for (const [netName, connections] of Object.entries(nets)) {
    for (const [refdes, pins] of Object.entries(connections)) {
      const component = components[refdes];
      if (!component) {
        continue;
      }

      for (const pin of pins) {
        const entry = component.pins[pin];
        if (typeof entry === "string") {
          component.pins[pin] = netName;
        } else if (entry) {
          entry.net = netName;
        } else {
          component.pins[pin] = netName;
        }
      }
    }
  }
};

const resolveComment = (
  comment: string | undefined,
  parameters: Record<string, string>,
): string | undefined => {
  if (!comment) {
    return undefined;
  }

  const trimmed = comment.trim();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed.startsWith("=")) {
    const reference = trimmed.slice(1).trim();
    if (!reference) {
      return undefined;
    }

    const resolved = parameters[reference.toLowerCase()];
    if (resolved && resolved.trim()) {
      return resolved.trim();
    }

    return undefined;
  }

  return trimmed;
};

const pinMatchesCurrentPart = (
  pin: AltiumRecord,
  part: AltiumRecord,
): boolean => {
  const partId = part.CURRENTPARTID ?? part.CurrentPartId ?? part.CurrentPartID;
  const pinPartId = pin.OwnerPartId ?? pin.OWNERPARTID;
  if (
    partId === undefined ||
    partId === null ||
    partId === "" ||
    pinPartId === undefined ||
    pinPartId === null ||
    pinPartId === ""
  ) {
    return true;
  }

  return String(partId) === String(pinPartId);
};

const getPinName = (pin: AltiumRecord): string | undefined => {
  const name = pin.Name ?? pin.NAME;
  if (name !== undefined && name !== null && name !== "") {
    return String(name);
  }
  return undefined;
};

/**
 * Extract component details from a hierarchical schematic.
 */
export const extractComponents = (
  schematic: AltiumSchematic,
): ComponentDetails => {
  const components: ComponentDetails = {};

  // Get all parts (RECORD=1)
  const parts = getPartsList(schematic);

  for (const part of parts) {
    // Designator is in a child record with RECORD=34 and Text field
    let refdes: string | undefined;
    if (part.children) {
      const designatorChild = part.children.find(
        (c) => c.RECORD === RECORD_TYPES.DESIGNATOR,
      );
      const designatorText =
        designatorChild?.Text ??
        designatorChild?.TEXT ??
        designatorChild?.Name ??
        designatorChild?.NAME;
      if (
        designatorText !== undefined &&
        designatorText !== null &&
        designatorText !== ""
      ) {
        refdes = String(designatorText);
      }
    }
    if (!refdes) continue;

    // Extract component properties from child RECORD=41 (parameter) records
    // Altium stores MPN in a parameter child with Name="Manufacturer Part Number"
    let mpn: string | undefined;
    let comment: string | undefined;
    const parameters: Record<string, string> = {};

    if (part.children) {
      for (const child of part.children) {
        if (child.RECORD === RECORD_TYPES.PARAMETER) {
          const nameValue = child.Name ?? child.NAME;
          const textValue = child.Text ?? child.TEXT;

          if (
            nameValue === undefined ||
            nameValue === null ||
            nameValue === "" ||
            textValue === undefined ||
            textValue === null ||
            textValue === ""
          ) {
            continue;
          }

          const name = String(nameValue).trim();
          const text = String(textValue).trim();

          if (name) {
            parameters[name.toLowerCase()] = text;
          }

          if (name === "Manufacturer Part Number") {
            mpn = text;
          } else if (name === "Comment") {
            comment = text;
          }
        }
      }
    }

    comment = resolveComment(comment, parameters);
    const rawValue = parameters["value"];
    const value = rawValue?.trim() || undefined;
    if (comment && value && comment === value) {
      comment = undefined;
    }

    // Fallback MPN sources from component-level fields
    // Note: LibReference is NOT an MPN - it's a library symbol reference (e.g., "22u" or a hash)
    if (!mpn) {
      mpn =
        (part.PartNumber as string) ||
        (part.Mpn as string) ||
        (part.PARTNUMBER as string) ||
        (part["MPN"] as string) ||
        undefined;
    }

    // Description from component record or parameters (try both camelCase and UPPERCASE variants)
    const extractedDescription =
      (part.ComponentDescription as string) ||
      (part.Description as string) ||
      // Legacy UPPERCASE fallbacks
      (part.DESCRIPTION as string) ||
      undefined;

    // Build pin mapping from children
    const pins: Record<string, PinEntry> = {};

    if (part.children) {
      for (const child of part.children) {
        if (child.RECORD === RECORD_TYPES.PIN) {
          if (!pinMatchesCurrentPart(child, part)) {
            continue;
          }
          const pinNum = getPinNumber(child);
          const pinName = getPinName(child);
          if (pinNum) {
            // Initialize with empty string or name placeholder; will be populated by populatePinNets()
            pins[pinNum] = createPinEntry(pinNum, pinName, "");
          }
        }
      }
    }

    const component: ComponentDetails[string] = {
      mpn,
      description: extractedDescription,
      pins,
    };

    if (comment !== undefined) {
      component.comment = comment;
    }

    if (value !== undefined) {
      component.value = value;
    }

    components[refdes] = component;
  }

  return components;
};

/**
 * Parse Altium .SchDoc file into unified ParsedNetlist schema.
 *
 * This is the main entry point for integration with NetlistService.
 */
export const parseAltium = async (
  schdocPath: string,
): Promise<ParsedNetlist> => {
  // 1. Read OLE file and extract FileHeader stream
  const buffer = readOleStream(schdocPath);

  // 2. Parse binary stream into records
  const schematic = parseRecords(buffer);

  // 3. Build hierarchy from flat records
  const hierarchical = buildHierarchy(schematic);

  // 4. Extract nets
  const nets = extractNets(hierarchical);

  // 5. Convert to ParsedNetlist format
  const parsedNets = convertNets(nets, hierarchical);
  const components = extractComponents(hierarchical);

  // 6. Populate component pin-to-net mappings from the nets data
  populatePinNets(components, parsedNets);

  return {
    nets: parsedNets,
    components,
  };
};

/**
 * Parse Altium file with a specific output format (matching Python API).
 */
export const parse = (
  schdocPath: string,
  format: OutputFormat = "all-hierarchy",
):
  | AltiumSchematic
  | { records: AltiumRecord[] }
  | (AltiumSchematic & { nets: AltiumNet[] }) => {
  // Read and parse the file
  const buffer = readOleStream(schdocPath);
  const schematic = parseRecords(buffer);

  switch (format) {
    case "all-list":
      return schematic;

    case "all-hierarchy":
      return buildHierarchy(schematic);

    case "parts-list":
      return {
        records: getPartsList(buildHierarchy(schematic)),
      };

    case "net-list":
      return determineNetList(buildHierarchy(schematic));

    default:
      return buildHierarchy(schematic);
  }
};

// Import discovery functions and handler interface
import {
  discoverAltiumDesigns,
  findAltiumSchDocs,
  isAltiumFile,
  ALTIUM_EXTENSIONS,
} from "./discovery.js";
import type { EDAProjectFormatHandler } from "../../types.js";

export {
  discoverAltiumDesigns,
  findAltiumSchDocs,
  isAltiumFile,
} from "./discovery.js";

/**
 * Parse an Altium project by parsing all its SchDoc files and merging the results.
 */
const parseAltiumProject = async (
  projectPath: string,
): Promise<ParsedNetlist> => {
  const schdocPaths = await findAltiumSchDocs(projectPath);

  if (schdocPaths.length === 0) {
    throw new Error(`No schematic documents found for project ${projectPath}`);
  }

  // Parse all SchDoc files and merge results
  const allNets: NetConnections = {};
  const allComponents: ComponentDetails = {};

  for (const schdocPath of schdocPaths) {
    const result = await parseAltium(schdocPath);

    // Merge nets
    for (const [netName, connections] of Object.entries(result.nets)) {
      if (!allNets[netName]) {
        allNets[netName] = {};
      }
      for (const [refdes, pins] of Object.entries(connections)) {
        if (!allNets[netName][refdes]) {
          allNets[netName][refdes] = pins;
        } else {
          const existing = allNets[netName][refdes];
          const existingArray = Array.isArray(existing) ? existing : [existing];
          const newPins = Array.isArray(pins) ? pins : [pins];
          allNets[netName][refdes] = [
            ...new Set([...existingArray, ...newPins]),
          ];
        }
      }
    }

    // Merge components
    for (const [refdes, component] of Object.entries(result.components)) {
      if (!allComponents[refdes]) {
        allComponents[refdes] = component;
      }
    }
  }

  return {
    nets: allNets,
    components: allComponents,
  };
};

/**
 * Altium EDA project format handler.
 * Supports Altium Designer projects (.PrjPcb).
 */
export const altiumHandler: EDAProjectFormatHandler = {
  name: "altium",
  extensions: ALTIUM_EXTENSIONS,

  canHandle: isAltiumFile,

  discoverDesigns: discoverAltiumDesigns,

  parse: parseAltiumProject,
};
