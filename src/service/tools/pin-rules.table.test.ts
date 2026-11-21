/**
 * Replays the golden pin ERC tables in docs/decision-tables/pin-erc against
 * pin-rules.ts, one test per cell.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cellName, readTable } from "../../../test/helpers/decision-table.js";
import type { PinType } from "../../types.js";
import {
  classifyNet,
  isUnconnectedSupply,
  netOutcome,
  type NetCell,
  type PinPlacement,
} from "./pin-rules.js";

const TABLES = path.resolve(__dirname, "../../../docs/decision-tables/pin-erc");

/** One pin list per value, so each cell is also built from real pin types and classified back. */
const PINS = {
  push_pull: { none: [], one: ["output"], many: ["output", "output"] },
  rail: {
    none: [],
    power: ["power", "power"],
    power_out: ["power_out", "power"],
    many_power_out: ["power_out", "power_out"],
  },
  other: {
    none: ["no_connect"],
    open: ["open_emitter", "bidirectional"],
    bus: ["tristate", "passive"],
    other: ["passive", undefined],
  },
  sinks: { none: [], some: ["input", "power_in"] },
} as const;

const typesFor = (row: Record<string, string>): (PinType | undefined)[] =>
  (Object.keys(PINS) as (keyof typeof PINS)[]).flatMap((dim) =>
    (PINS[dim] as Record<string, readonly (PinType | undefined)[]>)[row[dim]]
  );

describe("golden table: pin-erc net", () => {
  for (const row of readTable(TABLES, "net")) {
    it(cellName(row, Object.keys(PINS)), () => {
      const cell = classifyNet(typesFor(row));
      expect(cell).toEqual({
        push_pull: row.push_pull,
        rail: row.rail,
        other: row.other,
        sinks: row.sinks,
      } satisfies Record<keyof NetCell, string>);
      expect(netOutcome(cell)).toBe(row.outcome);
    });
  }
});

describe("golden table: pin-erc pin", () => {
  const TYPE: Record<string, PinType> = {
    power: "power",
    power_in: "power_in",
    power_out: "power_out",
    other: "input",
  };
  for (const row of readTable(TABLES, "pin")) {
    it(cellName(row, ["type", "placement"]), () => {
      const flagged = isUnconnectedSupply(TYPE[row.type], row.placement as PinPlacement);
      expect(flagged ? "unconnected error" : "clean").toBe(row.outcome);
    });
  }
});
