import { describe, expect, it } from "vitest";
import { collectPaddedNetLabelSources } from "./net-label-sources.js";
import type { PageData } from "./page-parser.js";
import type { PageCoordMap } from "./page-groups.js";
import type { GraphicInst } from "./structures.js";
import type { Placement } from "./hierarchy-expander.js";

const SUFFIX = "_U1";

const opc = (pairingId: number, dbId: number, x: number, y: number): GraphicInst => ({
  name: "OFFPAGELEFT-R",
  dbId,
  locX: x,
  locY: y,
  x1: 0,
  y1: 0,
  x2: 0,
  y2: 0,
  pairingId,
  symbolDisplayProps: [],
});

const page = (name: string, offPageConnectors: GraphicInst[], placement?: Placement): PageData =>
  ({
    name,
    netTable: new Map(),
    wires: [],
    placedInstances: [],
    drawnInstances: [],
    ports: [],
    globals: [],
    offPageConnectors,
    placement,
  }) as PageData;

const coordMap = (entries: [string, string][]): PageCoordMap =>
  ({ coordToNet: new Map(entries) }) as unknown as PageCoordMap;

describe("collectPaddedNetLabelSources", () => {
  it("puts an off-page connector inside a block on its placement's net", () => {
    // The design-wide name for pairingId 3 is the unsuffixed "SIG "; on the
    // block page the connector's own wire group is "SIG _U1". A root net
    // "SIG " also exists and must not receive the block page's connector.
    const strLst = ["", "", "", "sig "];
    const placement = { path: ["U1"], suffix: SUFFIX } as unknown as Placement;
    const blockPage = page("BLOCK", [opc(3, 7, 100, 200)], placement);
    const sources = collectPaddedNetLabelSources(
      [blockPage],
      [coordMap([["opc:3:7", "SIG _U1"]])],
      new Map(),
      new Map([[3, "SIG "]]),
      strLst,
      { "SIG ": { R1: ["1"] }, "SIG _U1": { R2: ["1"] } }
    );
    expect(sources).toEqual({
      "SIG _U1": [{ kind: "off_page_connector", text: "SIG ", page: "BLOCK (U1)", x: 100, y: 200 }],
    });
  });

  it("falls back to the design-wide name for a connector no wire group holds", () => {
    const sources = collectPaddedNetLabelSources(
      [page("ROOT", [opc(3, 7, 10, 20)])],
      [coordMap([])],
      new Map(),
      new Map([[3, "SIG "]]),
      ["", "", "", "SIG "],
      { "SIG ": { R1: ["1"] } }
    );
    expect(sources?.["SIG "]).toHaveLength(1);
  });

  it("lists nothing for a connector whose text names another net", () => {
    const sources = collectPaddedNetLabelSources(
      [page("ROOT", [opc(3, 7, 10, 20)])],
      [coordMap([["opc:3:7", "OTHER"]])],
      new Map(),
      new Map([[3, "SIG "]]),
      ["", "", "", "SIG "],
      { "SIG ": { R1: ["1"] }, OTHER: { R2: ["1"] } }
    );
    expect(sources).toBeUndefined();
  });
});
