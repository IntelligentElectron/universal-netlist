import { describe, it, expect } from "vitest";
import {
  MPN_MISSING_NOTE,
  groupComponentsByMpn,
  aggregateCircuitByMpn,
} from "./component-grouping.js";
import type { ComponentDetails, CircuitComponent } from "../types.js";

describe("MPN_MISSING_NOTE", () => {
  it("should contain guidance for the agent", () => {
    expect(MPN_MISSING_NOTE).toContain("MPN not found");
    expect(MPN_MISSING_NOTE).toContain("symbol properties");
    expect(MPN_MISSING_NOTE).toContain("BOM");
  });
});

describe("groupComponentsByMpn", () => {
  it("should omit mpn and add notes when MPN is missing", () => {
    const components: ComponentDetails = {
      U1: { pins: { "1": "VCC", "2": "GND" } },
    };
    const entries = Object.entries(components) as Array<[string, ComponentDetails[string]]>;

    const result = groupComponentsByMpn(entries, false);

    expect(result).toHaveLength(1);
    expect(result[0].mpn).toBeUndefined();
    expect(result[0].notes).toBeDefined();
    expect(result[0].notes).toContain(MPN_MISSING_NOTE);
    expect(result[0].refdes).toEqual(["U1"]);
  });

  it("should set mpn to the value and omit notes when MPN is present", () => {
    const components: ComponentDetails = {
      U1: { mpn: "TPS62088", pins: { "1": "VCC", "2": "GND" } },
    };
    const entries = Object.entries(components) as Array<[string, ComponentDetails[string]]>;

    const result = groupComponentsByMpn(entries, false);

    expect(result).toHaveLength(1);
    expect(result[0].mpn).toBe("TPS62088");
    expect(result[0].notes).toBeUndefined();
  });

  it("should omit mpn when MPN is empty string", () => {
    const components: ComponentDetails = {
      U1: { mpn: "", pins: { "1": "VCC", "2": "GND" } },
    };
    const entries = Object.entries(components) as Array<[string, ComponentDetails[string]]>;

    const result = groupComponentsByMpn(entries, false);

    expect(result).toHaveLength(1);
    expect(result[0].mpn).toBeUndefined();
    expect(result[0].notes).toContain(MPN_MISSING_NOTE);
  });

  it("should omit mpn when MPN is whitespace only", () => {
    const components: ComponentDetails = {
      U1: { mpn: "   ", pins: { "1": "VCC", "2": "GND" } },
    };
    const entries = Object.entries(components) as Array<[string, ComponentDetails[string]]>;

    const result = groupComponentsByMpn(entries, false);

    expect(result).toHaveLength(1);
    expect(result[0].mpn).toBeUndefined();
    expect(result[0].notes).toContain(MPN_MISSING_NOTE);
  });

  it("should group components with same MPN together without notes", () => {
    const components: ComponentDetails = {
      R1: {
        mpn: "10K",
        description: "Resistor",
        pins: { "1": "NET1", "2": "GND" },
      },
      R2: {
        mpn: "10K",
        description: "Resistor",
        pins: { "1": "NET2", "2": "GND" },
      },
    };
    const entries = Object.entries(components) as Array<[string, ComponentDetails[string]]>;

    const result = groupComponentsByMpn(entries, false);

    expect(result).toHaveLength(1);
    expect(result[0].mpn).toBe("10K");
    expect(result[0].count).toBe(2);
    expect(result[0].notes).toBeUndefined();
  });

  it("should include value when present", () => {
    const components: ComponentDetails = {
      C1: { mpn: "CAP_0603", value: "10uF", pins: { "1": "VCC", "2": "GND" } },
    };
    const entries = Object.entries(components) as Array<[string, ComponentDetails[string]]>;

    const result = groupComponentsByMpn(entries, false);

    expect(result).toHaveLength(1);
    expect(result[0].value).toBe("10uF");
  });

  it("should omit description when not present (not empty string)", () => {
    const components: ComponentDetails = {
      U1: { mpn: "TPS62088", pins: { "1": "VCC", "2": "GND" } },
    };
    const entries = Object.entries(components) as Array<[string, ComponentDetails[string]]>;

    const result = groupComponentsByMpn(entries, false);

    expect(result).toHaveLength(1);
    expect(result[0].description).toBeUndefined();
    expect("description" in result[0]).toBe(false);
  });

  it("should include dns:true for DNS components when includeDns is true", () => {
    const components: ComponentDetails = {
      C1: {
        mpn: "DNS",
        description: "Do Not Stuff cap",
        dns: true,
        pins: { "1": "VCC", "2": "GND" },
      },
    };
    const entries = Object.entries(components) as Array<[string, ComponentDetails[string]]>;

    const result = groupComponentsByMpn(entries, true);

    expect(result).toHaveLength(1);
    expect(result[0].dns).toBe(true);
  });

  it("should omit dns for non-DNS components", () => {
    const components: ComponentDetails = {
      C1: { mpn: "CAP_0603", pins: { "1": "VCC", "2": "GND" } },
    };
    const entries = Object.entries(components) as Array<[string, ComponentDetails[string]]>;

    const result = groupComponentsByMpn(entries, false);

    expect(result).toHaveLength(1);
    expect(result[0].dns).toBeUndefined();
  });

  it("should not group components without MPN (each gets its own entry with notes)", () => {
    const components: ComponentDetails = {
      U1: { description: "IC", pins: { "1": "VCC" } },
      U2: { description: "IC", pins: { "1": "VCC" } },
    };
    const entries = Object.entries(components) as Array<[string, ComponentDetails[string]]>;

    const result = groupComponentsByMpn(entries, false);

    expect(result).toHaveLength(2);
    expect(result.every((r) => r.mpn === undefined)).toBe(true);
    expect(result.every((r) => r.notes?.includes(MPN_MISSING_NOTE))).toBe(true);
  });
});

describe("aggregateCircuitByMpn", () => {
  it("should omit mpn and add notes for components without MPN", () => {
    const components: CircuitComponent[] = [
      {
        refdes: "U1",
        description: "Voltage Regulator",
        connections: [
          { net: "VIN", pins: ["1"] },
          { net: "VOUT", pins: ["2"] },
        ],
      },
    ];

    const result = aggregateCircuitByMpn(components);

    expect(result).toHaveLength(1);
    expect(result[0].mpn).toBeUndefined();
    expect(result[0].notes).toBeDefined();
    expect(result[0].notes).toContain(MPN_MISSING_NOTE);
  });

  it("should preserve mpn and omit notes for components with MPN", () => {
    const components: CircuitComponent[] = [
      {
        refdes: "U1",
        mpn: "TPS62088",
        description: "Buck Converter",
        connections: [
          { net: "VIN", pins: ["1"] },
          { net: "VOUT", pins: ["2"] },
        ],
      },
    ];

    const result = aggregateCircuitByMpn(components);

    expect(result).toHaveLength(1);
    expect(result[0].mpn).toBe("TPS62088");
    expect(result[0].notes).toBeUndefined();
  });

  it("should add notes to unaggregatable components (no MPN, no description)", () => {
    const components: CircuitComponent[] = [
      {
        refdes: "X1",
        connections: [
          { net: "NET1", pins: ["1"] },
          { net: "NET2", pins: ["2"] },
        ],
      },
    ];

    const result = aggregateCircuitByMpn(components);

    expect(result).toHaveLength(1);
    expect(result[0].mpn).toBeUndefined();
    expect(result[0].notes).toContain(MPN_MISSING_NOTE);
    expect(result[0].refdes).toEqual(["X1"]);
  });

  it("should omit mpn when MPN is empty string", () => {
    const components: CircuitComponent[] = [
      {
        refdes: "U1",
        mpn: "",
        description: "IC",
        connections: [{ net: "VCC", pins: ["1"] }],
      },
    ];

    const result = aggregateCircuitByMpn(components);

    expect(result).toHaveLength(1);
    expect(result[0].mpn).toBeUndefined();
    expect(result[0].notes).toContain(MPN_MISSING_NOTE);
  });

  it("should aggregate components with same MPN without notes", () => {
    const components: CircuitComponent[] = [
      {
        refdes: "C1",
        mpn: "100nF",
        description: "Cap",
        connections: [
          { net: "VCC", pins: ["1"] },
          { net: "GND", pins: ["2"] },
        ],
      },
      {
        refdes: "C2",
        mpn: "100nF",
        description: "Cap",
        connections: [
          { net: "VCC", pins: ["1"] },
          { net: "GND", pins: ["2"] },
        ],
      },
    ];

    const result = aggregateCircuitByMpn(components);

    expect(result).toHaveLength(1);
    expect(result[0].mpn).toBe("100nF");
    expect(result[0].total_count).toBe(2);
    expect(result[0].notes).toBeUndefined();
  });

  it("should include value in aggregated results when provided", () => {
    const components: CircuitComponent[] = [
      {
        refdes: "C1",
        mpn: "CAP_0603",
        value: "4.7uF",
        connections: [
          { net: "VCC", pins: ["1"] },
          { net: "GND", pins: ["2"] },
        ],
      },
    ];

    const result = aggregateCircuitByMpn(components);

    expect(result).toHaveLength(1);
    expect(result[0].value).toBe("4.7uF");
  });

  it("should include dns:true for DNS components", () => {
    const components: CircuitComponent[] = [
      {
        refdes: "C1",
        mpn: "DNS",
        description: "Do Not Stuff",
        dns: true,
        connections: [
          { net: "VCC", pins: ["1"] },
          { net: "GND", pins: ["2"] },
        ],
      },
    ];

    const result = aggregateCircuitByMpn(components);

    expect(result).toHaveLength(1);
    expect(result[0].dns).toBe(true);
  });

  it("should omit dns for non-DNS components", () => {
    const components: CircuitComponent[] = [
      {
        refdes: "C1",
        mpn: "CAP_0603",
        connections: [
          { net: "VCC", pins: ["1"] },
          { net: "GND", pins: ["2"] },
        ],
      },
    ];

    const result = aggregateCircuitByMpn(components);

    expect(result).toHaveLength(1);
    expect(result[0].dns).toBeUndefined();
    expect("dns" in result[0]).toBe(false);
  });

  it("should omit description when not present (not undefined in object)", () => {
    const components: CircuitComponent[] = [
      {
        refdes: "C1",
        mpn: "CAP_0603",
        connections: [
          { net: "VCC", pins: ["1"] },
          { net: "GND", pins: ["2"] },
        ],
      },
    ];

    const result = aggregateCircuitByMpn(components);

    expect(result).toHaveLength(1);
    expect(result[0].description).toBeUndefined();
    expect("description" in result[0]).toBe(false);
  });
});

/**
 * A group speaks for every part in it.
 *
 * Grouping used to key on MPN alone and keep whichever member arrived first,
 * so a design that gives every resistor the MPN `R` and every capacitor `CC`
 * — which the OSHW Jetson carriers do, and which `N.A.` placeholders do on
 * other boards — collapsed into one group reporting one value for all of them.
 * `list_components(type: "R")` on reComputer J202 answered a single group of
 * 271 resistors valued `5.1R`, and R1 is `0R`.
 */
describe("groups only merge parts the group's own fields describe", () => {
  const entriesOf = (components: ComponentDetails) =>
    Object.entries(components) as Array<[string, ComponentDetails[string]]>;

  it("keeps parts apart when a shared MPN covers different values", () => {
    const result = groupComponentsByMpn(
      entriesOf({
        R1: { mpn: "R", value: "0R", pins: {} },
        R2: { mpn: "R", value: "5.1K", pins: {} },
        R3: { mpn: "R", value: "5.1K", pins: {} },
      }),
      false
    );

    expect(result).toHaveLength(2);
    const byValue = Object.fromEntries(result.map((g) => [g.value, g.refdes]));
    expect(byValue["0R"]).toEqual(["R1"]);
    expect(byValue["5.1K"]).toEqual(["R2", "R3"]);
  });

  it("keeps a resistor and a capacitor apart when both carry a placeholder MPN", () => {
    const result = groupComponentsByMpn(
      entriesOf({
        C1: { mpn: "N.A.", description: "Capacitor, NP0", value: "12pF", pins: {} },
        R1: { mpn: "N.A.", description: "Resistor, 0.05W", value: "0R", pins: {} },
      }),
      false
    );

    expect(result).toHaveLength(2);
    for (const group of result) {
      expect(group.refdes).toHaveLength(1);
    }
    const capacitor = result.find((g) => g.refdes[0] === "C1");
    expect(capacitor?.description).toBe("Capacitor, NP0");
    expect(capacitor?.value).toBe("12pF");
  });

  it("still merges parts that agree, which is what the grouping is for", () => {
    const result = groupComponentsByMpn(
      entriesOf({
        C1: { mpn: "CL10A225KP8NNNC", description: "CAP CER 2.2UF", value: "2.2uF", pins: {} },
        C2: { mpn: "CL10A225KP8NNNC", description: "CAP CER 2.2UF", value: "2.2uF", pins: {} },
      }),
      false
    );

    expect(result).toHaveLength(1);
    expect(result[0].count).toBe(2);
    expect(result[0].refdes).toEqual(["C1", "C2"]);
  });

  it("does not let a part with no value stand in for one that has a value", () => {
    const result = groupComponentsByMpn(
      entriesOf({
        R1: { mpn: "R", pins: {} },
        R2: { mpn: "R", value: "10K", pins: {} },
      }),
      false
    );

    expect(result).toHaveLength(2);
    expect(result.find((g) => g.refdes[0] === "R1")?.value).toBeUndefined();
    expect(result.find((g) => g.refdes[0] === "R2")?.value).toBe("10K");
  });

  it("keeps xnet aggregation apart the same way", () => {
    const components: CircuitComponent[] = [
      {
        refdes: "R1",
        mpn: "R",
        value: "0R",
        connections: [{ net: "A", pins: ["1"] }, { net: "B", pins: ["2"] }],
      },
      {
        refdes: "R2",
        mpn: "R",
        value: "10K",
        connections: [{ net: "A", pins: ["1"] }, { net: "B", pins: ["2"] }],
      },
    ];

    const result = aggregateCircuitByMpn(components);

    expect(result).toHaveLength(2);
    expect(result.map((g) => g.value).sort()).toEqual(["0R", "10K"]);
  });
});
