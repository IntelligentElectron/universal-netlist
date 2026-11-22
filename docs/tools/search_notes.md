# search_notes

Search the text notes on every schematic page of a Cadence `.DSN` or KiCad design.

## Description

A note is free text the designer placed on a page: default jumper settings, current ratings, assembly options, references to other sheets. No netlist carries it. `search_notes` returns every note whose text matches a regex pattern, case-insensitively, with the page it is on, named as [`list_pages`](list_pages.md) names it, and its position. Search for a net or part name to find the notes that mention it, or pass `.` to list every note. [`get_page`](get_page.md) returns the same notes for one page under `text_notes`.

Pages are read from Cadence OrCAD `.DSN` schematics only. Notes do not depend on a design variant, so the tool takes none.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `design` | string | Yes | - | Path to a `.DSN` design or a KiCad `.kicad_pro` project, as returned by `list_designs` |
| `pattern` | string | Yes | - | Regex pattern, matched case-insensitively against each note's text |
| `max_results` | integer | No | 50 | Max `text_notes` entries to return |
| `offset` | integer | No | 0 | Index of the first `text_notes` entry to return, from `next_offset` |

## Response

```json
{
  "design": "/designs/fmc/HB1A-AAFM.DSN",
  "units": "mil (0.001 in), x right, y down",
  "text_notes": [
    {
      "page": "AAFM Top",
      "text": "FMC_CPLD_[3:0] used as\n4-bit bidir bus",
      "x": 3500,
      "y": 4900
    }
  ]
}
```

| Field | Description |
|-------|-------------|
| `text_notes[].page` | The page the note is on, as `list_pages` names it; a reused schematic's notes appear once per placement |
| `text_notes[].text` | The note's text; lines are separated by `\n` |
| `text_notes[].x`, `text_notes[].y` | The note's baseline-left position in page coordinates (mils) |

`text_notes` is paged. When a page does not hold every entry, `notes` says which entries it holds, and `next_offset` is the offset of the next page while more remain. A pattern that matches nothing returns an empty `text_notes`.

**Error (not a Cadence or KiCad design):**
```json
{ "error": "Pages are read from Cadence .DSN and KiCad designs only. Use list_designs() first." }
```

**Error (bad pattern):**
```json
{ "error": "Invalid regex pattern '('" }
```
