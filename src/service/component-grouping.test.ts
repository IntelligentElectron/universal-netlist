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
    expect(result[0].refdes).toBe("U1");
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
    expect(result[0].refdes).toBe("X1");
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
