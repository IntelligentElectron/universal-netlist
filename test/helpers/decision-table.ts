/**
 * Golden decision tables in `docs/decision-tables/<feature>/`, read for the
 * `*.table.test.ts` suites that replay every cell against the code.
 */
import { readFileSync } from "fs";
import path from "path";

/**
 * Read a table CSV under `dir`: quoted fields may hold commas and doubled quotes. Rows
 * end at LF or CR LF, the last row needs no line ending, and blank lines are skipped.
 */
export const readTable = (dir: string, name: string): Record<string, string>[] => {
  const raw = readFileSync(path.join(dir, `${name}.csv`), "utf8").replace(/\r\n/g, "\n");
  const text = raw.endsWith("\n") ? raw : `${raw}\n`;
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
        // A blank line holds no cell.
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      }
    } else field += c;
  }
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
};

/** A test name for a cell: each dimension and its value. */
export const cellName = (row: Record<string, string>, dims: readonly string[]): string =>
  dims.map((d) => `${d}=${row[d]}`).join(" ");
