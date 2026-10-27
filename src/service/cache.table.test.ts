/**
 * Replays the golden parse-cache tables in docs/decision-tables/parse-cache
 * against `cached` over a real disk store, one test per cell.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cellName, readTable } from "../../test/helpers/decision-table.js";
import { passwordList, type FileReader, type ParserContext } from "../parsers/context.js";
import { cached, slotKey, type CacheSlot } from "./cache.js";
import { DiskCacheStore } from "./disk-cache.js";

const TABLES = path.resolve(__dirname, "../../docs/decision-tables/parse-cache");
const DESIGN = "/designs/board.DSN";
const SLOT: CacheSlot = { kind: "netlist", path: DESIGN, variant: "<Default>" };

const context = (content: { text: string }): ParserContext => {
  const files: FileReader = {
    readFile: async () => new TextEncoder().encode(content.text),
    exists: async () => true,
  };
  return { files, kicadCli: false, dsnPasswords: passwordList(["secret"]) };
};

describe("golden table: lookup", () => {
  const dims = ["entry", "files", "design", "parse"];
  const root = mkdtempSync(path.join(tmpdir(), "parse-cache-table-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  readTable(TABLES, "lookup")
    .filter((row) => row.outcome !== "n/a")
    .forEach((row, index) => {
      it(cellName(row, dims), async () => {
        const store = new DiskCacheStore(path.join(root, String(index)));
        const content = { text: "first" };
        const file = path.join(store.dir, `${slotKey(SLOT)}.json`);

        if (row.entry === "current") {
          await cached(store, SLOT, context(content), async (c) => {
            await c.files.readFile(DESIGN);
            return { n: 1 };
          });
        } else if (row.entry === "foreign") {
          await cached(store, SLOT, context(content), async (c) => {
            await c.files.readFile(DESIGN);
            return { n: 1 };
          });
          const stored = JSON.parse((await import("node:fs")).readFileSync(file, "utf-8"));
          writeFileSync(file, JSON.stringify({ ...stored, packageVersion: "0.0.0-other" }));
        } else if (row.entry === "corrupt") {
          (await import("node:fs")).mkdirSync(store.dir, { recursive: true });
          writeFileSync(file, '{"format": "universal-netlist-parse-cache", "probes": [');
        }
        if (row.files === "changed") content.text = "second";

        let ran = false;
        const answer = cached(store, SLOT, context(content), async (c) => {
          ran = true;
          if (row.design === "protected") c.dsnPasswords.list();
          if (row.parse === "fails") throw new Error("parse failed");
          if (row.parse === "reads_files") await c.files.readFile(DESIGN);
          return { n: 2 };
        });

        const after = async () => (await store.get(slotKey(SLOT)))?.value;
        switch (row.outcome) {
          case "answer from cache":
            expect(await answer).toEqual({ n: 1 });
            expect(ran).toBe(false);
            break;
          case "parse, store":
            expect(await answer).toEqual({ n: 2 });
            expect(await after()).toEqual({ n: 2 });
            break;
          case "parse, nothing stored":
            expect(await answer).toEqual({ n: 2 });
            expect(await after()).not.toEqual({ n: 2 });
            break;
          case "error, nothing stored":
            await expect(answer).rejects.toThrow("parse failed");
            expect(await after()).not.toEqual({ n: 2 });
            break;
          default:
            throw new Error(`unknown outcome ${row.outcome}`);
        }
      });
    });
});
