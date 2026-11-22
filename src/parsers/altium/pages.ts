/**
 * Altium sheets as the page tools describe them (docs/altium-format.md, Drawing): one
 * page per document instance, a repeated sheet once per channel. Coordinates become
 * mils with y down; every net is a `list_nets` name: a pin takes its net from the
 * project netlist, and anything else takes the net of a pin it connects to.
 */

import path from "node:path";
import type { PageConnector, PagePart, PageView, DesignPages } from "../../pages/page-view.js";
import { PIN_TYPE_BY_CODE, type ParseDesignOptions, type PinType } from "../../types.js";
import { applyChannelFormat } from "./channels.js";
import {
  componentDesignator,
  pinBelongsToInstance,
  pinDesignator,
  pinNumber,
} from "./components.js";
import {
  COORDINATE_SCALE,
  polylinePoints,
  scaledField,
  scaledPoint,
  type Point,
} from "./coordinates.js";
import { extractNets } from "./net-extractor.js";
import { renderAltiumSheet } from "./page-render.js";
import { loadAltiumProject, parseAltiumProject } from "./project.js";
import { field, fieldText, toNumber } from "./records.js";
import { RECORD_TYPES, type AltiumRecord } from "./types.js";

/** Standard sheet sizes in units (10 mil), by `SheetStyle`. */
const SHEET_STYLES: [string, number, number][] = [
  ["A4", 1150, 760],
  ["A3", 1550, 1110],
  ["A2", 2230, 1570],
  ["A1", 3150, 2230],
  ["A0", 4460, 3150],
  ["A", 950, 750],
  ["B", 1500, 950],
  ["C", 2000, 1500],
  ["D", 3200, 2000],
  ["E", 4200, 3200],
  ["Letter", 1100, 850],
  ["Legal", 1400, 850],
  ["Tabloid", 1700, 1100],
  ["OrCAD A", 990, 790],
  ["OrCAD B", 1540, 990],
  ["OrCAD C", 2060, 1560],
  ["OrCAD D", 3260, 2060],
  ["OrCAD E", 4280, 3280],
];

/** A port's `IOType` in the pin types' terms. */
const IO_TYPE: Record<string, PinType> = {
  "0": "unspecified",
  "1": "output",
  "2": "input",
  "3": "bidirectional",
};

const optional = <K extends string, V>(key: K, value: V | undefined) =>
  (value === undefined || value === "" ? {} : { [key]: value }) as { [P in K]?: V };

/** A sheet's size: its style, or its custom size, portrait when the sheet says so. */
export const sheetSize = (
  sheet: AltiumRecord | undefined
): { name: string; width: number; height: number } => {
  const custom = sheet !== undefined && field(sheet, "UseCustomSheet") === "T";
  const [name, w, h] = custom
    ? ["Custom", toNumber(field(sheet, "CustomX")), toNumber(field(sheet, "CustomY"))]
    : (SHEET_STYLES[toNumber(sheet && field(sheet, "SheetStyle"))] ?? SHEET_STYLES[0]!);
  const portrait = sheet !== undefined && field(sheet, "WorkspaceOrientation") === "1";
  return portrait ? { name, width: h, height: w } : { name, width: w, height: h };
};

/** The points a component's drawn child reaches, for its box. */
const reach = (child: AltiumRecord): Point[] => {
  const points: Point[] = [];
  if (field(child, "Location.X") !== undefined || field(child, "Location.Y") !== undefined) {
    const [x, y] = scaledPoint(child);
    const r = scaledField(child, "Radius");
    const ry = scaledField(child, "SecondaryRadius") || r;
    points.push([x - r, y - ry], [x + r, y + ry]);
  }
  if (field(child, "Corner.X") !== undefined) points.push(scaledPoint(child, "Corner"));
  if (field(child, "LocationCount") !== undefined) points.push(...polylinePoints(child));
  if (child.coords) points.push(...child.coords);
  return points;
};

/** A pin's tip, `PinLength` from its location turned by the low two bits of `PinConglomerate`. */
const pinTip = (pin: AltiumRecord): Point => {
  if (pin.coords?.length === 2) return pin.coords[1]!;
  const [x, y] = scaledPoint(pin);
  const length = scaledField(pin, "PinLength");
  const turn = toNumber(field(pin, "PinConglomerate")) & 3;
  return [x + [length, 0, -length, 0][turn]!, y + [0, length, 0, -length][turn]!];
};

/** An Altium project's pages, and, when `draw` is set, one SVG per page in the same order. */
export const parseAltiumPages = async (
  projectPath: string,
  options?: ParseDesignOptions,
  draw = false
): Promise<DesignPages> => {
  const project = await loadAltiumProject(projectPath, options);
  const netlist = await parseAltiumProject(projectPath, options, project);
  const names = new Set(Object.keys(netlist.nets));
  const pinNet = (refdes: string, number: string): string | undefined => {
    const entry = Object.hasOwn(netlist.components, refdes)
      ? netlist.components[refdes].pins[number]
      : undefined;
    const net = entry === undefined ? undefined : typeof entry === "string" ? entry : entry.net;
    return net === "" ? "NC" : net;
  };

  const pages: PageView[] = [];
  const svgs: string[] = [];
  for (const read of project.documents) {
    const schematic = read.hierarchical;
    const nets = extractNets(schematic, project.naming);
    const instances = project.instances.get(read.name) ?? [];
    const sheet = schematic.records.find((r) => r.RECORD === RECORD_TYPES.SHEET);
    const size = sheetSize(sheet);
    const at = ([x, y]: Point) => ({
      x: Math.round((x / COORDINATE_SCALE) * 1000) / 100,
      y: Math.round((size.height - y / COORDINATE_SCALE) * 1000) / 100,
    });
    const documentScope = schematic.records.flatMap((r) =>
      r.RECORD === RECORD_TYPES.SHEET ? [r, ...(r.children ?? [])] : [r]
    );
    const parameters = Object.fromEntries(
      documentScope
        .filter((r) => r.RECORD === RECORD_TYPES.PARAMETER)
        .map((r) => [fieldText(r, "Name") ?? "", fieldText(r, "Text")?.trim() ?? ""] as const)
        .filter(([name, value]) => name && value && value !== "*")
    );
    const base = path.basename(read.path);

    for (const instance of instances.length > 1 ? instances : [undefined]) {
      const refdes = (designator: string): string =>
        instance
          ? applyChannelFormat(
              project.options.channelFormat,
              designator,
              instance.room,
              instance.ordinal
            )
          : designator;
      // A sheet net's final name is the netlist net of a pin on it.
      const netOf = new Map<AltiumRecord, string>();
      for (const net of nets) {
        let name: string | undefined;
        for (const device of net.devices) {
          if (device.RECORD !== RECORD_TYPES.PIN) continue;
          const designator = pinDesignator(device, schematic);
          const number = pinNumber(device);
          const final = designator && number ? pinNet(refdes(designator), number) : undefined;
          if (final && final !== "NC") {
            name = final;
            break;
          }
        }
        if (name === undefined && !instance && net.name && names.has(net.name)) name = net.name;
        if (name !== undefined) for (const device of net.devices) netOf.set(device, name);
      }
      const connector = (record: AltiumRecord, name: string, type?: PinType): PageConnector => ({
        name,
        ...optional("type", type),
        ...at(scaledPoint(record)),
        ...optional("net", netOf.get(record)),
      });
      const top = (type: string) => schematic.records.filter((r) => r.RECORD === type);
      const segments = (type: string, bus: boolean) =>
        top(type).flatMap((record) => {
          const points = polylinePoints(record);
          return points.slice(1).map((end, i) => {
            const a = at(points[i]!);
            const b = at(end);
            return {
              x1: a.x,
              y1: a.y,
              x2: b.x,
              y2: b.y,
              bus,
              ...optional("net", netOf.get(record)),
            };
          });
        });

      const parts: PagePart[] = top(RECORD_TYPES.COMPONENT).map((part) => {
        const designator = componentDesignator(part) ?? "";
        const ref = refdes(designator);
        const drawn = (part.children ?? []).filter(
          // The part's own graphics and pins; its designator and parameters are text beside it.
          (child) =>
            child.RECORD !== RECORD_TYPES.PARAMETER &&
            child.RECORD !== RECORD_TYPES.DESIGNATOR &&
            pinBelongsToInstance(child, part)
        );
        const points = drawn.flatMap(reach);
        const corners = points.length
          ? [
              at([Math.min(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1]))]),
              at([Math.max(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1]))]),
            ]
          : undefined;
        return {
          refdes: ref,
          ...optional("value", netlist.components[ref]?.value),
          symbol: fieldText(part, "LibReference") ?? "",
          ...at(scaledPoint(part)),
          rotation: (toNumber(field(part, "Orientation")) & 3) * 90,
          mirrored: field(part, "IsMirrored") === "T",
          box: corners
            ? [corners[0]!.x, corners[0]!.y, corners[1]!.x, corners[1]!.y]
            : [0, 0, 0, 0],
          pins: drawn
            .filter((child) => child.RECORD === RECORD_TYPES.PIN)
            .map((pin) => {
              const number = pinNumber(pin) ?? "";
              const electrical = String(field(pin, "Electrical") ?? "0");
              return {
                number,
                ...optional("name", fieldText(pin, "Name")),
                ...optional(
                  "type",
                  /^\d$/.test(electrical) ? PIN_TYPE_BY_CODE[Number(electrical)] : undefined
                ),
                ...at(pinTip(pin)),
                ...optional("net", pinNet(ref, number)),
              };
            }),
        };
      });

      // A label written `=<parameter>` shows that parameter's value.
      const shown = (text: string): string => {
        const name = /^=(.+)$/.exec(text.trim())?.[1]?.toLowerCase();
        const value =
          name && Object.entries(parameters).find(([k]) => k.toLowerCase() === name)?.[1];
        return value ?? text;
      };
      const notes = [
        ...top("4").map((r) => ({
          text: shown(fieldText(r, "Text") ?? ""),
          point: scaledPoint(r),
        })),
        // A text frame's or note's anchor is its top-left corner.
        ...[...top("28"), ...top("209")].map((r) => ({
          text: (fieldText(r, "Text") ?? "").replace(/~1/g, "\n"),
          point: [
            Math.min(scaledField(r, "Location.X"), scaledField(r, "Corner.X")),
            Math.max(scaledField(r, "Location.Y"), scaledField(r, "Corner.Y")),
          ] as Point,
        })),
      ];

      pages.push({
        page: instance ? `${base} (${instance.room})` : base,
        schematic: base,
        name: parameters.Title ?? base,
        size: { name: size.name, width_mil: size.width * 10, height_mil: size.height * 10 },
        title_block: {
          fields: parameters,
          page_number: Number(parameters.SheetNumber) || pages.length + 1,
          page_count: Number(parameters.SheetTotal) || 0,
        },
        parts,
        blocks: top(RECORD_TYPES.SHEET_SYMBOL).map((symbol) => ({
          refdes:
            fieldText(
              (symbol.children ?? []).find((c) => c.RECORD === RECORD_TYPES.SHEET_NAME) ?? {},
              "Text"
            ) ?? "",
          ...at(scaledPoint(symbol)),
        })),
        wires: [...segments(RECORD_TYPES.WIRE, false), ...segments(RECORD_TYPES.BUS, true)],
        net_labels: top(RECORD_TYPES.NET_LABEL).map((r) => ({
          name: fieldText(r, "Text") ?? "",
          ...at(scaledPoint(r)),
        })),
        ports: top(RECORD_TYPES.PORT).map((r) =>
          connector(r, fieldText(r, "Name") ?? "", IO_TYPE[String(field(r, "IOType") ?? "0")])
        ),
        globals: top(RECORD_TYPES.POWER_PORT).map((r) => connector(r, fieldText(r, "Text") ?? "")),
        off_page_connectors: [],
        bus_entries: top(RECORD_TYPES.BUS_ENTRY).map((r) => {
          const a = at(scaledPoint(r));
          const b = at(scaledPoint(r, "Corner"));
          return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
        }),
        text_notes: notes
          .filter((n) => n.text.trim())
          .map((n) => ({ text: n.text, ...at(n.point) })),
        // Altium keeps its compiler's messages out of the sheet.
        erc_markers: [],
      });
      if (draw) {
        try {
          svgs.push(renderAltiumSheet(schematic.records, size, refdes, parameters));
        } catch {
          // Drawing is best-effort: a failure costs that drawing, never the page view.
          svgs.push("");
        }
      }
    }
  }
  const count = pages.length;
  for (const page of pages) page.title_block!.page_count ||= count;
  return { pages, svgs };
};
