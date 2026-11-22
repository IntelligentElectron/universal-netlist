# list_pages

List the schematic pages of a Cadence `.DSN` or KiCad design.

## Description

Returns every page, in the order the netlist reads them for a `.DSN` and in page-number order for a KiCad design, with its schematic, sheet size, title and page number from its title block, and how many parts, nets, hierarchical ports and off-page connectors it holds. A schematic that several hierarchical blocks place appears once per placement, named `<page> (block <path>)`, because each placement carries its own reference designators and nets. A KiCad design has one page per sheet instance, named by its sheet path (`Power`, `Power/LDO`); the root sheet is named by its own name. Use [`get_page`](get_page.md) to read one page.

Pages are read from Cadence OrCAD `.DSN` schematics only.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `design` | string | Yes | - | Path to a `.DSN` design or a KiCad `.kicad_pro` project, as returned by `list_designs` |

Pages do not depend on a design variant, so the tool takes none.

## Response

```json
{
  "design": "/designs/board/BOARD.DSN",
  "pages": [
    {
      "page": "P1: PI",
      "schematic": "SCHEMATIC1",
      "name": "P1: PI",
      "size": { "name": "A4", "width_mil": 11693, "height_mil": 8268 },
      "title": "MULTIO-PI",
      "page_number": 1,
      "parts": 33,
      "nets": 17,
      "ports": 5,
      "off_page_connectors": 0
    }
  ]
}
```

| Field | Description |
|-------|-------------|
| `page` | The name to pass to `get_page`: for a `.DSN`, the page name, with `(block <path>)` for one placement of a reused schematic; for KiCad, the sheet path |
| `schematic` | The schematic folder the page belongs to |
| `size` | The sheet size name and its width and height in mils |
| `title`, `page_number` | From the page's title block; omitted when it has none |
| `nets` | Distinct nets on the page's wires and pins, not counting `NC` |

**Error (not a Cadence or KiCad design):**
```json
{ "error": "Pages are read from Cadence .DSN and KiCad designs only. Use list_designs() first." }
```
