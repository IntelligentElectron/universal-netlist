# render_page

Render one schematic page of a Cadence `.DSN` or KiCad design as a PNG image.

## Description

Draws the page from the design file itself: symbols placed with their rotation and mirror, pins with their numbers and (on parts with four or more pins) their names, property text such as reference designators and values, wires and buses, junction dots, net labels, hierarchical ports and blocks, power and ground symbols, off-page connectors, free text and shapes, and the title block. No Capture installation is needed.

A KiCad page is drawn from its `.kicad_sch` file and the symbols embedded in it: shapes, pins with their names and numbers as the symbol shows them, visible fields such as reference (with the unit letter on multi-unit parts) and value, wires, buses, bus entries, junctions, no-connect flags, local, global and hierarchical labels, sheet symbols with their pins, and text and text boxes. The sheet border is drawn; KiCad's drawing-sheet frame and title block are not. No KiCad installation is needed.

Pass `focus` to crop to one part (a refdes) or to everything on one net, with a margin. Over MCP the image comes back as image content, followed by a short JSON result; on the command line the PNG is written to a file.

Pages are read from Cadence OrCAD `.DSN` schematics and KiCad designs.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `design` | string | Yes | - | Path to a `.DSN` design or a KiCad `.kicad_pro` project, as returned by `list_designs` |
| `page` | string | Yes | - | The page as `list_pages` names it |
| `focus` | string | No | - | A refdes or net name on the page: crop to that part, or to everything on that net. Omit for the whole page |
| `output` | string | No | `<page>.png` | Command line only: the PNG path to write |

## Response

Over MCP: an `image/png` content item, then:

```json
{
  "design": "/designs/board/BOARD.DSN",
  "page": "P1: PI",
  "focus": "Q1",
  "width": 1000,
  "height": 903
}
```

On the command line the same fields, plus `output`, the absolute path of the written PNG.

A whole page renders at about 180 pixels per inch of sheet width; a crop at 1,000 to 2,400 pixels wide.

**Error (nothing to focus on):**
```json
{ "error": "'NOPE' is neither a part nor a net on page 'P1: PI'. Use get_page() to see what the page holds." }
```

## Notes

- Colours are a plain scheme (black symbols and text, blue wires): the colour indexes stored in the file have no verified meaning.
- Text uses Liberation Sans, which has Arial's metrics, Capture's default face.
- Bitmaps and embedded OLE objects are not drawn.
