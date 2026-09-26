/**
 * Do Not Stuff, measured against the boards' own statements of what is built.
 *
 * A Cadence schematic says a part is off the board in three places: a marker in
 * its value, an assembly property on the part (`ASSY=DNP`, `INSTALL=DNI`), and
 * the CIS variant store. A query reads all three, and a result always describes
 * one build: a design that declares CIS variants has only those to build, and a
 * design that declares none has its base build with every part's own state.
 *
 * LAUNCHXL-CC1310 ships a CIS-generated BOM spreadsheet beside the schematic,
 * built from these very variants. Twenty-five of its part references are written
 * with Part Number `DNM` and Quantity 0, and those are the parts below. None of
 * them carries a DNS marker in its value, so the .dat parsers see an ordinary
 * part and the count answered before this was eleven, all of them found by other
 * means and all of them inside this set.
 *
 * Assert both the active schematic parser and the retained DAT oracle. DAT
 * parsing remains available to regression tests while dormant in MCP.
 */

import { describe, expect, it } from "vitest";
import { cadenceHandler, parseCadenceDatDesign } from "./index.js";
import { fixturePath, hasFixtures } from "../../../test/utils.js";
import { loadNetlist } from "../../service/load-netlist.js";
import { runErc } from "../../service/tools/run-erc.js";
import type { ErrorResult } from "../../types.js";

const CC1310 = ["cadence", "LAUNCHXL-CC1310", "doc", "hardware", "cc1310", "launchpad"];
const JETSON = ["cadence", "OSHW-Jetson-Series"];

const DSN = fixturePath(...CC1310, "design_files", "Cadence", "LAUNCHXL-CC1310.DSN");
const PSTXNET = fixturePath(...CC1310, "design_files", "Cadence", "Allegro", "pstxnet.dat");
const J2032 = fixturePath(
  ...JETSON,
  "reServer Jetson carrier board",
  "reServer J2032",
  "Schematic",
  "reServer J2032_V1.DSN"
);
const J401_V11 = fixturePath(
  ...JETSON,
  "reServer Jetson carrier board",
  "reServer Industrial J401",
  "Schematic",
  "reServer industrial J401 Carrier Board v11.DSN"
);
const J201 = fixturePath(
  ...JETSON,
  "reComputer Jetson carrier board",
  "reComputer Industrial J201",
  "Schematic",
  "reComputer Industrial J201_V1.2.DSN"
);
const RECOMPUTER_J401 = fixturePath(
  ...JETSON,
  "reComputer Jetson carrier board",
  "reComputer J401",
  "Schematic",
  "reComputer J401_V1.0.DSN"
);
const OC_CONNECT = fixturePath("cadence", "opencellular-sdr", "OC_CONNECT1_SDR_REV_C_V1P1.DSN");
const BEAGLEBONE = fixturePath("cadence", "BeagleBone-Black", "ALLEGRO", "BEAGLEBONEBLK_C3.DSN");
const CUTIEPI = fixturePath("cadence", "CutiePi", "CutiePi_V2.3-20210409.DSN");

/** Every part the CIS BOM writes as `DNM` with Quantity 0. */
const BOM_DO_NOT_STUFF = [
  "A1",
  "C24",
  "C58",
  "FIDU1",
  "FIDU2",
  "FIDU3",
  "FIDU4",
  "FIDU5",
  "FIDU6",
  "MH1",
  "MH2",
  "MH3",
  "MH4",
  "MH5",
  "P8",
  "R13",
  "R19",
  "R21",
  "R46",
  "R47",
  "R48",
  "R49",
  "R51",
  "R59",
  "R60",
];

const dnsRefdes = async (designPath: string, variant?: string): Promise<string[]> => {
  const parsed = await (designPath.endsWith(".dat")
    ? parseCadenceDatDesign(designPath)
    : cadenceHandler.parse(designPath, variant ? { variant } : undefined));
  return Object.entries(parsed.components)
    .filter(([, component]) => component.dns)
    .map(([refdes]) => refdes)
    .sort();
};

describe.skipIf(!hasFixtures)("variant Do Not Stuff", { timeout: 60_000 }, () => {
  it("reports the BOM's unstuffed parts through the retained DAT parser", async () => {
    expect(await dnsRefdes(PSTXNET)).toEqual(BOM_DO_NOT_STUFF);
  });

  it("reports the same set for a query against the schematic", async () => {
    expect(await dnsRefdes(DSN)).toEqual(BOM_DO_NOT_STUFF);
  });

  it("selects the BOM variant by name and refuses the base build the design does not have", async () => {
    expect(await cadenceHandler.listVariants?.(DSN)).toEqual([
      { name: "Standard", fabrication: true },
    ]);

    expect(await dnsRefdes(DSN, "standard")).toEqual(BOM_DO_NOT_STUFF);

    // A CIS variant is the assembly a BOM is generated for, and nothing marks
    // the bare schematic as one. Reading `<Default>` here used to answer with
    // every variant's parts fitted, a board that is never built.
    await expect(cadenceHandler.parse(DSN, { variant: "<Default>" })).rejects.toThrow(
      "'<Default>' is not a build of this design: its variants ['Standard'] are the assemblies it records"
    );
    expect(await loadNetlist(DSN, "<Default>")).toEqual({
      error: expect.stringContaining("'<Default>' is not a build of design 'LAUNCHXL-CC1310.DSN'"),
    });
    expect(await loadNetlist(DSN, "default")).toEqual({
      error: expect.stringContaining("is not a build of design"),
    });
  });

  it("refuses a query that names no build, listing only the builds the design has", async () => {
    const result = (await loadNetlist(J2032)) as ErrorResult;
    expect(result.error).toContain("defines design variants ['Main']");
    expect(result.error).toContain("they are the only builds it records");
    expect(result.error).not.toContain("<Default>");
  });

  /**
   * reServer J2032 marks R232 `ASSY=DNP` on the part and names it in no variant
   * group, and the Main variant's 77 group members carry `ASSY=DNP` too. The
   * part's own property is honoured under the selected variant, so the build
   * reports all 78.
   */
  it("reads a part's own assembly property under a selected variant", async () => {
    const dns = await dnsRefdes(J2032, "Main");
    expect(dns).toHaveLength(78);
    expect(dns).toContain("R232");
    expect(dns).toContain("R123");
  });

  it("leaves a fitted part alone whatever the variant says of its neighbours", async () => {
    const parsed = await cadenceHandler.parse(J2032, { variant: "Main" });
    expect(parsed.components.R1?.dns).toBeUndefined();
    expect(parsed.components.U2?.dns).toBeUndefined();
  });

  it("counts every unstuffed part in an ERC run on the selected build", async () => {
    expect(await runErc(J401_V11, { designVariant: "version A" })).toMatchObject({
      design_variant: "version A",
      skipped: { dns: 287 },
    });
  });
});

/**
 * Do Not Stuff on designs that declare no variant at all.
 *
 * These boards mark unstuffed parts with an assembly property alone: no marker
 * in the value and no CIS variant. Every one of them reported zero parts off
 * the board before the property was read, and the DAT export cannot know
 * better, because the property is not written into it.
 */
describe.skipIf(!hasFixtures)("assembly property Do Not Stuff", { timeout: 60_000 }, () => {
  it("reads `ASSY=DNP` on a design whose variant store is empty", async () => {
    const dns = await dnsRefdes(J201);
    expect(dns).toHaveLength(174);
    expect(dns).toEqual(expect.arrayContaining(["C186", "C188", "C189", "C192"]));
    expect(await dnsRefdes(J201, "<Default>")).toEqual(dns);
    expect(await dnsRefdes(RECOMPUTER_J401)).toHaveLength(103);
  });

  it("reads the spelling each library gives the property", async () => {
    // `Assembly=DNP`, with `Assembly=MOUNT` on the fitted parts.
    expect(await dnsRefdes(OC_CONNECT)).toHaveLength(158);
    // `ASSY=DNI`, with `ASSY=` left blank on the fitted parts.
    expect(await dnsRefdes(BEAGLEBONE)).toHaveLength(37);
    // `ASSY_OPT=DNP` on 39 parts, beside 22 whose value carries the marker.
    expect(await dnsRefdes(CUTIEPI)).toHaveLength(61);
  });

  it("offers the base build and answers queries on it", async () => {
    expect(await cadenceHandler.listVariants?.(J201)).toEqual([]);
    expect(await loadNetlist(J201)).toMatchObject({ design_variant: "<Default>" });
    expect(await runErc(J201, { designVariant: "<Default>" })).toMatchObject({
      design_variant: "<Default>",
      skipped: { dns: expect.any(Number) },
    });
    const erc = await runErc(J201);
    expect("skipped" in erc && erc.skipped.dns).toBeGreaterThan(0);
  });
});
