/**
 * Replays the golden decision table in docs/decision-tables/altium-lines against the
 * four readers of Altium text files, one test per cell, so the table and the code
 * cannot drift.
 */
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cellName, readTable } from "../../../test/helpers/decision-table.js";
import { findAltiumSchDocs } from "./discovery.js";
import { parseHarnessDefinitions } from "./harness.js";
import { parseProjectOptions } from "./project-options.js";
import { parseAltiumProjectVariants } from "./project-variants.js";

const TABLES = path.resolve(__dirname, "../../../docs/decision-tables/altium-lines");
const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/** Each terminator, and whether the key line is the file's last with none after it. */
const ENDINGS: Record<string, { ending: string; last: boolean }> = {
  LF: { ending: "\n", last: false },
  CRLF: { ending: "\r\n", last: false },
  CRCRLF: { ending: "\r\r\n", last: false },
  CR: { ending: "\r", last: false },
  "end-of-file": { ending: "\r\r\n", last: true },
};

describe("golden table: lines", () => {
  const dims = ["terminator", "reader"];
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "altium-lines-"));
    // Two sheets, so a missed DocumentPath= line cannot pass by the one-sheet fallback.
    await writeFile(path.join(dir, "Main.SchDoc"), OLE_MAGIC);
    await writeFile(path.join(dir, "Other.SchDoc"), OLE_MAGIC);
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** Whether each reader returns the value its key line, the last listed, sets. */
  const READERS: Record<string, (text: (lines: string[]) => string) => Promise<boolean>> = {
    "document-path": async (text) => {
      const project = path.join(dir, `${Math.random().toString(36).slice(2)}.PrjPcb`);
      await writeFile(
        project,
        text(["[Design]", "Version=1.0", "[Document1]", "DocumentPath=Main.SchDoc"])
      );
      const schdocs = await findAltiumSchDocs(project);
      return schdocs.length === 1 && schdocs[0] === path.join(dir, "Main.SchDoc");
    },
    "project-options": async (text) =>
      parseProjectOptions(text(["[Design]", "Version=1.0", "HierarchyMode=3"])).scope === "global",
    "project-variants": async (text) =>
      parseAltiumProjectVariants(text(["[Design]", "[ProjectVariant1]", "Description=Lite"]))[0]
        ?.name === "Lite",
    harness: async (text) =>
      parseHarnessDefinitions(text(["Bus=A,B", "Pair=P,N"]))
        .get("Pair")
        ?.join(",") === "P,N",
  };

  for (const row of readTable(TABLES, "lines").filter((r) => r.outcome !== "n/a")) {
    it(cellName(row, dims), async () => {
      const { ending, last } = ENDINGS[row.terminator];
      const text = (lines: string[]) => lines.join(ending) + (last ? "" : ending);
      const read = await READERS[row.reader](text);
      expect(read ? "line read" : "line missed").toBe(row.outcome);
    });
  }
});
