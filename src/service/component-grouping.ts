import { naturalSort } from "../circuit-traversal.js";
import {
  type ComponentDetails,
  type CircuitComponent,
  type AggregatedCircuitResult,
  type AggregatedComponent,
  type ComponentGroup,
} from "../types.js";

export const MPN_MISSING_NOTE =
  "MPN not found in exported netlist data. Tell user to update symbol properties in library, or to point you to the BOM";

/**
 * Group components by MPN for compact output.
 */
export const groupComponentsByMpn = (
  entries: Array<[string, ComponentDetails[string]]>,
  includeDns: boolean
): ComponentGroup[] => {
  const groups = new Map<
    string,
    {
      mpn?: string;
      description?: string;
      comment?: string;
      value?: string;
      dns?: boolean;
      notes?: string[];
      refdes: string[];
    }
  >();

  for (const [refdes, component] of entries) {
    const dns = component.dns ?? false;
    if (!includeDns && dns) {
      continue;
    }

    const mpnTrimmed = component.mpn?.trim() || undefined;
    const descriptionValue = component.description?.trim() || undefined;
    const commentValue = component.comment?.trim() || undefined;
    const valueValue = component.value?.trim() || undefined;

    const keyBase = mpnTrimmed ? `mpn:${mpnTrimmed}` : `refdes:${refdes}`;
    const groupKey = `${keyBase}||dns:${dns ? "1" : "0"}`;

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        ...(mpnTrimmed && { mpn: mpnTrimmed }),
        description: descriptionValue,
        comment: commentValue,
        value: valueValue,
        dns: dns || undefined,
        notes: mpnTrimmed ? undefined : [MPN_MISSING_NOTE],
        refdes: [],
      });
    } else if (valueValue && !groups.get(groupKey)!.value) {
      groups.get(groupKey)!.value = valueValue;
    }

    groups.get(groupKey)!.refdes.push(refdes);
  }

  return Array.from(groups.values())
    .map((group) => {
      const entry: ComponentGroup = {
        count: group.refdes.length,
        refdes: group.refdes.sort(naturalSort),
      };

      if (group.mpn !== undefined) {
        entry.mpn = group.mpn;
      }

      if (group.description !== undefined) {
        entry.description = group.description;
      }

      if (group.comment !== undefined) {
        entry.comment = group.comment;
      }

      if (group.value !== undefined) {
        entry.value = group.value;
      }

      if (group.dns !== undefined) {
        entry.dns = group.dns;
      }

      if (group.notes !== undefined) {
        entry.notes = group.notes;
      }

      return entry;
    })
    .sort((a, b) => (a.mpn ?? "").localeCompare(b.mpn ?? ""));
};

/**
 * Aggregate circuit components by MPN for compact output.
 */
export const aggregateCircuitByMpn = (
  components: CircuitComponent[]
): AggregatedCircuitResult["components_by_mpn"] => {
  const groups = new Map<
    string,
    {
      mpn?: string;
      description?: string;
      comment?: string;
      value?: string;
      dns?: boolean;
      notes?: string[];
      orientations: Map<
        string,
        {
          count: number;
          refdes: string[];
          connections: Array<{ net: string; pins: string[] }>;
        }
      >;
    }
  >();

  const unaggregatable: typeof components = [];

  for (const comp of components) {
    const mpn = comp.mpn?.trim() || undefined;
    const description = comp.description?.trim() || "";
    const value = comp.value?.trim() || undefined;
    const dnsFlag = comp.dns ? true : undefined;

    let aggregationKey: string;
    if (mpn) {
      aggregationKey = `mpn:${mpn}`;
    } else if (description) {
      aggregationKey = `desc:${description}`;
    } else {
      unaggregatable.push(comp);
      continue;
    }

    const nets = comp.connections.map((p) => p.net);
    const netPair = [...nets].sort().join("|");
    const groupKey = `${aggregationKey}||${netPair}||dns:${dnsFlag ? "1" : "0"}`;

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        ...(mpn && { mpn }),
        description: description || undefined,
        comment: comp.comment,
        value,
        dns: dnsFlag,
        notes: mpn ? undefined : [MPN_MISSING_NOTE],
        orientations: new Map(),
      });
    } else if (value && !groups.get(groupKey)!.value) {
      groups.get(groupKey)!.value = value;
    }

    const orientationKey = comp.connections.map((p) => `${p.pins.join(",")}:${p.net}`).join("|");
    const group = groups.get(groupKey)!;

    if (!group.orientations.has(orientationKey)) {
      group.orientations.set(orientationKey, {
        count: 0,
        refdes: [],
        connections: comp.connections,
      });
    }

    const orientation = group.orientations.get(orientationKey)!;
    orientation.count++;
    if (comp.refdes) {
      orientation.refdes.push(comp.refdes);
    }
  }

  const result: AggregatedComponent[] = [];

  for (const group of groups.values()) {
    const orientationsList = Array.from(group.orientations.values()).sort(
      (a, b) => b.count - a.count
    );

    const totalCount = orientationsList.reduce((sum, o) => sum + o.count, 0);

    const aggregated: AggregatedComponent = {
      total_count: totalCount,
    };

    if (group.mpn !== undefined) {
      aggregated.mpn = group.mpn;
    }

    if (group.description !== undefined) {
      aggregated.description = group.description;
    }
    if (group.comment !== undefined) {
      aggregated.comment = group.comment;
    }
    if (group.value !== undefined) {
      aggregated.value = group.value;
    }
    if (group.dns !== undefined) {
      aggregated.dns = group.dns;
    }
    if (group.notes !== undefined) {
      aggregated.notes = group.notes;
    }

    if (orientationsList.length === 1) {
      aggregated.refdes = orientationsList[0].refdes.sort(naturalSort);
      aggregated.connections = orientationsList[0].connections;
    } else {
      aggregated.orientations = orientationsList.map((o) => ({
        count: o.count,
        refdes: o.refdes.sort(naturalSort),
        connections: o.connections,
      }));
    }

    result.push(aggregated);
  }

  for (const comp of unaggregatable) {
    const unagg: AggregatedComponent = {
      refdes: [comp.refdes],
      notes: [MPN_MISSING_NOTE],
      total_count: 1,
      connections: comp.connections,
    };

    if (comp.description !== undefined) {
      unagg.description = comp.description;
    }
    if (comp.comment !== undefined) {
      unagg.comment = comp.comment;
    }
    if (comp.value !== undefined) {
      unagg.value = comp.value;
    }
    if (comp.dns) {
      unagg.dns = true;
    }

    result.push(unagg);
  }

  return result.sort((a, b) => b.total_count - a.total_count);
};
