// Library entry point
export {
  createNetlistService,
  serviceFor,
  type NetlistService,
  type NetlistServiceOptions,
  type NetlistServiceSecrets,
} from "./netlist-service.js";
export { serviceContextFromEnvironment, type ServiceContext } from "./context.js";
export {
  nodeFileReader,
  parserContextFromEnvironment,
  type DirEntry,
  type FileReader,
  type KicadCliOptions,
  type ParserContext,
} from "../parsers/context.js";

// Tools, as the positional functions this module has always exported
export {
  listDesigns,
  listComponents,
  listNets,
  searchNets,
  searchComponentsByRefdes,
  searchComponentsByMpn,
  searchComponentsByDescription,
  queryComponent,
  queryXnetByNetName,
  queryXnetByPinName,
  runErc,
} from "./positional.js";
export type { ListDesignsOptions } from "./tools/list-designs.js";
export type { ErcOptions, ErcResult } from "./tools/run-erc.js";
export {
  exportCadenceNetlist,
  detectCadenceVersions,
  getLatestCadence,
  resolveExportDir,
  relocateLockFile,
  restoreLockFile,
} from "./tools/cadence-export.js";

// Shared modules
export { loadNetlist, type LoadedNetlist } from "./load-netlist.js";
export {
  MPN_MISSING_NOTE,
  componentNotes,
  groupComponentsByMpn,
  aggregateCircuitByMpn,
} from "./component-grouping.js";
export { parseRegexPattern } from "./regex-helpers.js";

// Re-export types from types.js
export type {
  ParsedNetlist,
  ErrorResult,
  ListComponentsResult,
  ListNetsResult,
  SearchComponentsResult,
  SearchNetsResult,
  QueryComponentResult,
  AggregatedCircuitResult,
  CadenceInstall,
  ExportNetlistResult,
  ComponentGroup,
  ComponentNote,
  AggregatedComponent,
  ComponentDetails,
  CircuitComponent,
  PinEntry,
} from "../types.js";

export { isErrorResult } from "../types.js";
