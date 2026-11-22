/**
 * A schematic page as drawn, the same shape for every vendor's reader.
 *
 * Coordinates are in mils (1/1000 inch), x to the right and y down from the
 * sheet's top-left corner, whatever unit the source file stores. Every net a
 * page names is a `list_nets` name of the same design.
 */

import type { PinType } from "../types.js";

export interface PagePin {
  number: string;
  name?: string;
  /** The electrical type the part's library symbol declares, as query_component reports it. */
  type?: PinType;
  x: number;
  y: number;
  net?: string;
}

export interface PagePart {
  refdes: string;
  /** Set, as query_component sets it, when several different parts share this refdes. */
  error?: string;
  value?: string;
  /** The library symbol drawn, such as `RES.Normal`. */
  symbol: string;
  x: number;
  y: number;
  /** Counterclockwise, in degrees: 0, 90, 180 or 270, applied after the mirror. */
  rotation: number;
  mirrored: boolean;
  /** The bounding box, `[x1, y1, x2, y2]`; all zero when the file stores none. */
  box: [number, number, number, number];
  pins: PagePin[];
}

export interface PageConnector {
  name: string;
  /** Ports: the direction, in the pin types' terms (input, output, bidirectional, passive, power...). */
  type?: PinType;
  x: number;
  y: number;
  net?: string;
}

export interface PageNote {
  text: string;
  x: number;
  y: number;
}

/** A marker the vendor's own rules check left on the page. */
export interface PageErcMarker {
  message: string;
  detail: string;
  location: string;
  x: number;
  y: number;
}

export interface PageView {
  /** The page's name, with the block placement when the page is one copy of a reused schematic. */
  page: string;
  schematic: string;
  name: string;
  size: { name: string; width_mil: number; height_mil: number };
  title_block?: { fields: Record<string, string>; page_number: number; page_count: number };
  parts: PagePart[];
  /** Hierarchical blocks, each placing a child schematic. */
  blocks: { refdes: string; x: number; y: number }[];
  wires: { x1: number; y1: number; x2: number; y2: number; bus: boolean; net?: string }[];
  net_labels: { name: string; x: number; y: number }[];
  ports: PageConnector[];
  globals: PageConnector[];
  off_page_connectors: PageConnector[];
  bus_entries: { x1: number; y1: number; x2: number; y2: number }[];
  /** Free text the designer placed on the page, at its anchor. */
  text_notes: PageNote[];
  /** Markers the vendor's rules check left on the page, for formats that save them. */
  erc_markers: PageErcMarker[];
}

/** A design's pages: one view per page and, when drawn, one SVG per page in the same order. */
export interface DesignPages {
  pages: PageView[];
  /** Empty unless the pages were drawn; "" for a page that could not be. SVG units are mils. */
  svgs: string[];
}
