/**
 * Replays the golden decision table in docs/decision-tables/component-notes
 * against the grouping the component tools use, one test per cell, so the
 * table and the code cannot drift.
 */
import path from "path";
import { describe, expect, it } from "vitest";
import { traverseCircuitFromNet } from "../circuit-traversal.js";
import {
  aggregateCircuitByMpn,
  componentNotes,
  groupComponentsByMpn,
} from "./component-grouping.js";
import type { AggregatedComponent, ComponentDetails, NetConnections } from "../types.js";
import { cellName, readTable } from "../../test/helpers/decision-table.js";

const TABLES = path.resolve(__dirname, "../../docs/decision-tables/component-notes");

describe("golden table: mpn-note", () => {
  const dims = ["mpn", "internal_pn", "stuffing", "path"];

  for (const row of readTable(TABLES, "mpn-note").filter((r) => r.outcome !== "n/a")) {
    it(cellName(row, dims), () => {
      // X1 is the part under test; R1 has an MPN, so the result is never empty.
      const components: ComponentDetails = {
        X1: {
          ...{ present: { mpn: "TPS62088" }, blank: { mpn: "   " }, absent: {} }[row.mpn],
          ...(row.internal_pn === "present" && { internal_pn: "INT-1001" }),
          ...(row.path !== "xnet_bare" && { description: "IC" }),
          ...(row.stuffing !== "fitted" && { dns: true }),
          pins: { "1": "SIG", "2": "GND" },
        },
        R1: { mpn: "RC0402", description: "Resistor", pins: { "1": "SIG", "2": "GND" } },
      };
      const nets: NetConnections = {
        SIG: { X1: ["1"], R1: ["1"] },
        GND: { X1: ["2"], R1: ["2"] },
      };
      const includeDns = row.stuffing !== "dns_left_out";

      const groups: Array<Pick<AggregatedComponent, "mpn" | "refdes" | "orientations">> =
        row.path === "group"
          ? groupComponentsByMpn(Object.entries(components), includeDns)
          : aggregateCircuitByMpn(
              traverseCircuitFromNet("SIG", nets, components, { includeDns }).components
            );
      const listed = groups.flatMap(
        (group) => group.refdes ?? group.orientations?.flatMap((o) => o.refdes) ?? []
      );
      const noted = componentNotes(groups).component_notes?.flatMap((n) => n.refdes) ?? [];

      expect(groups.some((group) => "notes" in group)).toBe(false);
      const got = !listed.includes("X1")
        ? "left out of result"
        : noted.includes("X1")
          ? "listed under MPN note"
          : "no note";
      expect(got).toBe(row.outcome);
    });
  }
});
