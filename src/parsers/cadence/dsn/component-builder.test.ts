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
import type { ComponentDetails } from "../../../types.js";

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
 * Build one component from a single instance carrying `properties`.
 * The instance has no pins, which the property path does not read.
 */
const build = (
  refdes: string,
  properties: Array<[string, string]>,
  sourcePackage = "RES_0402"
): ComponentDetails[string] => {
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
    drawnInstances: [],
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
  return components[refdes];
};

/** The part-number and stuffing fields of one built component. */
const resolve = (
  refdes: string,
  properties: Array<[string, string]>,
  sourcePackage = "RES_0402"
): { mpn?: string; internal_pn?: string; manufacturer?: string; dns?: boolean } => {
  const built = build(refdes, properties, sourcePackage);
  return {
    mpn: built.mpn,
    internal_pn: built.internal_pn,
    manufacturer: built.manufacturer,
    dns: built.dns,
  };
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

/**
 * The part's description, which description search matches against.
 *
 * Before this was read, every .DSN reported no description at all and search
 * told the caller the design had none, though the part records carried one.
 */
describe("description", () => {
  it("reads the description whatever the library calls the property", () => {
    expect(build("C1", [["Description", "CAP CER 0.1UF 16V X7S 0201"]]).description).toBe(
      "CAP CER 0.1UF 16V X7S 0201"
    );
    expect(build("C2", [["DESCRIPTION", "CAP,CER,C0G,0402,50V,10%,22PF"]]).description).toBe(
      "CAP,CER,C0G,0402,50V,10%,22PF"
    );
    expect(build("TP1", [["description", "Testpoint"]]).description).toBe("Testpoint");
    expect(build("U1", [["DESCR", "IC, REG, LDO, 3.3V, 0.3A, SOT23-5"]]).description).toBe(
      "IC, REG, LDO, 3.3V, 0.3A, SOT23-5"
    );
    expect(build("SW1", [["Description:", "Slide Switch SPDT"]]).description).toBe(
      "Slide Switch SPDT"
    );
  });

  /**
   * One design stores these two in both orders on parts of the same kind, and
   * the generic one there is stale: it calls a ferrite bead an inductor.
   */
  it("prefers Part Description over the generic spelling whatever the order", () => {
    const bead = "0603-120ohm-25%-0.05RDC-2.0IDC/BLM18PG121SH1";
    const stale = "CoilInd,Shielded(SHLD),5.6uH@100KHz,+/-30%,2.75A,28mOhm,SMD";
    expect(
      build("FB1", [
        ["Description", stale],
        ["Part Description", bead],
      ]).description
    ).toBe(bead);
    expect(
      build("FB2", [
        ["Part Description", bead],
        ["Description", stale],
      ]).description
    ).toBe(bead);
  });

  it("skips an empty property and omits the field when none carries a value", () => {
    expect(
      build("C1", [
        ["Description", ""],
        ["DESCRIPTION", "SMD CAP Ceramic 100nF"],
      ]).description
    ).toBe("SMD CAP Ceramic 100nF");
    expect(
      build("C2", [
        ["Part Description", "  "],
        ["DESCRIPTION", "SMD CAP Ceramic 1uF"],
      ]).description
    ).toBe("SMD CAP Ceramic 1uF");
    expect(build("R1", [["Description", ""]])).not.toHaveProperty("description");
    expect(build("R2", [["DescriptiveText", "silkscreen note"]])).not.toHaveProperty(
      "description"
    );
  });

  it("takes the description from whichever unit of a part carries it", () => {
    const { strLst, pairs } = makeStrLst([
      ["Description", ""],
      ["Description", "Quad op-amp"],
    ]);
    const unit = (pkgName: string, prefixProperties: typeof pairs): PlacedInstance => ({
      pkgName,
      dbId: 1,
      reference: "U1",
      sourcePackage: "OPAMP",
      partValueIdx: 0,
      prefixProperties,
      locX: 0,
      locY: 0,
      symbolDisplayProps: [],
      t0x10s: [],
      sectionIndex: 0,
    });
    const page: PageData = {
      name: "page1",
      netTable: new Map(),
      wires: [],
      placedInstances: [unit("OPAMP_A.Normal", [pairs[0]]), unit("OPAMP_B.Normal", [pairs[1]])],
      drawnInstances: [],
      ports: [],
      globals: [],
      offPageConnectors: [],
    };
    const components = buildComponents([page], new Map(), strLst, new Map(), EMPTY_PMD, new Map());
    expect(components.U1.description).toBe("Quad op-amp");
  });
});

/**
 * Do Not Stuff read from a part's properties.
 *
 * A library keeps a part's assembly option under a name of its own choosing,
 * and the value alone is not where every design writes it. Before this was
 * read, a board whose every unstuffed part said `ASSY=DNP` reported all of
 * them fitted.
 */
describe("Do Not Stuff from properties", () => {
  it("reads an assembly option whatever the library calls the property", () => {
    expect(resolve("C1", [["ASSY", "DNP"]]).dns).toBe(true);
    expect(resolve("C2", [["ASSY_OPT", "DNP"]]).dns).toBe(true);
    expect(resolve("C3", [["Assembly", "DNP"]]).dns).toBe(true);
    expect(resolve("R1", [["INSTALL", "DNI"]]).dns).toBe(true);
    expect(resolve("R2", [["BuildOptions", "DNI"]]).dns).toBe(true);
    expect(resolve("TP1", [["ASSY", "dni"]]).dns).toBe(true);
  });

  it("reads a part number, manufacturer or description that spells it out", () => {
    expect(resolve("R1", [["MPN", "DNM"]]).dns).toBe(true);
    expect(resolve("R2", [["Manufacturer", "DO NOT MOUNT"]]).dns).toBe(true);
    expect(resolve("R3", [["Description", "RESISTOR, DO NOT MOUNT, 0603, SMD"]]).dns).toBe(true);
    expect(resolve("C4", [["MPN", "CAPACITOR_0402_DNM_N/A_M"]]).dns).toBe(true);
  });

  it("leaves a fitted part alone", () => {
    // The blank and the affirmative spellings the fixtures write on fitted parts.
    expect(resolve("C1", [["ASSY", ""]]).dns).toBeUndefined();
    expect(resolve("C2", [["Assembly", "MOUNT"]]).dns).toBeUndefined();
    expect(resolve("C3", [["No_Mount", "-"]]).dns).toBeUndefined();
    // A property left blank shows as its own name in angle brackets.
    expect(resolve("R4", [["DNP", "<DNP>"]]).dns).toBeUndefined();
    // `NC` is a contact state and `nF` a unit; neither unstuffs a part on its own.
    expect(resolve("S5", [["Description", "SWITCH, SPST, NC"]]).dns).toBeUndefined();
    expect(resolve("C6", [["Capacitance", "2.2 nF"]]).dns).toBeUndefined();
    // A build-option expression names DNI as a condition, not as the part's state.
    expect(
      resolve("R7", [["BuildOptions", "UREG-0064=NumDSP(1)&Mfg(A);DNI=NumDSP(2,4)"]]).dns
    ).toBeUndefined();
    expect(resolve("R8", [["Manufacturer", "Example Mfr"]]).dns).toBeUndefined();
  });
});
