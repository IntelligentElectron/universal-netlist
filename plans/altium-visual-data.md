# Altium Schematic Visual Data Extraction

**Goal**: Extract non-electrical visual/drawing data from `.SchDoc` files for future schematic rendering.

**Context**: The current Altium parser (`src/parsers/altium/`) only extracts electrical data (components, pins, nets) into the unified `ParsedNetlist` model. However, `.SchDoc` files contain rich visual information that could enable schematic rendering in a browser (e.g., in `pcb-viewer` or a new `schematic-viewer`).

**Reference**: The [Altium-Schematic-Parser](https://github.com/a3ng7n/Altium-Schematic-Parser) project demonstrates raw record-level extraction of all 51 record types, including drawing primitives. It can serve as a reference for what data is available.

**Data to extract** (record types not currently used):

| Record | Type | Visual Data |
|--------|------|-------------|
| 4 | Annotation | Text boxes with position, color, font |
| 5 | Bezier | Bezier curve coordinates |
| 6 | Polyline | Line segments with X/Y coordinates, color, width |
| 7 | Polygon | Filled polygonal regions |
| 8 | Ellipse | Elliptical shapes |
| 10 | Round Rectangle | Rounded rectangles |
| 11 | Elliptical Arc | Arc segments |
| 12 | Arc | Circular arcs |
| 13 | Line | Simple lines |
| 14 | Rectangle | Rectangular shapes |
| 28 | Text Frame | Text with bounding box |
| 29 | Junction | Wire junction dots |
| 30 | Image | Embedded images |
| 31 | Sheet | Page size, grid, title block, border |
| 32 | Sheet Name | Sheet title |
| 33 | Sheet File Name | File reference |
| 34 | Designator | Component designator text with position/font |
| 39 | Template | Title block template reference |
| 44/45 | Model Container/Reference | Symbol geometry from library |

**Notes**:
- This data is NOT for MCP tool responses; it is for rendering schematics visually.
- Parsing should produce a separate visual model alongside `ParsedNetlist`, not pollute the electrical data.
- Pin coordinates, wire coordinates, and component positions are already partially available but discarded after connectivity resolution.
- The standalone parser uses geometry-based connectivity (bounding box intersection), while universal-netlist uses Union-Find with spatial grid indexing. The visual extraction should reuse the existing OLE/record parsing infrastructure.
