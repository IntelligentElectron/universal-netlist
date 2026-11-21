/**
 * Replays the golden decision table in docs/decision-tables/diff-pairs against the KiCad
 * and Altium parsers, one test per cell, so the table and the code cannot drift.
 */
import path from "path";
import { describe, expect, it } from "vitest";
import { parseKicadNetlist } from "./kicad/netlist-parser.js";
import { kicadPairPartner } from "./kicad/diff-pairs.js";
import { parseDocument } from "./altium/document.js";
import { pairDifferentialNets } from "./altium/netlist.js";
import { buildHierarchy } from "./altium/records.js";
import { RECORD_TYPES, type AltiumRecord } from "./altium/types.js";
import type { ParsedNetlist } from "../types.js";
import { cellName, readTable } from "../../test/helpers/decision-table.js";

const TABLES = path.resolve(__dirname, "../../docs/decision-tables/diff-pairs");

interface Cell {
  naming: "paired" | "lone" | "plain";
  directive: "both" | "one" | "none";
  supply: boolean;
}

/** The two nets a cell names: a pair, a pair name without its partner, or plain names. */
const NETS: Record<Cell["naming"], [string, string]> = {
  paired: ["USB_D_P", "USB_D_N"],
  lone: ["USB_D_P", "OTHER"],
  plain: ["DATA", "OTHER"],
};

/** U1 pins 1 and 2 on the cell's two nets, each with a resistor pin, as KiCad exports them. */
const kicad = ({ naming, supply }: Cell): ParsedNetlist => {
  const [first, second] = NETS[naming];
  return parseKicadNetlist(`
(export
  (components
    (comp (ref "U1") (value "PHY"))
    (comp (ref "R1") (value "22"))
    (comp (ref "R2") (value "22")))
  (nets
    (net (code "1") (name "${first}")
      (node (ref "U1") (pin "1") (pintype "${supply ? "power_in" : "bidirectional"}"))
      (node (ref "R1") (pin "1") (pintype "passive")))
    (net (code "2") (name "${second}")
      (node (ref "U1") (pin "2") (pintype "bidirectional"))
      (node (ref "R2") (pin "1") (pintype "passive")))))
`);
};

/**
 * U1 pins 1 and 2, each on a wire under a net label of the cell's names, written as an
 * Altium sheet; a Differential Pair directive sits on the first wire, or on both.
 */
const altium = ({ naming, directive, supply }: Cell): ParsedNetlist => {
  const at = (x: number, y: number) => ({ "Location.X": String(x), "Location.Y": String(y) });
  const records: Omit<AltiumRecord, "index">[] = [
    { RECORD: RECORD_TYPES.COMPONENT },
    { RECORD: RECORD_TYPES.DESIGNATOR, OwnerIndex: "0", Text: "U1" },
  ];
  NETS[naming].forEach((name, i) => {
    const y = 100 + 200 * i;
    records.push(
      {
        RECORD: RECORD_TYPES.PIN,
        OwnerIndex: "0",
        Designator: String(i + 1),
        Electrical: supply && i === 0 ? "7" : "1",
        PinLength: "0",
        PinConglomerate: "0",
        ...at(100, y),
      },
      {
        RECORD: RECORD_TYPES.WIRE,
        LocationCount: "2",
        X1: "100",
        Y1: String(y),
        X2: "200",
        Y2: String(y),
      },
      { RECORD: RECORD_TYPES.NET_LABEL, Text: name, ...at(200, y) }
    );
    if (directive === "both" || (directive === "one" && i === 0)) {
      const owner = records.length;
      records.push(
        { RECORD: RECORD_TYPES.PARAMETER_SET, ...at(150, y) },
        {
          RECORD: RECORD_TYPES.PARAMETER,
          OwnerIndex: String(owner),
          Name: "DifferentialPair",
          Text: "True",
        }
      );
    }
  });
  const { netlist } = parseDocument({
    path: "sheet.SchDoc",
    name: "sheet.schdoc",
    bundleLinks: [],
    hierarchical: buildHierarchy({
      header: [],
      records: records.map((record, index) => ({ ...record, index })),
    }),
  });
  pairDifferentialNets(netlist);
  return netlist;
};

describe("golden table: diff-pairs", () => {
  const dims = ["format", "naming", "directive", "supply"];
  const parse = { kicad, altium } as Record<string, (cell: Cell) => ParsedNetlist>;

  for (const row of readTable(TABLES, "pair").filter((r) => r.outcome !== "n/a")) {
    it(cellName(row, dims), () => {
      const cell: Cell = {
        naming: row.naming as Cell["naming"],
        directive: row.directive as Cell["directive"],
        supply: row.supply === "supply_pin",
      };
      const netlist = parse[row.format](cell);
      const [first, second] = NETS[cell.naming];
      expect(Object.keys(netlist.nets).sort()).toEqual([first, second].sort());
      if (row.outcome === "pair") {
        expect(netlist.netProperties).toEqual({
          [first]: { DIFFERENTIAL_PAIR: "USB_D" },
          [second]: { DIFFERENTIAL_PAIR: "USB_D" },
        });
      } else {
        expect(row.outcome).toBe("no pair");
        expect(netlist.netProperties).toBeUndefined();
      }
    });
  }
});

describe("KiCad pairs that would share a name", () => {
  it("are each named after their positive net", () => {
    const net = (name: string, ref: string) =>
      `(net (name "${name}") (node (ref "${ref}") (pin "1") (pintype "passive")) (node (ref "U1") (pin "${ref}") (pintype "bidirectional")))`;
    const { netProperties } = parseKicadNetlist(`
(export
  (components (comp (ref "U1")) (comp (ref "R1")) (comp (ref "R2")) (comp (ref "R3")) (comp (ref "R4")) (comp (ref "R5")) (comp (ref "R6")))
  (nets ${net("/D+", "R1")} ${net("/D-", "R2")} ${net("/DP", "R3")} ${net("/DN", "R4")} ${net("/E_P", "R5")} ${net("/E_N", "R6")}))
`);
    expect(netProperties).toEqual({
      "/D+": { DIFFERENTIAL_PAIR: "/D+" },
      "/D-": { DIFFERENTIAL_PAIR: "/D+" },
      "/DP": { DIFFERENTIAL_PAIR: "/DP" },
      "/DN": { DIFFERENTIAL_PAIR: "/DP" },
      "/E_P": { DIFFERENTIAL_PAIR: "/E" },
      "/E_N": { DIFFERENTIAL_PAIR: "/E" },
    });
  });
});

describe("KiCad's pair naming (BOARD::MatchDpSuffix)", () => {
  it.each([
    ["USB_D+", "USB_D-", "USB_D"],
    ["/USB_DN", "/USB_DP", "/USB_D"],
    ["TRD0_P", "TRD0_N", "TRD0"],
    ["LVDS_P0", "LVDS_N0", "LVDS_0"],
    ["CLK_P_1", "CLK_N_1", "CLK_1"],
    ["/Channel 0/+", "/Channel 0/-", "/Channel 0/"],
  ])("%s pairs with %s as %s", (name, partner, pair) => {
    expect(kicadPairPartner(name)).toEqual({ partner, pair });
    expect(kicadPairPartner(partner)).toEqual({ partner: name, pair });
  });

  it.each(["GND", "VCC_3V3", "+3V3", "Net-(D1-K)", "USB_DM", "+", "_P"])(
    "%s has no partner",
    (name) => {
      expect(kicadPairPartner(name)).toBeUndefined();
    }
  );
});
