/**
 * Part-number resolution from a PlacedInstance's prefix properties.
 *
 * A record stores its properties in whatever order Cadence wrote them, and
 * `GenericParser::read_single_prefix_short` keeps that order verbatim, so these
 * tests build the same properties in different orders on purpose: order is the
 * variable that used to decide the answer.
 */

import { describe, it, expect } from "vitest";
import { buildComponents } from "./component-builder.js";
import type { PageData } from "./page-parser.js";
import type { PlacedInstance } from "./structures.js";
import type { CachedLibraryPart, PinMapData } from "./structure-types.js";

/** Interned string list, as the Library stream provides it. */
const makeStrLst = (
  properties: Array<[string, string]>
): { strLst: string[]; pairs: Array<readonly [number, number]> } => {
  const strLst: string[] = [""];
  const pairs: Array<readonly [number, number]> = [];
  for (const [name, value] of properties) {
    strLst.push(name);
    const nameIdx = strLst.length - 1;
    strLst.push(value);
    pairs.push([nameIdx, strLst.length - 1] as const);
  }
  return { strLst, pairs };
};

const EMPTY_PMD: PinMapData = {
  pinMaps: new Map(),
  cachePinMaps: new Map(),
  deviceUnitRefs: new Map(),
  pinIgnores: new Map(),
  cachePinIgnores: new Map(),
};

/**
 * Resolve one component built from a single instance carrying `properties`.
 * The instance has no pins, which the part-number path does not read.
 */
const resolve = (
  refdes: string,
  properties: Array<[string, string]>,
  sourcePackage = "RES_0402"
): { mpn?: string; internal_pn?: string; manufacturer?: string } => {
  const { strLst, pairs } = makeStrLst(properties);
  const instance: PlacedInstance = {
    pkgName: `${sourcePackage}.Normal`,
    dbId: 1,
    reference: refdes,
    sourcePackage,
    partValueIdx: 0,
    prefixProperties: pairs,
    locX: 0,
    locY: 0,
    symbolDisplayProps: [],
    t0x10s: [],
    sectionIndex: 0,
  };
  const page: PageData = {
    name: "page1",
    netTable: new Map(),
    wires: [],
    placedInstances: [instance],
    ports: [],
    globals: [],
    offPageConnectors: [],
  };

  const components = buildComponents(
    [page],
    new Map(),
    strLst,
    new Map<string, CachedLibraryPart>(),
    EMPTY_PMD,
    new Map()
  );
  const built = components[refdes];
  return { mpn: built.mpn, internal_pn: built.internal_pn, manufacturer: built.manufacturer };
};

describe("part number resolution", () => {
  /**
   * The defect this guards against: two instances of one part whose records
   * list the same properties in different orders resolved to different
   * namespaces, splitting a single part into two groups and leaving the ones
   * that resolved to the manufacturer's number with no key into a component
   * database. Both orders must now give the same answer.
   */
  it("resolves the same part identically whatever order the record stores it in", () => {
    const internalFirst: Array<[string, string]> = [
      ["PART_NUMBER", "INT-1001"],
      ["DESCRIPTION", "RES, 0.0 OHM, 1/32W, 0.5A, 01005"],
      ["Manufacturer", "Example Mfr"],
      ["Manufacturer PN", "MFRA-0R00-01005"],
    ];
    const manufacturerFirst: Array<[string, string]> = [
      ["Manufacturer PN", "MFRA-0R00-01005"],
      ["Manufacturer", "Example Mfr"],
      ["DESCRIPTION", "RES, 0.0 OHM, 1/32W, 0.5A, 01005"],
      ["PART_NUMBER", "INT-1001"],
    ];

    expect(resolve("R1", internalFirst)).toEqual({
      mpn: "MFRA-0R00-01005",
      internal_pn: "INT-1001",
      manufacturer: "Example Mfr",
    });
    expect(resolve("R2", manufacturerFirst)).toEqual(resolve("R1", internalFirst));
  });

  /**
   * `mpn` names the manufacturer's number. A record that also carries the
   * design owner's number is naming two different things, not one thing twice,
   * so neither may be written into the other's field.
   */
  it("keeps the manufacturer's number and the design's own in separate fields", () => {
    expect(
      resolve("C1", [
        ["MPN", "MFRA-100N-0402"],
        ["Manufacturer", "Example Mfr"],
        ["Part Number", "INT-2001"],
      ])
    ).toEqual({
      mpn: "MFRA-100N-0402",
      internal_pn: "INT-2001",
      manufacturer: "Example Mfr",
    });
  });

  it("prefers PART_NUMBER over the other spellings of the design's number", () => {
    expect(
      resolve("R1", [
        ["PN", "INT-3001"],
        ["Part Number", "INT-2001"],
        ["PART_NUMBER", "INT-1001"],
      ]).internal_pn
    ).toBe("INT-1001");
  });

  /**
   * A library that fills `MPN` by hand fills it with whatever was nearby, often
   * the symbol's own name, so a more specific spelling wins wherever the record
   * offers one.
   */
  it("prefers a specific manufacturer spelling over the generic MPN", () => {
    expect(
      resolve("C1", [
        ["MPN", "CAP_0402_100N_X7R_10V"],
        ["Vendor Part Number", "MFRA-100N-0402"],
      ]).mpn
    ).toBe("MFRA-100N-0402");
  });

  /**
   * A design recording only one of the two numbers reports only that one. The
   * other field is absent rather than filled from it: they are different
   * namespaces and one cannot stand in for the other.
   */
  it("omits the field the record does not carry", () => {
    expect(resolve("C1", [["Manufacturer Part Number", "MFRB-100N-0402"]])).toEqual({
      mpn: "MFRB-100N-0402",
      internal_pn: undefined,
      manufacturer: undefined,
    });
    expect(resolve("C2", [["PART_NUMBER", "INT-1001"]])).toEqual({
      mpn: undefined,
      internal_pn: "INT-1001",
      manufacturer: undefined,
    });
  });

  /** Libraries leave a property in place with no value; that is not a match. */
  it("skips a property that is present but empty", () => {
    expect(
      resolve("C1", [
        ["Part Number", ""],
        ["PN", "INT-3001"],
        ["Manufacturer Part Number", "MFRB-100N-0402"],
      ])
    ).toEqual({
      mpn: "MFRB-100N-0402",
      internal_pn: "INT-3001",
      manufacturer: undefined,
    });
  });

  /**
   * The package name is a footprint, not an orderable part, so it is never
   * written into `mpn`. A record with no part number reports none.
   */
  it("never reports the package name as a part number", () => {
    expect(resolve("R9", [["Manufacturer", "Example Mfr"]], "RES_0402")).toEqual({
      mpn: undefined,
      internal_pn: undefined,
      manufacturer: "Example Mfr",
    });
  });
});
