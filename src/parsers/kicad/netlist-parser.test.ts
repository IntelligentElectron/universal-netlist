import { describe, it, expect } from "vitest";
import { parseKicadNetlist } from "./netlist-parser.js";

/** A compact but representative kicadsexpr export exercising the tricky cases. */
const EXPORT = `
(export
  (version "E")
  (components
    (comp
      (ref "R1")
      (value "10k")
      (description "Resistor")
      (fields
        (field (name "MPN") "RC0402FR-0710KL")
        (field (name "Footprint")))
      (libsource (lib "Device") (part "R") (description "Resistor"))
      (property (name "Sheetfile") (value "root.kicad_sch")))
    (comp
      (ref "R2")
      (value "DNS")
      (libsource (lib "Device") (part "R") (description "Resistor"))
      (property (name "exclude_from_bom"))
      (property (name "dnp")))
    (comp
      (ref "U1")
      (value "LM358")
      (libsource (lib "Amplifier" ) (part "LM358") (description "Dual op-amp"))
      (property (name "DNP") (value "DNP")))
    (comp
      (ref "TP1")
      (value "TestPoint")
      (libsource (lib "Connector") (part "TestPoint"))))
  (nets
    (net (code "1") (name "GND")
      (node (ref "R1") (pin "2") (pintype "passive"))
      (node (ref "U1") (pin "4") (pinfunction "V-_4") (pintype "power_in")))
    (net (code "2") (name "VOUT")
      (node (ref "U1") (pin "1") (pinfunction "OUT_1") (pintype "output"))
      (node (ref "R1") (pin "1") (pintype "passive"))
      (node (ref "TP1") (pin "1") (pinfunction "1_1") (pintype "passive")))
    (net (code "3") (name "DUAL")
      (node (ref "U1") (pin "8") (pinfunction "V+_8"))
      (node (ref "U1") (pin "5") (pinfunction "V+_5")))))
`;

describe("parseKicadNetlist", () => {
  const result = parseKicadNetlist(EXPORT);

  it("extracts all components from the components section", () => {
    expect(Object.keys(result.components).sort()).toEqual(["R1", "R2", "TP1", "U1"]);
  });

  it("maps value, description and MPN", () => {
    expect(result.components.R1.value).toBe("10k");
    expect(result.components.R1.description).toBe("Resistor");
    expect(result.components.R1.mpn).toBe("RC0402FR-0710KL");
  });

  it("falls back to libsource description when comp has none", () => {
    expect(result.components.U1.description).toBe("Dual op-amp");
  });

  it("flags DNP only for the native lowercase marker with no value", () => {
    expect(result.components.R2.dns).toBe(true);
    // U1 has a user field (property (name "DNP") (value "DNP")) — NOT the marker.
    expect(result.components.U1.dns).toBeUndefined();
  });

  it("keeps net membership as arrays of pins per refdes", () => {
    expect(result.nets.GND).toEqual({ R1: ["2"], U1: ["4"] });
    // Same refdes on a net via two pins → array of both, in netlist node order.
    expect(result.nets.DUAL).toEqual({ U1: ["8", "5"] });
  });

  it("strips the _<pinNumber> suffix from pinfunction to recover the pin name", () => {
    // U1 pin 1 named OUT → object with name.
    expect(result.components.U1.pins["1"]).toEqual({ name: "OUT", net: "VOUT" });
    expect(result.components.U1.pins["4"]).toEqual({ name: "V-", net: "GND" });
  });

  it("strips the suffix from overbar pinfunctions (~{...})", () => {
    // KiCad encodes active-low names with overbars, e.g. ~{RESET} on pin 1 →
    // pinfunction "~{RESET}_1". The "_1" suffix must strip, the overbar must stay.
    const overbar = parseKicadNetlist(`
(export
  (components
    (comp (ref "U9") (value "MCU")))
  (nets
    (net (code "1") (name "/~{RESET}")
      (node (ref "U9") (pin "1") (pinfunction "~{RESET}_1")))))
`);
    expect(overbar.components.U9.pins["1"]).toEqual({ name: "~{RESET}", net: "/~{RESET}" });
  });

  it("treats a bare ~ pinfunction as unnamed (plain net string)", () => {
    // KiCad emits (pinfunction "~") for an unnamed pin; it must not become a name.
    const unnamed = parseKicadNetlist(`
(export
  (components
    (comp (ref "R7") (value "1k")))
  (nets
    (net (code "1") (name "SIG")
      (node (ref "R7") (pin "2") (pinfunction "~")))))
`);
    expect(unnamed.components.R7.pins["2"]).toBe("SIG");
  });

  it("uses a plain net string when the pin name equals the pin number", () => {
    // TP1 pin 1, pinfunction "1_1" → name "1" == number → plain string.
    expect(result.components.TP1.pins["1"]).toBe("VOUT");
    // R1 pins have no pinfunction → plain strings.
    expect(result.components.R1.pins).toEqual({ "1": "VOUT", "2": "GND" });
  });

  it("throws when the input is not a netlist export", () => {
    expect(() => parseKicadNetlist('(kicad_sch (version 20231120))')).toThrow();
  });

  it("throws when the export is missing the components or nets section", () => {
    expect(() => parseKicadNetlist('(export (version "E") (nets))')).toThrow(/components/);
    expect(() => parseKicadNetlist('(export (version "E") (components))')).toThrow(/nets/);
  });
});
