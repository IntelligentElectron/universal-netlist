/**
 * Replays the golden tables in docs/decision-tables/kicad-schematic against
 * the raw reader's naming rules, one test per cell.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cellName, readTable } from "../../../../test/helpers/decision-table.js";
import {
  KICAD_7_FORMAT,
  PRIORITY,
  better,
  pinNetName,
  powerNetName,
  type Driver,
  type PinNode,
} from "./connectivity.js";

const TABLES = path.resolve(__dirname, "../../../../docs/decision-tables/kicad-schematic");

describe("golden table: net-name", () => {
  const dims = ["a", "b", "priority", "depth", "name"];
  for (const row of readTable(TABLES, "net-name").filter((r) => r.outcome !== "n/a")) {
    it(cellName(row, dims), () => {
      const power = (kind: string) => kind === "power_or_global";
      // Priorities inside each class, so the relation the cell names holds; a
      // power symbol or global label against anything else always outranks it.
      const priorityOf = (side: "a" | "b") => {
        const kind = row[side];
        const [up, down] = power(kind)
          ? [PRIORITY.global, PRIORITY.power]
          : [PRIORITY.local, PRIORITY.hier];
        if (row.priority === "equal") return down;
        const wins = row.priority === (side === "a" ? "a_higher" : "b_higher");
        if (power(row.a) !== power(row.b)) return power(kind) ? PRIORITY.power : PRIORITY.local;
        return wins ? up : down;
      };
      const driver = (side: "a" | "b"): Driver => ({
        name: row.name === (side === "a" ? "a_lower" : "b_lower") ? "/A/NET" : "/B/NET",
        priority: priorityOf(side),
        depth: row.depth === (side === "a" ? "a_shallower" : "b_shallower") ? 0 : 1,
        ...(row[side] === "hier_bus"
          ? { bus: "hierarchical" as const }
          : row[side] === "sheet_bus"
            ? { bus: "sheet" as const }
            : {}),
      });
      const [a, b] = [driver("a"), driver("b")];
      expect(better(a, b) ? "a names the net" : "b names the net").toBe(row.outcome);
      // The relation is antisymmetric: swapping the two flips the answer.
      expect(better(b, a)).toBe(!better(a, b));
    });
  }
});

describe("golden table: pin-net-name", () => {
  const dims = ["named", "units", "connection", "shares_name"];
  for (const row of readTable(TABLES, "pin-net-name").filter((r) => r.outcome !== "n/a")) {
    it(cellName(row, dims), () => {
      const pin = {
        reference: "U1",
        unitReference: row.units === "multi" ? "U1A" : "U1",
        pin: "3",
        name: row.named === "yes" ? "SDA" : "~",
        type: "bidirectional",
        sharesName: row.shares_name === "yes",
      } as PinNode;
      expect(pinNetName(pin, row.connection === "unconnected")).toBe(row.outcome);
    });
  }
});

describe("golden table: power-name", () => {
  const dims = ["format", "value"];
  for (const row of readTable(TABLES, "power-name")) {
    it(cellName(row, dims), () => {
      const version = row.format === "kicad6" ? 20211123 : KICAD_7_FORMAT;
      const value = { set: "+3V3_MAIN", empty: "", tilde: "~" }[row.value]!;
      const name = powerNetName(version, value, "VCC");
      expect(name === "VCC" ? "power pin name" : "value").toBe(row.outcome);
    });
  }
});
