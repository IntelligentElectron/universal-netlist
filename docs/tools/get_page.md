# get_page

Read one schematic page of a Cadence `.DSN`, KiCad or Altium design as drawn.

## Description

Returns the page's parts, wires, net labels, hierarchical ports, globals (power and ground symbols, KiCad global labels, Altium power ports), off-page connectors, bus entries, hierarchical blocks and title-block fields, each with its position. Every net is named exactly as `list_nets` names it, so a result can be followed up with `query_xnet_by_net_name` or `query_component`.

Coordinates are page coordinates in mils (1/1000 inch), x to the right and y down from the sheet's top-left corner, on every page whether its sheet is imperial or metric.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `design` | string | Yes | - | Path to a `.DSN` design, a KiCad `.kicad_pro` project or an Altium `.PrjPcb` project, as returned by `list_designs` |
| `page` | string | Yes | - | The page as `list_pages` names it. Its plain name, or `<schematic>/<page>`, also works when only one page has that name; matching ignores case and spaces at either end |

## Response

```json
{
  "design": "/designs/board/BOARD.DSN",
  "units": "mil (0.001 in), x right, y down",
  "page": "P1: PI",
  "schematic": "SCHEMATIC1",
  "name": "P1: PI",
  "size": { "name": "A4", "width_mil": 11693, "height_mil": 8268 },
  "title_block": {
    "fields": { "Title": "MULTIO-PI", "Doc": "Fen Logic Ltd.", "RevCode": "E" },
    "page_number": 1,
    "page_count": 2
  },
  "parts": [
    {
      "refdes": "Q2",
      "value": "2N7000_TO92",
      "symbol": "2N7000_TO92.Normal",
      "x": 9000,
      "y": 3400,
      "rotation": 270,
      "mirrored": false,
      "box": [8850, 3250, 9700, 4030],
      "pins": [{ "number": "3", "name": "DRAIN", "type": "passive", "x": 9500, "y": 3700, "net": "SCL" }]
    }
  ],
  "blocks": [],
  "wires": [{ "x1": 8800, "y1": 1800, "x2": 8800, "y2": 1700, "bus": false, "net": "3V3_RASP" }],
  "net_labels": [{ "name": "GPIO0/2", "x": 8200, "y": 2400 }],
  "ports": [{ "name": "SDA", "type": "bidirectional", "x": 10100, "y": 2300, "net": "SDA" }],
  "globals": [{ "name": "3V3_RASP", "x": 8700, "y": 1600, "net": "3V3_RASP" }],
  "off_page_connectors": [],
  "bus_entries": [],
  "erc_markers": [],
  "text_notes": [{ "text": "Pull-ups fitted on\nthe main board", "x": 6400, "y": 4100 }]
}
```

| Field | Description |
|-------|-------------|
| `parts[].symbol` | The library symbol drawn, such as `RES.Normal` |
| `parts[].rotation` | Counterclockwise, in degrees (0, 90, 180 or 270), applied after the mirror |
| `parts[].box` | The bounding box, `[x1, y1, x2, y2]`: stored in a `.DSN` (all zero on a few parts), computed from the symbol's drawing and pins in KiCad, and from the drawn part's graphics in Altium |
| `parts[].pins` | Each pin with its number, its name where it differs, its electrical type as `query_component` reports it, its position and its net |
| `wires[].bus` | True for a bus wire |
| `wires[].net`, `*.net` | The net, named as `list_nets` names it; omitted where the object joins none of the netlist's nets: a bus wire or bus port, which carries several, and a wire that reaches no pin |
| `blocks` | Hierarchical blocks on the page, each placing a child schematic |
| `title_block.fields` | The title block's fields, such as `Title`, `Doc`, `RevCode`, `OrgName` |
| `ports[].type` | The port's direction: `input`, `output`, `bidirectional`, `passive`, `power`, or another of the pin types |
| `erc_markers` | Markers Capture's design rules check left on the page and that were still there when the file was saved: `message` (such as `WARNING(ORCAP-1600): Net has fewer than two connections`), `detail` (often the net or pin), `location` (the page and position as Capture writes it, sometimes empty), and `x`, `y`. A marker with no text is left out. `run_erc` lists them as `capture.erc_error` and `capture.erc_warning`. KiCad and Altium save no markers in their schematics, so their pages have none |
| `text_notes` | Free text the designer placed on the page, each with its baseline-left position; lines are separated by `\n`. [`search_notes`](search_notes.md) searches them across every page |

**Error (page not found):**
```json
{ "error": "Page 'POWER' not found. Use list_pages() to see the design's pages." }
```

**Error (ambiguous name):** a reused schematic's page name matches every placement; pass the full name `list_pages` reports.
