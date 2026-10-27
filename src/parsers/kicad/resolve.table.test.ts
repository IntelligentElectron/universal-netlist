/**
 * Replays the golden KiCad source table in docs/decision-tables/kicad-source
 * against `resolveKicadNetlist`, one test per cell.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cellName, readTable } from "../../../test/helpers/decision-table.js";
import type { ParsedNetlist } from "../../types.js";
import { resolveKicadNetlist, type KicadNetlistSources } from "./index.js";

const TABLES = path.resolve(__dirname, "../../../docs/decision-tables/kicad-source");

const netlist = (source: string): ParsedNetlist => ({
  nets: { [source]: { R1: ["1"] } },
  components: { R1: { pins: { "1": source } } },
});

describe("golden table: resolve", () => {
  const dims = ["saved_net", "root_sch", "raw", "kicad_cli"];
  for (const row of readTable(TABLES, "resolve")) {
    it(cellName(row, dims), async () => {
      const ran: string[] = [];
      const step = (name: string, works: boolean) => async () => {
        ran.push(name);
        if (!works) throw new Error(`${name} broke`);
        return netlist(name);
      };
      const sources: KicadNetlistSources = {
        design: "board.kicad_pro",
        ...(row.saved_net === "present" ? { savedNet: step("saved", true) } : {}),
        ...(row.root_sch === "present" ? { raw: step("raw", row.raw === "works") } : {}),
        ...(row.root_sch === "present" && row.kicad_cli !== "off"
          ? { kicadCli: step("cli", row.kicad_cli === "works") }
          : {}),
      };
      const result = resolveKicadNetlist(sources);
      switch (row.outcome) {
        case "saved .net":
          expect(await result).toEqual(netlist("saved"));
          expect(ran).toEqual(["saved"]);
          break;
        case "raw reader":
          expect(await result).toEqual(netlist("raw"));
          expect(ran).toEqual(["raw"]);
          break;
        case "kicad-cli export":
          expect(await result).toEqual(netlist("cli"));
          expect(ran).toEqual(["raw", "cli"]);
          break;
        case "error: no netlist":
          await expect(result).rejects.toThrow('Expected a committed "board.net"');
          expect(ran).toEqual([]);
          break;
        case "error: raw and kicad-cli":
          await expect(result).rejects.toThrow(/raw broke.*so did kicad-cli: cli broke/);
          break;
        case "error: raw, kicad-cli off":
          await expect(result).rejects.toThrow(/raw broke.*kicad-cli is turned off/);
          expect(ran).toEqual(["raw"]);
          break;
        default:
          throw new Error(`unknown outcome ${row.outcome}`);
      }
    });
  }
});
