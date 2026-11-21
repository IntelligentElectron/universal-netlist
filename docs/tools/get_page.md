# get_page

Read one schematic page of a Cadence `.DSN` design as drawn.

## Description

Returns the page's parts, wires, net labels, hierarchical ports, globals (power and ground symbols), off-page connectors, bus entries, hierarchical blocks and title-block fields, each with its position. Every net is named exactly as `list_nets` names it, so a result can be followed up with `query_xnet_by_net_name` or `query_component`.

Coordinates are page coordinates in 1/100 inch, x to the right and y down, on every page whether its sheet is imperial or metric.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `design` | string | Yes | - | Path to a `.DSN` design, as returned by `list_designs` |
| `page` | string | Yes | - | The page as `list_pages` names it. Its plain name, or `<schematic>/<page>`, also works when only one page has that name; matching ignores case and spaces at either end |

## Response

```json
{
  "design": "/designs/board/BOARD.DSN",
  "units": "0.01 in, x right, y down",
  "page": "P1: PI",
  "schematic": "SCHEMATIC1",
  "name": "P1: PI",
  "size": { "name": "A4", "width_in": 11.693, "height_in": 8.268 },
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
      "x": 900,
      "y": 340,
      "rotation": 270,
      "mirrored": false,
      "box": [885, 325, 970, 403],
      "pins": [{ "number": "3", "name": "DRAIN", "x": 950, "y": 370, "net": "SCL" }]
    }
  ],
  "blocks": [],
  "wires": [{ "x1": 880, "y1": 180, "x2": 880, "y2": 170, "bus": false, "net": "3V3_RASP" }],
  "net_labels": [{ "name": "GPIO0/2", "x": 820, "y": 240 }],
  "ports": [{ "name": "SDA", "x": 1010, "y": 230, "net": "SDA" }],
  "globals": [{ "name": "3V3_RASP", "x": 870, "y": 160, "net": "3V3_RASP" }],
  "off_page_connectors": [],
  "bus_entries": []
}
```

| Field | Description |
|-------|-------------|
| `parts[].symbol` | The library symbol drawn, such as `RES.Normal` |
| `parts[].rotation` | Counterclockwise, in degrees (0, 90, 180 or 270), applied after the mirror |
| `parts[].box` | The stored bounding box, `[x1, y1, x2, y2]`; all zero on a few parts |
| `parts[].pins` | Each pin with its number, its name where it differs, its position and its net |
| `wires[].bus` | True for a bus wire |
| `wires[].net`, `*.net` | The net, named as `list_nets` names it; omitted where the object joins none |
| `blocks` | Hierarchical blocks on the page, each placing a child schematic |
| `title_block.fields` | The title block's fields, such as `Title`, `Doc`, `RevCode`, `OrgName` |

**Error (page not found):**
```json
{ "error": "Page 'POWER' not found. Use list_pages() to see the design's pages." }
```

**Error (ambiguous name):** a reused schematic's page name matches every placement; pass the full name `list_pages` reports.
