import path from "path";
import { loadNetlist } from "../load-netlist.js";
import { aggregateCircuitByMpn } from "../component-grouping.js";
import {
  naturalSort,
  traverseCircuitFromNet,
  computeCircuitHash,
  isGroundNet,
} from "../../circuit-traversal.js";
import {
  isErrorResult,
  getPinNet,
  type AggregatedCircuitResult,
  type ErrorResult,
} from "../../types.js";

/**
 * Query circuit starting from a net name.
 *
 * @param design - Path to design file
 * @param netName - Net name
 * @param skipTypes - Component types to skip
 * @param includeDns - Include DNS components
 */
export const queryXnetByNetName = async (
  design: string,
  netName: string,
  skipTypes: string[] = [],
  includeDns = false
): Promise<AggregatedCircuitResult | ErrorResult> => {
  const netlist = await loadNetlist(design);
  if (isErrorResult(netlist)) {
    return netlist;
  }

  const { nets, components } = netlist;

  if (!nets[netName]) {
    const designName = path.basename(design, path.extname(design));
    return {
      error: `Net '${netName}' not found in design '${designName}'. Use search_nets() to find available nets.`,
    };
  }

  if (isGroundNet(netName)) {
    return {
      error: `${netName} is a ground net and cannot be queried.`,
    };
  }

  const traversal = traverseCircuitFromNet(netName, nets, components, {
    skipTypes,
    includeDns,
  });

  const circuitHash = computeCircuitHash(traversal.components);
  const aggregated = aggregateCircuitByMpn(traversal.components);

  const response: AggregatedCircuitResult = {
    starting_point: netName,
    total_components: traversal.components.length,
    unique_configurations: aggregated.length,
    components_by_mpn: aggregated,
    visited_nets: traversal.visited_nets,
    circuit_hash: circuitHash,
  };

  if (Object.keys(traversal.skipped).length > 0) {
    response.skipped = traversal.skipped;
  }

  return response;
};

/**
 * Query circuit starting from a component pin.
 *
 * @param design - Path to design file
 * @param pinSpec - Pin specification in "REFDES.PIN" format
 * @param skipTypes - Component types to skip
 * @param includeDns - Include DNS components
 */
export const queryXnetByPinName = async (
  design: string,
  pinSpec: string,
  skipTypes: string[] = [],
  includeDns = false
): Promise<AggregatedCircuitResult | ErrorResult> => {
  const netlist = await loadNetlist(design);
  if (isErrorResult(netlist)) {
    return netlist;
  }

  const parts = pinSpec.split(".");
  if (parts.length !== 2) {
    return {
      error: `Invalid pin name '${pinSpec}'. Expected 'REFDES.PIN'.`,
    };
  }

  const [refdesInput, pinInput] = parts;
  const refdesEntry = Object.entries(netlist.components).find(
    ([refdes]) => refdes.toLowerCase() === refdesInput.trim().toLowerCase()
  );

  if (!refdesEntry) {
    const designName = path.basename(design, path.extname(design));
    return {
      error: `Component '${refdesInput}' not found in design '${designName}'. Use list_components() or search_components_by_refdes() to find available components.`,
    };
  }

  const [resolvedRefdes, component] = refdesEntry;
  const pinKey = Object.keys(component.pins).find(
    (pin) => pin.toLowerCase() === pinInput.trim().toLowerCase()
  );

  if (!pinKey) {
    const pins = Object.keys(component.pins).sort(naturalSort);
    return {
      error: `Pin '${pinSpec}' not found. Component ${resolvedRefdes} has pins: [${pins.join(", ")}]`,
    };
  }

  const connectedNet = getPinNet(component.pins[pinKey]);

  if (isGroundNet(connectedNet)) {
    return {
      error: `Pin ${resolvedRefdes}.${pinKey} is connected to ${connectedNet} (ground) and cannot be queried.`,
    };
  }

  if (connectedNet === "NC") {
    return {
      starting_point: `${resolvedRefdes}.${pinKey}`,
      net: "NC",
      total_components: 0,
      unique_configurations: 0,
      components_by_mpn: [],
      visited_nets: ["NC"],
      circuit_hash: `nc-${resolvedRefdes}.${pinKey}`,
    };
  }

  const { nets, components } = netlist;
  const traversal = traverseCircuitFromNet(connectedNet, nets, components, {
    skipTypes,
    includeDns,
  });

  const circuitHash = computeCircuitHash(traversal.components);
  const aggregated = aggregateCircuitByMpn(traversal.components);

  const response: AggregatedCircuitResult = {
    starting_point: `${resolvedRefdes}.${pinKey}`,
    net: connectedNet,
    total_components: traversal.components.length,
    unique_configurations: aggregated.length,
    components_by_mpn: aggregated,
    visited_nets: traversal.visited_nets,
    circuit_hash: circuitHash,
  };

  if (Object.keys(traversal.skipped).length > 0) {
    response.skipped = traversal.skipped;
  }

  return response;
};
