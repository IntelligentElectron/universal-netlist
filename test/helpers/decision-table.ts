/**
 * Golden decision tables under docs/decision-tables, read for the tests that
 * replay them against the code, one test per cell.
 */
import { readFileSync } from "fs";
import path from "path";

const HELPERS_DIR = path.dirname(new URL(import.meta.url).pathname);
const TABLES = path.resolve(HELPERS_DIR, "../../docs/decision-tables");

/** Read `<feature>/<name>.csv`: quoted fields may hold commas and doubled quotes. */
export const readTable = (feature: string, name: string): Record<string, string>[] => {
  const text = readFileSync(path.join(TABLES, feature, `${name}.csv`), "utf8");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === "," || c === "\n") {
      row.push(field);
      field = "";
      if (c === "\n") {
        rows.push(row);
        row = [];
      }
    } else field += c;
  }
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
};

/** A cell's test name: its dimension values in order. */
export const cellName = (row: Record<string, string>, dims: string[]) =>
  dims.map((d) => `${d}=${row[d]}`).join(" ");
