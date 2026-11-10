import type { ServiceContext } from "../context.js";
import { getDesignName } from "../../paths.js";
import { loadNetlist } from "../load-netlist.js";
import { aggregateCircuitByMpn, componentNotes } from "../component-grouping.js";
import { describeAmbiguity, describeResolution, indexNetNames } from "../net-names.js";
import { componentError, displayRefdes, isDuplicateKey } from "../../duplicate-refdes.js";
import {
  naturalSort,
  traverseCircuitFromNet,
  computeCircuitHash,
  groundNameNote,
  isGroundNet,
  looksLikeGround,
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
 * @param designVariant - Native design variant, or `<Default>` for the base build
 */
export const queryXnetByNetName = async (
  design: string,
  netName: string,
  skipTypes: string[] = [],
  includeDns: boolean,
  designVariant: string | undefined,
  context: ServiceContext
): Promise<AggregatedCircuitResult | ErrorResult> => {
  const netlist = await loadNetlist(design, designVariant, context);
  if (isErrorResult(netlist)) {
    return netlist;
  }

  const { nets, components } = netlist;
  const names = indexNetNames(netlist);

  const resolution = names.resolve(netName);
  if (resolution.status === "missing") {
    const designName = getDesignName(design, context.root);
    return {
      error: `Net '${netName}' not found in design '${designName}'. Use search_nets() to find available nets.`,
    };
  }
  if (resolution.status === "ambiguous") {
    return { error: describeAmbiguity(netName, resolution) };
  }
  const net = resolution.net;

  if (isGroundNet(net)) {
    return {
      error: `${net} is a ground net and cannot be queried.`,
    };
  }

  const traversal = traverseCircuitFromNet(net, nets, components, {
    skipTypes,
    includeDns,
  });

  const circuitHash = computeCircuitHash(traversal.components);
  const aggregated = aggregateCircuitByMpn(traversal.components, (key) =>
    componentError(netlist, key)
  );

  const response: AggregatedCircuitResult = {
    design_variant: netlist.design_variant,
    starting_point: netName,
    total_components: traversal.components.length,
    unique_configurations: aggregated.length,
    components_by_mpn: aggregated,
    ...componentNotes(aggregated),
    visited_nets: traversal.visited_nets,
    circuit_hash: circuitHash,
  };

  if (Object.keys(traversal.skipped).length > 0) {
    response.skipped = traversal.skipped;
  }

  const notes: string[] = [];
  if (resolution.status !== "exact") {
    response.net = net;
    notes.push(describeResolution(netName, resolution));
  }
  if (looksLikeGround(net)) notes.push(groundNameNote(net));
  if (notes.length > 0) response.notes = notes;
  const warnings = names.warningsFor([net, ...traversal.visited_nets]);
  if (warnings.length > 0) response.net_name_warnings = warnings;

  return response;
};

/**
 * Query circuit starting from a component pin.
 *
 * @param design - Path to design file
 * @param pinSpec - Pin specification in "REFDES.PIN" format
 * @param skipTypes - Component types to skip
 * @param includeDns - Include DNS components
 * @param designVariant - Native design variant, or `<Default>` for the base build
 */
export const queryXnetByPinName = async (
  design: string,
  pinSpec: string,
  skipTypes: string[] = [],
  includeDns: boolean,
  designVariant: string | undefined,
  context: ServiceContext
): Promise<AggregatedCircuitResult | ErrorResult> => {
  const netlist = await loadNetlist(design, designVariant, context);
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
  const matches = Object.entries(netlist.components).filter(
    ([refdes]) => displayRefdes(refdes).toLowerCase() === refdesInput.trim().toLowerCase()
  );
  const refdesEntry = matches[0];

  if (matches.some(([key]) => isDuplicateKey(key))) {
    const refdes = displayRefdes(refdesEntry[0]);
    const pin = pinInput.trim().toLowerCase();
    const candidates = matches.map(([, component]) => {
      const pinKey = Object.keys(component.pins).find((p) => p.toLowerCase() === pin);
      const where = pinKey
        ? `pin ${pinKey} on ${getPinNet(component.pins[pinKey])}`
        : "no such pin";
      return `${component.mpn?.trim() || component.value?.trim() || "part"} (${where})`;
    });
    return {
      error: `Pin '${pinSpec}' is ambiguous: reference designator ${refdes} is duplicated on ${matches.length} different parts: ${candidates.join(", ")}. query_component('${refdes}') lists every part; trace from the net instead.`,
    };
  }

  if (!refdesEntry) {
    const designName = getDesignName(design, context.root);
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
      design_variant: netlist.design_variant,
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
  const aggregated = aggregateCircuitByMpn(traversal.components, (key) =>
    componentError(netlist, key)
  );

  const response: AggregatedCircuitResult = {
    design_variant: netlist.design_variant,
    starting_point: `${resolvedRefdes}.${pinKey}`,
    net: connectedNet,
    total_components: traversal.components.length,
    unique_configurations: aggregated.length,
    components_by_mpn: aggregated,
    ...componentNotes(aggregated),
    visited_nets: traversal.visited_nets,
    circuit_hash: circuitHash,
  };

  if (Object.keys(traversal.skipped).length > 0) {
    response.skipped = traversal.skipped;
  }

  if (looksLikeGround(connectedNet)) response.notes = [groundNameNote(connectedNet)];

  const warnings = indexNetNames(netlist).warningsFor([connectedNet, ...traversal.visited_nets]);
  if (warnings.length > 0) response.net_name_warnings = warnings;

  return response;
};
