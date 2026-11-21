import path from "node:path";
import { describe, expect, it } from "vitest";
import { isValidRefdes, getRefdesPrefix, matchesRefdesType } from "./circuit-traversal.js";
import { buildComponents } from "./parsers/cadence/dsn/component-builder.js";
import { buildNetConnectivity } from "./parsers/cadence/dsn/net-builder.js";
import { buildDeviceIndexMap } from "./parsers/cadence/dsn/pin-resolver.js";
import type { PageData } from "./parsers/cadence/dsn/page-parser.js";
import type { PinMapData } from "./parsers/cadence/dsn/structure-types.js";
import { cellName, readTable } from "../test/helpers/decision-table.js";

const TABLES = path.resolve(__dirname, "../docs/decision-tables/refdes");
const stems: Record<string, string> = {
  letters: "usb1",
  underscore: "X1_0",
  "hierarchy path": "@ROOT.SHEET:INS1@PART",
  "digit first": "1X",
  empty: "",
};
const leading: Record<string, string> = { none: "", "one hyphen": "-", "two hyphens": "--" };
const suffix: Record<string, string> = { none: "", "duplicate index": "~2", "non-numeric": "~x" };

/** Replay the shared validator and the Cadence builders that formerly dropped the part. */
describe("golden table: reference-designators", () => {
  for (const row of readTable(TABLES, "reference-designators")) {
    it(cellName(row, ["stem", "leading", "suffix"]), () => {
      const refdes = leading[row.leading] + stems[row.stem] + suffix[row.suffix];
      const keep = row.outcome === "preserved";
      expect(isValidRefdes(refdes)).toBe(keep);
      const page: PageData = {
        name: "Synthetic",
        netTable: new Map(),
        sizeName: "A",
        widthInches: 11,
        heightInches: 8.5,
        busEntries: [],
        ercMarkers: [],
        graphics: [],
        wires: [],
        drawnInstances: [],
        ports: [],
        globals: [],
        offPageConnectors: [],
        placedInstances: [
          {
            pkgName: "DEMO.Normal",
            sourcePackage: "DEMO",
            dbId: 1,
            reference: refdes,
            partValueIdx: 0,
            prefixProperties: [],
            locX: 0,
            locY: 0,
            sectionIndex: 0,
            box: { x1: 0, y1: 0, x2: 0, y2: 0 },
            rotation: 0,
            mirrored: false,
            symbolDisplayProps: [],
            t0x10s: [
              { pinIndex: 1, pointX: 10, pointY: 20, wireId: 0, netId: 0, symbolDisplayProps: [] },
            ],
          },
        ],
      };
      const pmd: PinMapData = {
        pinMaps: new Map([["DEMO", ["7"]]]),
        cachePinMaps: new Map(),
        deviceUnitRefs: new Map(),
        pinIgnores: new Map(),
        cachePinIgnores: new Map(),
      };
      const devices = buildDeviceIndexMap([page]);
      const { nets, componentPins } = buildNetConnectivity([page], new Set(), pmd, devices, []);
      const components = buildComponents([page], componentPins, [], new Map(), pmd, devices);
      if (keep) {
        const prefix = row.stem === "letters" ? "USB" : "X";
        expect(getRefdesPrefix(refdes)).toBe(prefix);
        expect(matchesRefdesType(refdes, prefix.toLowerCase())).toBe(true);
        expect(components[refdes].pins).toEqual({ "7": "NC" });
        expect(nets.NC[refdes]).toEqual(["7"]);
        expect(devices.get(1)).toBe(0);
      } else {
        expect(Object.keys(components)).toEqual([]);
        expect(Object.keys(nets)).toEqual([]);
        expect(devices.has(1)).toBe(false);
      }
    });
  }
});
