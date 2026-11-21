import { parseDsnPages } from "../../parsers/cadence/dsn/dsn-parser.js";
import type { PageView } from "../../parsers/cadence/dsn/page-views.js";
import { readOnce } from "../../parsers/context.js";
import { resolvePath } from "../../paths.js";
import type { ErrorResult } from "../../types.js";
import { cached } from "../cache.js";
import type { ServiceContext } from "../context.js";

/** Coordinates in page results: 1/100 inch, x to the right, y down. */
export const PAGE_UNITS = "0.01 in, x right, y down";

export interface PageSummary {
  page: string;
  schematic: string;
  name: string;
  size: PageView["size"];
  title?: string;
  page_number?: number;
  parts: number;
  nets: number;
  ports: number;
  off_page_connectors: number;
}

const loadPages = async (
  design: string,
  context: ServiceContext
): Promise<{ designPath: string; pages: PageView[] } | ErrorResult> => {
  const designPath = resolvePath(design, context.root);
  // A suffix test, not path.extname, which reads a file named `.DSN` as having no extension.
  if (!designPath.toLowerCase().endsWith(".dsn")) {
    return { error: "Pages are read from Cadence .DSN schematics only. Use list_designs() first." };
  }
  const parser = { ...context.parser, files: readOnce(context.parser.files) };
  try {
    const pages = await cached(
      context.cache,
      { kind: "pages", path: designPath },
      parser,
      async (p) => parseDsnPages(await p.files.readFile(designPath), p.dsnPasswords)
    );
    return { designPath, pages };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
};

const netsOn = (page: PageView): number =>
  new Set(
    [...page.wires, ...page.parts.flatMap((p) => p.pins)]
      .map((item) => item.net)
      .filter((net): net is string => net !== undefined && net !== "NC")
  ).size;

/** List a design's schematic pages, in the order the netlist reads them. */
export const listPages = async (
  design: string,
  context: ServiceContext
): Promise<{ design: string; pages: PageSummary[] } | ErrorResult> => {
  const loaded = await loadPages(design, context);
  if ("error" in loaded) return loaded;
  return {
    design: loaded.designPath,
    pages: loaded.pages.map((page) => {
      const title = page.title_block?.fields.Title;
      return {
        page: page.page,
        schematic: page.schematic,
        name: page.name,
        size: page.size,
        ...(title ? { title } : {}),
        ...(page.title_block ? { page_number: page.title_block.page_number } : {}),
        parts: page.parts.length,
        nets: netsOn(page),
        ports: page.ports.length,
        off_page_connectors: page.off_page_connectors.length,
      };
    }),
  };
};

/** The page `page` names: its label, or its plain name when only one page has it. */
export const findPage = (pages: PageView[], page: string): PageView | ErrorResult => {
  // Page names may carry spaces at either end, so both sides are compared trimmed.
  const norm = (text: string) => text.trim().toLowerCase();
  const wanted = norm(page);
  const byLabel = pages.filter((p) => norm(p.page) === wanted);
  if (byLabel.length === 1) return byLabel[0];
  const byName = pages.filter(
    (p) => norm(p.name) === wanted || norm(`${p.schematic}/${p.name.trim()}`) === wanted
  );
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) {
    return {
      error: `Page '${page}' names ${byName.length} pages: ${byName.map((p) => `'${p.page}'`).join(", ")}. Pass one of those.`,
    };
  }
  return { error: `Page '${page}' not found. Use list_pages() to see the design's pages.` };
};

/** One page as drawn: its parts, wires, labels and connectors, with their nets. */
export const getPage = async (
  design: string,
  page: string,
  context: ServiceContext
): Promise<(PageView & { design: string; units: string }) | ErrorResult> => {
  const loaded = await loadPages(design, context);
  if ("error" in loaded) return loaded;
  const found = findPage(loaded.pages, page);
  if ("error" in found) return found;
  return { design: loaded.designPath, units: PAGE_UNITS, ...found };
};
