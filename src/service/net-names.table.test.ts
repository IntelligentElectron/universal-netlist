/**
 * Replays the golden decision tables in docs/decision-tables/net-names against
 * NetNameIndex, one test per cell, so the tables and the code cannot drift.
 */
import path from "path";
import { describe, expect, it } from "vitest";
import { NetNameIndex } from "./net-names.js";
import type { NetLabelSource } from "../types.js";
import { cellName, readTable } from "../../test/helpers/decision-table.js";

const TABLES = path.resolve(__dirname, "../../docs/decision-tables/net-names");

describe("golden table: resolve", () => {
  const dims = ["input", "ws_matches", "trunc_matches", "format"];
  // A 31-character key, so long nets extending it are its PSTWRITER 16.6 cut.
  const KEY = "PTA0/JTAG_TCLK/SWD_CLK/EZP_CLK/";
  const count = { "0": 0, "1": 1, many: 2 } as Record<string, number>;

  for (const row of readTable(TABLES, "resolve").filter((r) => r.outcome !== "n/a")) {
    it(cellName(row, dims), () => {
      const blank = row.input === "blank";
      const wsNets = blank ? [" ", "  "] : [` ${KEY}`, `${KEY} `];
      const names = [
        "OTHER",
        ...wsNets.slice(0, count[row.ws_matches]),
        ...[`${KEY}X`, `${KEY}Y`].slice(0, count[row.trunc_matches]),
      ];
      const input = { exact: KEY, plain: KEY, padded: `${KEY}  `, blank: "   " }[row.input]!;
      if (row.input === "exact") names.push(KEY);
      const index = new NetNameIndex(names, { allegro: row.format === "cadence" });
      const got = index.resolve(input);

      const expected: Record<string, string> = {
        exact: "exact",
        missing: "missing",
        "match by whitespace": "whitespace",
        "match by 31-char cut": "truncated",
      };
      if (row.outcome.startsWith("ambiguous: ")) {
        const reason = row.outcome.slice("ambiguous: ".length).split(" ").join("_");
        expect(got).toMatchObject({ status: "ambiguous", reason });
      } else {
        expect(got.status).toBe(expected[row.outcome]);
      }
    });
  }
});

describe("golden table: warning", () => {
  const dims = ["whitespace", "collides", "format"];
  const alias = (text: string): NetLabelSource => ({
    kind: "net_alias",
    text,
    page: "PAGE1",
    x: 0,
    y: 0,
  });
  const cases: Record<string, { net: string; partner: string }> = {
    none: { net: "SIG", partner: "SIG " },
    edge_space: { net: "SIG ", partner: "SIG" },
    edge_other: { net: "SIG ", partner: "SIG" },
    only: { net: " ", partner: "  " },
    before_block_suffix: { net: "SIG _U1", partner: "SIG_U1" },
  };

  for (const row of readTable(TABLES, "warning").filter((r) => r.outcome !== "n/a")) {
    it(cellName(row, dims), () => {
      const { net, partner } = cases[row.whitespace];
      const names = row.collides === "yes" ? [net, partner] : [net];
      const sources =
        row.whitespace === "before_block_suffix" ? { [net]: [alias("SIG ")] } : undefined;
      const index = new NetNameIndex(names, {
        allegro: row.format === "cadence",
        sheetPaths: row.format === "kicad",
        sources,
      });
      const warning = index.warningFor(net);
      const outcome = row.outcome;

      if (outcome === "no warning") {
        expect(warning).toBeUndefined();
        return;
      }
      expect(warning).toBeDefined();
      if (outcome === "netlist name = trimmed") {
        expect(warning?.netlist_name).toBe(net.trim());
        return;
      }
      expect(warning?.netlist_name).toBeUndefined();
      expect(warning?.message.includes("ORCAP-36005")).toBe(outcome.includes("ORCAP-36005"));
      if (outcome.startsWith("partner warning")) {
        expect(warning?.problem).toBe("same_name_as_padded_net");
      } else if (outcome.startsWith("collision warning")) {
        expect(warning?.same_name_after_trim).toEqual([partner]);
      } else if (outcome.startsWith("whitespace-only warning")) {
        expect(warning?.problem).toBe("whitespace_only");
        expect(warning?.same_name_after_trim !== undefined).toBe(outcome.includes("listing"));
      } else if (outcome === "block warning, no netlist name") {
        expect(warning?.problem).toBe("whitespace_before_block_suffix");
        expect(warning?.same_name_after_trim).toBeUndefined();
      } else if (outcome === "unverified-trim warning, no netlist name") {
        expect(warning?.message).toContain("No export shows");
      } else if (outcome === "fix-the-label warning, no netlist name") {
        expect(warning?.message).toContain("Fix the label");
      } else {
        throw new Error(`No assertion for outcome "${outcome}"`);
      }
    });
  }
});
