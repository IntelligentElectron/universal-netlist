#!/usr/bin/env npx tsx
/**
 * Check every `.DSN` under a directory against its own part definitions: each
 * placed pin's number, Pin Ignore flag and name, as the parser resolves them,
 * against the package and view the file names for the part
 * (scripts/lib/dsn-definition-check.ts).
 *
 * Usage:
 *   node --import tsx scripts/dsn-definition-check.ts [path]
 *
 * Prints each design that differs, the totals, and how many parts fall in each
 * cell of the decision tables `section-pin-map` and `part-definition`. Exits 1
 * when any pin differs.
 */
import { readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { checkPartDefinitions } from "./lib/dsn-definition-check.js";

const root = resolve(process.argv[2] ?? ".");

const designs: string[] = [];
const walk = (dir: string): void => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (/\.dsn$/i.test(entry.name)) designs.push(path);
  }
};
walk(root);

const totals = { designs: 0, notRead: 0, parts: 0, pins: 0, unnumbered: 0, unchecked: 0 };
const differing: string[] = [];
const cells = {
  "section-pin-map": {} as Record<string, [parts: number, designs: number]>,
  "part-definition": {} as Record<string, [parts: number, designs: number]>,
};
const tally = (table: keyof typeof cells, found: Record<string, number>): void => {
  for (const [cell, parts] of Object.entries(found)) {
    const total = (cells[table][cell] ??= [0, 0]);
    total[0] += parts;
    total[1] += 1;
  }
};

for (const design of designs.sort()) {
  let check;
  try {
    check = checkPartDefinitions(design);
  } catch {
    // Not an OrCAD design, or one saved in a format the parser refuses.
    totals.notRead++;
    continue;
  }
  totals.designs++;
  totals.parts += check.parts;
  totals.pins += check.pins;
  totals.unnumbered += check.unnumbered;
  totals.unchecked += check.unchecked.length;
  tally("section-pin-map", check.sectionCells);
  tally("part-definition", check.definitionCells);
  if (check.differences.length > 0) {
    differing.push(design);
    console.log(`${relative(root, design)}: ${check.differences.length} differ`);
    for (const difference of check.differences.slice(0, 5)) console.log(`  ${difference}`);
  }
}

console.log(
  `${totals.designs} designs read (${totals.notRead} files not read), ` +
    `${totals.parts} placed parts, ${totals.pins} pins`
);
console.log(
  `${differing.length} designs differ; ${totals.unnumbered} pins have no number in the file; ` +
    `${totals.unchecked} parts name no library or have no package in theirs`
);
for (const [table, found] of Object.entries(cells)) {
  console.log(`\n${table}: parts and designs per cell reached`);
  for (const [cell, [parts, count]] of Object.entries(found).sort((a, b) => b[1][0] - a[1][0])) {
    console.log(`  ${String(parts).padStart(7)} ${String(count).padStart(5)}  ${cell}`);
  }
}

if (differing.length > 0) process.exit(1);
