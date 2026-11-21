import type { PageView } from "../../parsers/cadence/dsn/page-views.js";
import { rasterizeSvg } from "../../render/rasterize.js";
import type { ErrorResult } from "../../types.js";
import type { ServiceContext } from "../context.js";
import { findPage, loadPages } from "./pages.js";

/** A box in page coordinates: `[x1, y1, x2, y2]`. */
type Box = [number, number, number, number];

/** Space kept around a focused part or net, in page units (1/100 inch). */
const MARGIN = 40;

/** The PNG and what it shows. */
export interface RenderPageResult {
  design: string;
  page: string;
  focus?: string;
  width: number;
  height: number;
  /** Base64 PNG; the MCP server sends it as image content. */
  image: { mimeType: "image/png"; data: string };
}

const grow = (box: Box | undefined, x1: number, y1: number, x2 = x1, y2 = y1): Box =>
  box
    ? [
        Math.min(box[0], x1, x2),
        Math.min(box[1], y1, y2),
        Math.max(box[2], x1, x2),
        Math.max(box[3], y1, y2),
      ]
    : [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];

/** The area a refdes or net covers on a page, or undefined when it has none there. */
export function focusBox(view: PageView, focus: string): Box | undefined {
  const wanted = focus.trim().toUpperCase();
  let box: Box | undefined;
  for (const part of view.parts) {
    if (part.refdes.toUpperCase() !== wanted) continue;
    const [x1, y1, x2, y2] = part.box;
    if (x1 !== x2 || y1 !== y2) box = grow(box, x1, y1, x2, y2);
    for (const pin of part.pins) box = grow(box, pin.x, pin.y);
  }
  if (box) return box;
  const onNet = (net: string | undefined) => net?.toUpperCase() === wanted;
  for (const w of view.wires) if (onNet(w.net)) box = grow(box, w.x1, w.y1, w.x2, w.y2);
  for (const part of view.parts)
    for (const pin of part.pins) if (onNet(pin.net)) box = grow(box, pin.x, pin.y);
  for (const c of [...view.ports, ...view.globals, ...view.off_page_connectors])
    if (onNet(c.net)) box = grow(box, c.x, c.y);
  return box;
}

/** The SVG with its view narrowed to `box`, plus the margin. */
export function cropSvg(svg: string, [x1, y1, x2, y2]: Box): string {
  const x = x1 - MARGIN;
  const y = y1 - MARGIN;
  const w = x2 - x1 + 2 * MARGIN;
  const h = y2 - y1 + 2 * MARGIN;
  return svg.replace(
    /viewBox="[^"]*" width="[^"]*" height="[^"]*"/,
    `viewBox="${x} ${y} ${w} ${h}" width="${w}" height="${h}"`
  );
}

/** Render a page, or the part of it one refdes or net covers, as a PNG. */
export const renderPage = async (
  design: string,
  page: string,
  focus: string | undefined,
  context: ServiceContext
): Promise<RenderPageResult | ErrorResult> => {
  const loaded = await loadPages(design, context);
  if ("error" in loaded) return loaded;
  const view = findPage(loaded.pages, page);
  if ("error" in view) return view;
  let svg = loaded.svgs[loaded.pages.indexOf(view)];
  // A whole sheet at about 180 pixels per inch; a crop at least 1000 pixels wide.
  let width = Math.round(view.size.width_in * 180);
  if (focus !== undefined) {
    const box = focusBox(view, focus);
    if (!box) {
      return {
        error: `'${focus}' is neither a part nor a net on page '${view.page}'. Use get_page() to see what the page holds.`,
      };
    }
    svg = cropSvg(svg, box);
    width = Math.min(2400, Math.max(1000, (box[2] - box[0] + 2 * MARGIN) * 4));
  }
  const png = await rasterizeSvg(svg, width);
  return {
    design: loaded.designPath,
    page: view.page,
    ...(focus !== undefined ? { focus } : {}),
    width: png.width,
    height: png.height,
    image: { mimeType: "image/png", data: Buffer.from(png.data).toString("base64") },
  };
};
