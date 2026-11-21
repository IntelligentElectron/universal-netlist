/**
 * Hidden pins in KiCad and Altium designs: flagged `hidden`, and an Altium hidden pin
 * joined to the net its Connect To names.
 */
import { describe, expect, it } from "vitest";
import { parseDocument } from "./altium/document.js";
import { buildHierarchy } from "./altium/records.js";
import { RECORD_TYPES, type AltiumRecord } from "./altium/types.js";
import { parseKicadDesign } from "./kicad/index.js";
import { fixturePath, hasFixtures } from "../../test/utils.js";

/** U1 with a drawn pin 1 under power port GND, and hidden pins 2 and 3 off any wire. */
const altium = (connectTo?: string) => {
  const at = (x: number, y: number) => ({ "Location.X": String(x), "Location.Y": String(y) });
  const pin = (designator: string, y: number, hidden: boolean) => ({
    RECORD: RECORD_TYPES.PIN,
    OwnerIndex: "0",
    Designator: designator,
    Name: designator === "1" ? "IN" : "VSS",
    Electrical: "7",
    PinLength: "10",
    PinConglomerate: hidden ? "4" : "0",
    ...at(100, y),
  });
  const records: Omit<AltiumRecord, "index">[] = [
    { RECORD: RECORD_TYPES.COMPONENT },
    { RECORD: RECORD_TYPES.DESIGNATOR, OwnerIndex: "0", Text: "U1" },
    pin("1", 100, false),
    { RECORD: RECORD_TYPES.POWER_PORT, Text: "GND", ...at(110, 100) },
    pin("2", 300, true),
    ...(connectTo
      ? [
          {
            RECORD: RECORD_TYPES.PARAMETER,
            OwnerIndex: "4",
            Name: "HiddenNetName",
            Text: connectTo,
          },
        ]
      : []),
    pin("3", 500, true),
  ];
  return parseDocument({
    path: "sheet.SchDoc",
    name: "sheet.schdoc",
    bundleLinks: [],
    hierarchical: buildHierarchy({
      header: [],
      records: records.map((record, index) => ({ ...record, index })),
    }),
  }).netlist;
};

describe("Altium hidden pins", () => {
  it("flags a hidden pin and joins it to the net its Connect To names", () => {
    const { nets, components } = altium("GND");
    expect(components.U1.pins).toEqual({
      "1": { name: "IN", net: "GND", type: "power" },
      "2": { name: "VSS", net: "GND", type: "power", hidden: true },
      "3": { name: "VSS", net: "", type: "power", hidden: true },
    });
    expect(nets.GND.U1.sort()).toEqual(["1", "2"]);
  });

  it("leaves a hidden pin with no Connect To on no net", () => {
    const { components } = altium();
    expect(components.U1.pins["2"]).toEqual({ name: "VSS", net: "", type: "power", hidden: true });
  });
});

describe.skipIf(!hasFixtures)("KiCad hidden pins", () => {
  it("flags the pins a symbol hides, read from the schematic beside a saved .net", async () => {
    const netlist = await parseKicadDesign(
      fixturePath("kicad", "easyduino-rp2040", "Easyduino_RP2040.kicad_pro")
    );
    // The USB-C receptacle stacks its repeated GND and VBUS pins hidden under the drawn ones.
    expect(netlist.components.J1.pins.A12).toEqual({
      name: "GND",
      net: "GND",
      type: "passive",
      hidden: true,
    });
    expect(netlist.components.J1.pins.A1).toEqual({ name: "GND", net: "GND", type: "passive" });
  });
});
