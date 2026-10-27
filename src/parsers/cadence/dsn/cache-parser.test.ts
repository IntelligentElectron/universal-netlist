/**
 * LibraryPart indexing: which record owns a given lookup key.
 *
 * Instances refer to a part by a suffix-stripped name, so every part is also
 * registered under that stripped form. Two variants of the same base part then
 * compete for one key, and picking the wrong winner costs the pin function names
 * of every instance of the plain variant.
 */

import { describe, expect, it } from "vitest";
import { indexLibraryPart, listDeviceUnits } from "./cache-parser.js";
import type { CachedLibraryPart, PinMapData } from "./structure-types.js";

const part = (name: string, pinNames: string[]) => ({ name, pinNames });

const index = (...parts: { name: string; pinNames: string[] }[]) => {
  const cachedParts = new Map<string, CachedLibraryPart>();
  const exactNames = new Set<string>();
  for (const p of parts) indexLibraryPart(p, cachedParts, exactNames);
  return cachedParts;
};

describe("indexLibraryPart", () => {
  it("registers a part under its own name and its stripped form", () => {
    const parts = index(part("DIODE_0.Normal", ["A", "C"]));

    expect(parts.get("DIODE_0.Normal")?.pinNames).toEqual(["A", "C"]);
    expect(parts.get("DIODE.Normal")?.pinNames).toEqual(["A", "C"]);
  });

  it("lets a part's own name displace an alias another variant left there", () => {
    // Verbatim from a real library: RES_0.Normal names its pins by number and
    // strips to RES.Normal, while the real RES.Normal names them A and B. First
    // writer wins gave every plain resistor the numbering, and a pin name equal
    // to the pin number is dropped, so those parts reported no names at all.
    const parts = index(part("RES_0.Normal", ["1", "2"]), part("RES.Normal", ["A", "B"]));

    expect(parts.get("RES.Normal")?.pinNames).toEqual(["A", "B"]);
    expect(parts.get("RES_0.Normal")?.pinNames).toEqual(["1", "2"]);
  });

  it("keeps a part's own name whatever order the aliases arrive in", () => {
    const parts = index(part("RES.Normal", ["A", "B"]), part("RES_0.Normal", ["1", "2"]));

    expect(parts.get("RES.Normal")?.pinNames).toEqual(["A", "B"]);
  });

  it("keeps the first record when two claim the same exact name", () => {
    const parts = index(part("IC.Normal", ["VCC"]), part("IC.Normal", ["GND"]));

    expect(parts.get("IC.Normal")?.pinNames).toEqual(["VCC"]);
  });

  it("does not let a later alias displace an earlier one", () => {
    const parts = index(part("PART_1.Normal", ["X"]), part("PART_2.Normal", ["Y"]));

    expect(parts.get("PART.Normal")?.pinNames).toEqual(["X"]);
  });

  it("leaves a name with no strippable suffix alone", () => {
    const parts = index(part("PLAIN.Normal", ["P"]));

    expect([...parts.keys()]).toEqual(["PLAIN.Normal"]);
  });
});

describe("listDeviceUnits", () => {
  const pmd = (): PinMapData => ({
    pinMaps: new Map(),
    cachePinMaps: new Map(),
    deviceUnitRefs: new Map(),
    pinIgnores: new Map(),
    cachePinIgnores: new Map(),
  });
  const devices = (...units: string[]) => units.map((unitRef) => ({ unitRef }));

  // DIGITALCONVERTOR.DSN (issue #247): `LM324_0` stores its section maps under
  // both `LM324_0B` and `LM324B`, so the sections are listed under both names.
  it("lists the units under the package name and its stripped form", () => {
    const data = pmd();
    listDeviceUnits(data, ["LM324", "LM324_0"], devices("A", "B", "C", "D"));

    expect(data.deviceUnitRefs.get("LM324")).toEqual(["A", "B", "C", "D"]);
    expect(data.deviceUnitRefs.get("LM324_0")).toEqual(["A", "B", "C", "D"]);
  });

  it("keeps the list of the first package to claim a name", () => {
    const data = pmd();
    listDeviceUnits(data, ["RPAK", "RPAK_1"], devices("A", "B"));
    listDeviceUnits(data, ["RPAK", "RPAK_2"], devices("A", "B", "C"));

    expect(data.deviceUnitRefs.get("RPAK")).toEqual(["A", "B"]);
    expect(data.deviceUnitRefs.get("RPAK_2")).toEqual(["A", "B", "C"]);
  });
});
