/**
 * Minimal s-expression reader for KiCad files.
 *
 * KiCad stores schematics, boards, symbol libraries and netlist exports in a
 * Lisp-like s-expression syntax. This is a small, dependency-free tokenizer +
 * reader that turns the text into a tree of nested arrays. It is used to parse
 * the `kicadsexpr` netlist export, and is intentionally generic so it can be
 * reused by a future raw `.kicad_sch` reader.
 *
 * Representation: a node is either a `string` (an atom or a quoted string) or an
 * `SExpr[]` (a list). The first element of a list is its tag, e.g.
 * `(ref "C1")` parses to `["ref", "C1"]`. Atoms and quoted strings are both
 * represented as plain strings; for the netlist format the distinction is not
 * needed (tags are bare atoms, values are always quoted).
 */

export type SExpr = string | SExpr[];

/**
 * Parse s-expression text into a list of top-level nodes.
 * A well-formed KiCad file has a single top-level list (e.g. `(export ...)`),
 * but the reader tolerates multiple top-level nodes.
 */
export const parseSexpr = (input: string): SExpr[] => {
  const top: SExpr[] = [];
  // Stack of in-progress lists; the last entry receives new children.
  const stack: SExpr[][] = [top];
  let i = 0;
  const n = input.length;

  const isDelimiter = (ch: string): boolean =>
    ch === "(" || ch === ")" || ch === '"' || ch === " " || ch === "\t" || ch === "\n" || ch === "\r";

  while (i < n) {
    const ch = input[i];

    // Whitespace
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }

    // Open list
    if (ch === "(") {
      const list: SExpr[] = [];
      stack[stack.length - 1].push(list);
      stack.push(list);
      i++;
      continue;
    }

    // Close list
    if (ch === ")") {
      if (stack.length === 1) {
        throw new Error(`Unbalanced ')' at offset ${i}`);
      }
      stack.pop();
      i++;
      continue;
    }

    // Quoted string
    if (ch === '"') {
      i++; // skip opening quote
      let str = "";
      while (i < n) {
        const c = input[i];
        if (c === "\\") {
          const next = input[i + 1];
          switch (next) {
            case "n":
              str += "\n";
              break;
            case "r":
              str += "\r";
              break;
            case "t":
              str += "\t";
              break;
            case "\\":
              str += "\\";
              break;
            case '"':
              str += '"';
              break;
            default:
              // Unknown escape: keep the following character verbatim.
              str += next ?? "";
              break;
          }
          i += 2;
          continue;
        }
        if (c === '"') {
          i++; // skip closing quote
          break;
        }
        str += c;
        i++;
      }
      stack[stack.length - 1].push(str);
      continue;
    }

    // Bare atom: read until a delimiter.
    let atom = "";
    while (i < n && !isDelimiter(input[i])) {
      atom += input[i];
      i++;
    }
    stack[stack.length - 1].push(atom);
  }

  if (stack.length !== 1) {
    throw new Error("Unbalanced '(' — unexpected end of input");
  }

  return top;
};

/** Type guard: is this node a list? */
export const isList = (node: SExpr | undefined): node is SExpr[] => Array.isArray(node);

/** Get the tag (first element) of a list node, or undefined for atoms/empty lists. */
export const tag = (node: SExpr | undefined): string | undefined => {
  if (isList(node) && typeof node[0] === "string") return node[0];
  return undefined;
};

/** Return all child lists of `node` whose tag equals `name`. */
export const childrenByTag = (node: SExpr | undefined, name: string): SExpr[][] => {
  if (!isList(node)) return [];
  return node.filter((c): c is SExpr[] => isList(c) && tag(c) === name);
};

/** Return the first child list of `node` whose tag equals `name`, or undefined. */
export const childByTag = (node: SExpr | undefined, name: string): SExpr[] | undefined =>
  childrenByTag(node, name)[0];

/**
 * Read the first string argument of a tagged child, e.g. for `(ref "C1")`
 * `childString(comp, "ref")` returns `"C1"`. Returns undefined when the child
 * is absent or has no string argument (e.g. a bare marker like `(dnp)`).
 */
export const childString = (node: SExpr | undefined, name: string): string | undefined => {
  const child = childByTag(node, name);
  if (!child) return undefined;
  const value = child[1];
  return typeof value === "string" ? value : undefined;
};

/** True when `node` has at least one child list tagged `name`. */
export const hasChild = (node: SExpr | undefined, name: string): boolean =>
  childByTag(node, name) !== undefined;
