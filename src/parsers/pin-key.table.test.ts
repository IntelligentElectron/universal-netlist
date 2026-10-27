/**
 * Replays the golden decision table in docs/decision-tables/pin-keys against the KiCad
 * and Altium parsers, one test per cell, so the table and the code cannot drift.
 */
import path from "path";
import { describe, expect, it } from "vitest";
import { parseKicadNetlist } from "./kicad/netlist-parser.js";
import { parseDocument } from "./altium/document.js";
import { buildHierarchy } from "./altium/records.js";
import { RECORD_TYPES, type AltiumRecord } from "./altium/types.js";
import { getPinNet, type ParsedNetlist } from "../types.js";
import { cellName, readTable } from "../../test/helpers/decision-table.js";

const TABLES = path.resolve(__dirname, "../../docs/decision-tables/pin-keys");

interface Cell {
  number: boolean;
  name: boolean;
  refdes: boolean;
  /** Where U1's other pin with the same key is: nowhere, on SIG, or on FIRST. */
  shares: "none" | "same net" | "earlier net";
}

/**
 * U1's pin, on net SIG with C1 pin 1, written as a KiCad netlist export. A pin sharing
 * its key comes before it, on SIG or on FIRST, the net listed first.
 */
const kicad = ({ number, name, refdes, shares }: Cell): ParsedNetlist => {
  const pin = number ? "7" : "";
  const node = [
    "(node",
    refdes ? `(ref "U1")` : "",
    `(pin "${pin}")`,
    name ? `(pinfunction "EN_${pin}")` : "",
    ")",
  ].join(" ");
  return parseKicadNetlist(`
(export
  (components
    (comp (ref "U1") (value "Buck"))
    (comp (ref "C1") (value "100n")))
  (nets
    (net (code "1") (name "FIRST") ${shares === "earlier net" ? node : ""})
    (net (code "2") (name "SIG")
      (node (ref "C1") (pin "1"))
      ${shares === "same net" ? node : ""}
      ${node})))
`);
};

/**
 * U1's pin, wired to C1 pin 1 under power port SIG, written as an Altium sheet. A pin
 * sharing its key sits on SIG's wire, or on its own wire under power port FIRST.
 */
const altium = ({ number, name, refdes, shares }: Cell): ParsedNetlist => {
  const at = (x: number, y = 100) => ({ "Location.X": String(x), "Location.Y": String(y) });
  const pin = (owner: number, designator: string, location: object, pinName?: string) => ({
    RECORD: RECORD_TYPES.PIN,
    OwnerIndex: String(owner),
    Designator: designator,
    ...(pinName ? { Name: pinName } : {}),
    ...location,
    PinLength: "0",
    PinConglomerate: "0",
  });
  const wire = (x1: number, x2: number, y = 100) => ({
    RECORD: RECORD_TYPES.WIRE,
    LocationCount: "2",
    ...{ X1: String(x1), Y1: String(y), X2: String(x2), Y2: String(y) },
  });
  const u1Pin = (location: object) => pin(0, number ? "7" : "", location, name ? "EN" : undefined);
  const records: Omit<AltiumRecord, "index">[] = [
    { RECORD: RECORD_TYPES.COMPONENT },
    { RECORD: RECORD_TYPES.DESIGNATOR, OwnerIndex: "0", Text: refdes ? "U1" : "" },
    u1Pin(at(100)),
    { RECORD: RECORD_TYPES.COMPONENT },
    { RECORD: RECORD_TYPES.DESIGNATOR, OwnerIndex: "3", Text: "C1" },
    pin(3, "1", at(200)),
    wire(100, 150),
    wire(150, 200),
    { RECORD: RECORD_TYPES.POWER_PORT, Text: "SIG", ...at(200) },
    ...(shares === "same net" ? [u1Pin(at(150))] : []),
    ...(shares === "earlier net"
      ? [
          u1Pin(at(100, 300)),
          wire(100, 200, 300),
          { RECORD: RECORD_TYPES.POWER_PORT, Text: "FIRST", ...at(200, 300) },
        ]
      : []),
  ];
  return parseDocument({
    path: "sheet.SchDoc",
    name: "sheet.schdoc",
    bundleLinks: [],
    hierarchical: buildHierarchy({
      header: [],
      records: records.map((record, index) => ({ ...record, index })),
    }),
  }).netlist;
};

describe("golden table: pin-key", () => {
  const dims = ["format", "number", "name", "refdes", "shares"];
  const parse = { kicad, altium } as Record<string, (cell: Cell) => ParsedNetlist>;

  for (const row of readTable(TABLES, "pin-key").filter((r) => r.outcome !== "n/a")) {
    it(cellName(row, dims), () => {
      const { nets, components } = parse[row.format]({
        number: row.number === "present",
        name: row.name === "present",
        refdes: row.refdes === "present",
        shares: row.shares as Cell["shares"],
      });
      expect(nets.SIG?.C1).toEqual(["1"]);
      const key = row.number === "present" ? "7" : "EN";
      const onNets = Object.keys(nets).filter((net) => nets[net].U1 !== undefined);

      if (row.outcome === "dropped") {
        expect(onNets).toEqual([]);
      } else if (row.outcome === "kept on its first net only") {
        // KiCad lists FIRST first; Altium settles the order while tracing the sheet.
        expect(onNets).toHaveLength(1);
        if (row.format === "kicad") expect(onNets).toEqual(["FIRST"]);
        expect(nets[onNets[0]].U1).toEqual([key]);
        expect(getPinNet(components.U1.pins[key])).toBe(onNets[0]);
      } else {
        expect(row.outcome).toBe(`keyed by ${row.number === "present" ? "number" : "name"}`);
        expect(onNets).toEqual(["SIG"]);
        expect(nets.SIG.U1).toEqual([key]);
        expect(Object.keys(components.U1.pins)).toEqual([key]);
      }
    });
  }
});
