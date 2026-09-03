/**
 * DSN Structure Type IDs
 *
 * From OpenOrCadParser/src/Enums/Structure.hpp.
 * Only netlist-critical types are included.
 */

export enum StructureType {
  SthInPages0 = 2,
  PartCell = 6,
  Page = 10,
  PartInstance = 11,
  DrawnInstance = 12,
  PlacedInstance = 13,
  T0x10 = 16,
  WireScalar = 20,
  WireBus = 21,
  Port = 23,
  LibraryPart = 24,
  SymbolPinScalar = 26,
  SymbolPinBus = 27,
  BusEntry = 29,
  Package = 31,
  Device = 32,
  GlobalSymbol = 33,
  PortSymbol = 34,
  OffPageSymbol = 35,
  Global = 37,
  OffPageConnector = 38,
  SymbolDisplayProp = 39,
  Alias = 49,
  T0x34 = 52,
  T0x35 = 53,
  TitleBlockSymbol = 64,
  TitleBlock = 65,
  ERCObject = 77,
  PinShapeSymbol = 98,
  NetGroup = 103,
}

export interface CachedLibraryPart {
  pinNames: string[];
  defaultValue?: string;
}

export interface PinMapData {
  pinMaps: Map<string, (string | null)[]>;
  cachePinMaps: Map<string, (string | null)[]>;
  deviceUnitRefs: Map<string, string[]>;
  /**
   * Per-pin "Pin Ignore" flags parallel to `pinMaps`. A section of a
   * multi-section package that has no pad for one of the part's logical pins
   * marks that pin ignored, and Cadence's netlist writer leaves it out.
   */
  pinIgnores: Map<string, boolean[]>;
  /**
   * Per-pin "Pin Ignore" flags parallel to `cachePinMaps`. Kept separate from
   * `pinIgnores` because the two streams can describe different pin counts for
   * the same key: a connector may be 20 entries in `Packages/` and 23 in the
   * Cache, so one array cannot index both.
   */
  cachePinIgnores: Map<string, boolean[]>;
}

export const structureTypeName: Partial<Record<StructureType, string>> = {
  [StructureType.Page]: "Page",
  [StructureType.DrawnInstance]: "DrawnInstance",
  [StructureType.PlacedInstance]: "PlacedInstance",
  [StructureType.T0x10]: "T0x10",
  [StructureType.WireScalar]: "WireScalar",
  [StructureType.WireBus]: "WireBus",
  [StructureType.Port]: "Port",
  [StructureType.Package]: "Package",
  [StructureType.Device]: "Device",
  [StructureType.Global]: "Global",
  [StructureType.OffPageConnector]: "OffPageConnector",
  [StructureType.SymbolDisplayProp]: "SymbolDisplayProp",
  [StructureType.Alias]: "Alias",
};
