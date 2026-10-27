/**
 * Replays the golden query-CLI tables in docs/decision-tables/query-cli
 * against `parseQueryArgs` and `runQuery`, one test per cell.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { cellName, readTable } from "../../test/helpers/decision-table.js";
import { READ_ONLY, findTool, type AnyToolDefinition } from "../tools/index.js";
import { parseQueryArgs, runQuery } from "./query.js";
import type { ServiceContext } from "../service/context.js";

const TABLES = path.resolve(__dirname, "../../docs/decision-tables/query-cli");

/** A tool with one flag of each kind, so every cell can be built. */
const fixture = (run: AnyToolDefinition["run"] = async () => ({ ok: true })): AnyToolDefinition =>
  ({
    name: "fixture_tool",
    title: "Fixture",
    description: "A tool for the tables.",
    annotations: READ_ONLY,
    inputSchema: z.strictObject({
      design: z.string().describe("Path to design file"),
      text: z.string().optional(),
      count: z.number().int().optional(),
      flagged: z.boolean().optional().default(false),
      items: z.array(z.string()).optional(),
    }),
    run,
  }) as AnyToolDefinition;

const FLAG_FOR = {
  string: "text",
  number: "count",
  boolean: "flagged",
  array: "items",
  unknown: "nope",
};

describe("golden table: flag", () => {
  const dims = ["kind", "form", "occurrence"];
  const values = { word: "true", number: "3", text: "U1" } as Record<string, string>;
  for (const row of readTable(TABLES, "flag")) {
    it(cellName(row, dims), () => {
      const flag = `--${FLAG_FOR[row.kind as keyof typeof FLAG_FOR]}`;
      const [position, sort] = row.form.split("_");
      const tokens =
        row.form === "last"
          ? [flag]
          : position === "eq"
            ? [`${flag}=${sort === "empty" ? "" : values[sort]}`]
            : [flag, sort === "dash" ? "-12V" : values[sort]];
      const first = row.occurrence === "repeat" ? [flag + "=1"] : [];
      // The repeat is written --flag=1 first, which every kind but unknown takes.
      if (row.occurrence === "repeat" && row.kind === "boolean") first[0] = `${flag}=true`;
      const parsed = parseQueryArgs(fixture(), ["board.DSN", ...first, ...tokens]);
      const name = FLAG_FOR[row.kind as keyof typeof FLAG_FOR];
      const value = parsed.kind === "run" ? parsed.args[name] : undefined;

      if (row.outcome.startsWith("usage: ")) {
        expect(parsed.kind).toBe("usage");
        const fragment = {
          "usage: unknown flag": "Unknown flag",
          "usage: given twice": "given twice",
          "usage: takes true or false": "takes true or false",
          "usage: needs =value for a dash": "starts with a dash",
          "usage: needs a value": "needs a value",
          "usage: takes a number": "takes a number",
        }[row.outcome]!;
        expect(parsed.kind === "usage" && parsed.message).toContain(fragment);
        return;
      }
      if (row.outcome === "true, next not consumed") {
        // Alone at the end it is simply true; otherwise the next token is read
        // on its own, here as a stray argument or an unknown short flag.
        if (row.form === "last") expect(value).toBe(true);
        else expect(parsed.kind === "usage" && parsed.message).toContain(tokens[1]);
        return;
      }
      expect(parsed.kind).toBe("run");
      switch (row.outcome) {
        case "text":
          expect(value).toBe(row.form === "eq_empty" ? "" : values[sort]);
          break;
        case "number":
          expect(value).toBe(3);
          break;
        case "append text":
          expect(value).toEqual([
            ...(row.occurrence === "repeat" ? ["1"] : []),
            row.form === "eq_empty" ? "" : values[sort],
          ]);
          break;
        case "that boolean":
        case "that boolean, next consumed":
          expect(value).toBe(true);
          break;
        default:
          throw new Error(`unknown outcome ${row.outcome}`);
      }
    });
  }
});

describe("golden table: positional", () => {
  const dims = ["position", "tool_design", "design_flag"];
  for (const row of readTable(TABLES, "positional").filter((r) => r.outcome !== "n/a")) {
    it(cellName(row, dims), () => {
      const takesDesign = row.tool_design === "takes_design";
      const tool = takesDesign ? fixture() : findTool("list_designs")!;
      const flags = row.design_flag === "present" ? ["--design", "other.DSN"] : [];
      const filler = takesDesign ? ["--text", "x"] : ["--path", "x"];
      const tokens =
        row.position === "first"
          ? ["board.DSN", ...flags, ...filler]
          : [...flags, ...filler, "board.DSN"];
      const parsed = parseQueryArgs(tool, tokens);
      if (row.outcome === "design") {
        expect(parsed).toMatchObject({ kind: "run", args: { design: "board.DSN" } });
        return;
      }
      expect(parsed.kind).toBe("usage");
      const fragment = {
        "usage: takes only flags": "takes only flags",
        "usage: unexpected argument": "Unexpected argument",
        "usage: design given twice": "given twice",
      }[row.outcome]!;
      expect(parsed.kind === "usage" && parsed.message).toContain(fragment);
    });
  }
});

describe("golden table: exit", () => {
  const dims = ["help", "args", "result", "stdout"];
  const context = async () => ({}) as ServiceContext;
  for (const row of readTable(TABLES, "exit")) {
    it(cellName(row, dims), async () => {
      const tool = fixture(async () => {
        if (row.result === "throws") throw new Error("boom");
        return row.result === "ok" ? { nets: ["A"] } : { error: "not found" };
      });
      const tokens = {
        valid: ["board.DSN", "--count", "2"],
        usage_error: ["board.DSN", "--count"],
        schema_refuses: ["board.DSN", "--count", "2.5"],
      }[row.args]!;
      if (row.help === "present") tokens.push("--help");
      const outcome = await runQuery(tool, tokens, { isTTY: row.stdout === "tty", context });

      if (row.outcome === "tool help on stdout, exit 0") {
        expect(outcome.exitCode).toBe(0);
        expect(outcome.stdout).toContain("Usage: universal-netlist fixture_tool");
        return;
      }
      if (row.outcome === "usage on stderr, exit 2") {
        expect(outcome).toMatchObject({ exitCode: 2, stderr: expect.stringContaining("usage: ") });
        expect(outcome.stdout).toBeUndefined();
        return;
      }
      const [format, , , , , code] = row.outcome.split(/[ ,]+/);
      expect(outcome.exitCode).toBe(Number(code));
      expect(outcome.stderr).toBeUndefined();
      expect(outcome.stdout!.includes("\n")).toBe(format === "indented");
      const body = JSON.parse(outcome.stdout!);
      if (row.result === "throws") expect(body).toEqual({ error: "boom" });
    });
  }
});
