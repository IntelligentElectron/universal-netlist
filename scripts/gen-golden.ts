#!/usr/bin/env npx tsx
import { parseDesign } from "../src/parsers/index.js";
import { saveGolden, type Format } from "../test/utils.js";

const [format, name, designPath] = process.argv.slice(2);

if (!format || !name || !designPath) {
  console.error("Usage: npx tsx scripts/gen-golden.ts <format> <name> <path>");
  process.exit(1);
}

console.log("Parsing:", designPath);
const result = await parseDesign(designPath);
console.log("Components:", Object.keys(result.components).length);
console.log("Nets:", Object.keys(result.nets).length);
await saveGolden(format as Format, name, result);
console.log("Saved:", `test/golden/${format}/${name}.json`);
