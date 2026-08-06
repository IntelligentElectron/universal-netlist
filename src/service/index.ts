// Tools
export { listDesigns, type ListDesignsOptions } from "./tools/list-designs.js";
export { listComponents } from "./tools/list-components.js";
export { listNets } from "./tools/list-nets.js";
export { searchNets } from "./tools/search-nets.js";
export {
  searchComponentsByRefdes,
  searchComponentsByMpn,
  searchComponentsByDescription,
} from "./tools/search-components.js";
export { queryComponent } from "./tools/query-component.js";
export { queryXnetByNetName, queryXnetByPinName } from "./tools/query-xnet.js";
export { runErc, type ErcOptions, type ErcResult } from "./tools/run-erc.js";
export {
  exportCadenceNetlist,
  detectCadenceVersions,
  getLatestCadence,
  resolveExportDir,
  relocateLockFile,
  restoreLockFile,
} from "./tools/cadence-export.js";

// Shared modules
export { loadNetlist } from "./load-netlist.js";
export {
  MPN_MISSING_NOTE,
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
  AggregatedComponent,
  ComponentDetails,
  CircuitComponent,
  PinEntry,
} from "../types.js";

export { isErrorResult } from "../types.js";
