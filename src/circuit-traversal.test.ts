/**
 * Circuit Traversal Unit Tests
 */

import { describe, it, expect } from "vitest";
import {
  isGroundNet,
  isPowerNet,
  isStopNet,
  isPassive,
  isValidRefdes,
  naturalSort,
  traverseCircuitFromNet,
  computeCircuitHash,
} from "./circuit-traversal.js";
import type { NetConnections, ComponentDetails } from "./types.js";

describe("isGroundNet", () => {
  it("should match GND", () => {
    expect(isGroundNet("GND")).toBe(true);
    expect(isGroundNet("gnd")).toBe(true);
  });

  it("should match VSS", () => {
    expect(isGroundNet("VSS")).toBe(true);
    expect(isGroundNet("vss")).toBe(true);
  });

  it("should match AGND", () => {
    expect(isGroundNet("AGND")).toBe(true);
    expect(isGroundNet("agnd")).toBe(true);
  });

  it("should match DGND", () => {
    expect(isGroundNet("DGND")).toBe(true);
    expect(isGroundNet("dgnd")).toBe(true);
  });

  it("should not match signal nets", () => {
    expect(isGroundNet("SIG_GND")).toBe(false);
    expect(isGroundNet("SIGNAL")).toBe(false);
  });
});

describe("isPowerNet", () => {
  it("should match VCC variants", () => {
    expect(isPowerNet("VCC")).toBe(true);
    expect(isPowerNet("VCCC")).toBe(true);
    expect(isPowerNet("vcc")).toBe(true);
  });

  it("should match VDD variants", () => {
    expect(isPowerNet("VDD")).toBe(true);
    expect(isPowerNet("VDDD")).toBe(true);
    expect(isPowerNet("vdd")).toBe(true);
  });

  it("should match PP* power nets", () => {
    expect(isPowerNet("PP3V3")).toBe(true);
    expect(isPowerNet("PP1V8")).toBe(true);
    expect(isPowerNet("PP5V")).toBe(true);
  });

  it("should match PN* power nets", () => {
    expect(isPowerNet("PN5V")).toBe(true);
    expect(isPowerNet("PN12V")).toBe(true);
  });

  it("should match LD_PP* power nets", () => {
    expect(isPowerNet("LD_PP3V3")).toBe(true);
    expect(isPowerNet("LD_PP1V8")).toBe(true);
  });

  it("should match voltage patterns like 3V3", () => {
    expect(isPowerNet("3V3")).toBe(true);
    expect(isPowerNet("5V")).toBe(true);
    expect(isPowerNet("12V")).toBe(true);
    expect(isPowerNet("1V8")).toBe(true);
  });

  it("should match nets starting with + (positive power rail)", () => {
    expect(isPowerNet("+3V3")).toBe(true);
    expect(isPowerNet("+5V")).toBe(true);
    expect(isPowerNet("+12V")).toBe(true);
    expect(isPowerNet("+VBAT")).toBe(true);
    expect(isPowerNet("+VCC")).toBe(true);
  });

  it("should match nets starting with - (negative power rail)", () => {
    expect(isPowerNet("-5V")).toBe(true);
    expect(isPowerNet("-12V")).toBe(true);
    expect(isPowerNet("-VEE")).toBe(true);
    expect(isPowerNet("-VBIAS")).toBe(true);
  });

  it("should not match signal nets", () => {
    expect(isPowerNet("I2C_SDA")).toBe(false);
    expect(isPowerNet("SPI_CLK")).toBe(false);
    expect(isPowerNet("SIGNAL")).toBe(false);
  });
});

describe("isStopNet", () => {
  it("should match ground nets", () => {
    expect(isStopNet("GND")).toBe(true);
    expect(isStopNet("VSS")).toBe(true);
    expect(isStopNet("AGND")).toBe(true);
    expect(isStopNet("DGND")).toBe(true);
  });

  it("should match power nets", () => {
    expect(isStopNet("VCC")).toBe(true);
    expect(isStopNet("VDD")).toBe(true);
    expect(isStopNet("PP3V3")).toBe(true);
    expect(isStopNet("3V3")).toBe(true);
  });

  it("should match nets starting with + (positive power rail)", () => {
    expect(isStopNet("+3V3")).toBe(true);
    expect(isStopNet("+5V")).toBe(true);
    expect(isStopNet("+12V")).toBe(true);
    expect(isStopNet("+VBAT")).toBe(true);
    expect(isStopNet("+VCC")).toBe(true);
    expect(isStopNet("+3.3V")).toBe(true);
    expect(isStopNet("+AVDD")).toBe(true);
  });

  it("should match nets starting with - (negative power rail)", () => {
    expect(isStopNet("-5V")).toBe(true);
    expect(isStopNet("-12V")).toBe(true);
    expect(isStopNet("-VEE")).toBe(true);
    expect(isStopNet("-VBIAS")).toBe(true);
    expect(isStopNet("-15V")).toBe(true);
  });

  it("should not match signal nets", () => {
    expect(isStopNet("I2C_SDA")).toBe(false);
    expect(isStopNet("SPI_CLK")).toBe(false);
    expect(isStopNet("SIGNAL")).toBe(false);
    expect(isStopNet("RESET_L")).toBe(false);
    expect(isStopNet("DATA_BUS")).toBe(false);
  });

  it("should not match standalone + or - (requires at least one more char)", () => {
    expect(isStopNet("+")).toBe(false);
    expect(isStopNet("-")).toBe(false);
  });
});

describe("isPassive", () => {
  it("should identify resistors", () => {
    expect(isPassive("R1")).toBe(true);
    expect(isPassive("R100")).toBe(true);
    expect(isPassive("r1")).toBe(true);
  });

  it("should identify RS (sense resistors)", () => {
    expect(isPassive("RS1")).toBe(true);
    expect(isPassive("RS10")).toBe(true);
  });

  it("should identify FR (fuse resistors)", () => {
    expect(isPassive("FR1")).toBe(true);
    expect(isPassive("FR56")).toBe(true);
  });

  it("should identify capacitors", () => {
    expect(isPassive("C1")).toBe(true);
    expect(isPassive("C100")).toBe(true);
    expect(isPassive("c1")).toBe(true);
  });

  it("should identify inductors", () => {
    expect(isPassive("L1")).toBe(true);
    expect(isPassive("L100")).toBe(true);
  });

  it("should identify ferrite beads", () => {
    expect(isPassive("FB1")).toBe(true);
    expect(isPassive("FB10")).toBe(true);
  });

  it("should not identify ICs as passive", () => {
    expect(isPassive("U1")).toBe(false);
    expect(isPassive("U100")).toBe(false);
  });

  it("should not identify transistors as passive", () => {
    expect(isPassive("Q1")).toBe(false);
    expect(isPassive("Q10")).toBe(false);
  });

  it("should not identify diodes as passive", () => {
    expect(isPassive("D1")).toBe(false);
    expect(isPassive("D10")).toBe(false);
  });
});

describe("isValidRefdes", () => {
  it("should accept standard refdes formats", () => {
    expect(isValidRefdes("U1")).toBe(true);
    expect(isValidRefdes("R100")).toBe(true);
    expect(isValidRefdes("C1")).toBe(true);
    expect(isValidRefdes("FB3")).toBe(true);
    expect(isValidRefdes("TP5")).toBe(true);
    expect(isValidRefdes("MTG1")).toBe(true);
  });

  it("should accept refdes with underscores", () => {
    expect(isValidRefdes("U1_A")).toBe(true);
    expect(isValidRefdes("R10_TOP")).toBe(true);
  });

  it("should reject Cadence instance paths", () => {
    expect(
      isValidRefdes(
        "@BEAGLEBONEBLK_C.BEAGLEBONEBLACK(SCH_1):INS21415196@LAN8710",
      ),
    ).toBe(false);
    expect(isValidRefdes("'@DESIGN.SHEET:INS123@PART'")).toBe(false);
  });

  it("should reject paths with special characters", () => {
    expect(isValidRefdes("U1.A")).toBe(false);
    expect(isValidRefdes("U1:1")).toBe(false);
    expect(isValidRefdes("(U1)")).toBe(false);
    expect(isValidRefdes("@U1")).toBe(false);
  });

  it("should reject empty or numeric-only strings", () => {
    expect(isValidRefdes("")).toBe(false);
    expect(isValidRefdes("123")).toBe(false);
  });
});

describe("naturalSort", () => {
  it("should sort numbers naturally", () => {
    const items = ["U10", "U2", "U1", "U20"];
    const sorted = items.sort(naturalSort);
    expect(sorted).toEqual(["U1", "U2", "U10", "U20"]);
  });

  it("should sort BGA pins naturally", () => {
    const items = ["A10", "A2", "A1", "B1"];
    const sorted = items.sort(naturalSort);
    expect(sorted).toEqual(["A1", "A2", "A10", "B1"]);
  });

  it("should handle strings without numbers", () => {
    const items = ["GND", "VCC", "AGND"];
    const sorted = items.sort(naturalSort);
    expect(sorted).toEqual(["AGND", "GND", "VCC"]);
  });
});

describe("traverseCircuitFromNet", () => {
  describe("stop net behavior", () => {
    it("should stop traversal at GND and not find components through it", () => {
      const nets: NetConnections = {
        SIGNAL: { R1: "1" },
        GND: { R1: "2", R2: "1", C1: "1" },
        OTHER_SIGNAL: { R2: "2" },
      };
      const components: ComponentDetails = {
        R1: { pins: { "1": "SIGNAL", "2": "GND" }, mpn: "10k" },
        R2: { pins: { "1": "GND", "2": "OTHER_SIGNAL" }, mpn: "10k" },
        C1: { pins: { "1": "GND", "2": "VCC" }, mpn: "100nF" },
      };

      const result = traverseCircuitFromNet("SIGNAL", nets, components);

      expect(result.components.length).toBe(1);
      expect(result.components[0].refdes).toBe("R1");
      expect(result.visited_nets).toContain("GND");
      expect(result.visited_nets).not.toContain("OTHER_SIGNAL");
    });

    it("should stop traversal at VCC and not find components through it", () => {
      const nets: NetConnections = {
        SIGNAL: { R1: "1" },
        VCC: { R1: "2", R2: "1" },
        OTHER_SIGNAL: { R2: "2" },
      };
      const components: ComponentDetails = {
        R1: { pins: { "1": "SIGNAL", "2": "VCC" }, mpn: "10k" },
        R2: { pins: { "1": "VCC", "2": "OTHER_SIGNAL" }, mpn: "10k" },
      };

      const result = traverseCircuitFromNet("SIGNAL", nets, components);

      expect(result.components.length).toBe(1);
      expect(result.components[0].refdes).toBe("R1");
      expect(result.visited_nets).toContain("VCC");
      expect(result.visited_nets).not.toContain("OTHER_SIGNAL");
    });

    it("should stop traversal at +3V3 power net", () => {
      const nets: NetConnections = {
        SIGNAL: { R1: "1" },
        "+3V3": { R1: "2", R2: "1" },
        OTHER: { R2: "2" },
      };
      const components: ComponentDetails = {
        R1: { pins: { "1": "SIGNAL", "2": "+3V3" }, mpn: "10k" },
        R2: { pins: { "1": "+3V3", "2": "OTHER" }, mpn: "10k" },
      };

      const result = traverseCircuitFromNet("SIGNAL", nets, components);

      expect(result.components.length).toBe(1);
      expect(result.visited_nets).toContain("+3V3");
      expect(result.visited_nets).not.toContain("OTHER");
    });
  });

  describe("passive component traversal", () => {
    it("should traverse through passive components and show all their pins", () => {
      const nets: NetConnections = {
        SIGNAL_A: { R1: "1" },
        SIGNAL_B: { R1: "2", R2: "1" },
        SIGNAL_C: { R2: "2" },
      };
      const components: ComponentDetails = {
        R1: { pins: { "1": "SIGNAL_A", "2": "SIGNAL_B" }, mpn: "10k" },
        R2: { pins: { "1": "SIGNAL_B", "2": "SIGNAL_C" }, mpn: "20k" },
      };

      const result = traverseCircuitFromNet("SIGNAL_A", nets, components);

      expect(result.components.length).toBe(2);
      const r1 = result.components.find((c) => c.refdes === "R1");
      const r2 = result.components.find((c) => c.refdes === "R2");
      expect(r1).toBeDefined();
      expect(r2).toBeDefined();

      const r1Pins = r1!.connections.flatMap((c) => c.pins);
      expect(r1Pins).toContain("1");
      expect(r1Pins).toContain("2");

      const r2Pins = r2!.connections.flatMap((c) => c.pins);
      expect(r2Pins).toContain("1");
      expect(r2Pins).toContain("2");

      expect(result.visited_nets).toContain("SIGNAL_A");
      expect(result.visited_nets).toContain("SIGNAL_B");
      expect(result.visited_nets).toContain("SIGNAL_C");
    });

    it("should traverse through capacitors", () => {
      const nets: NetConnections = {
        SIGNAL: { C1: "1" },
        FILTERED: { C1: "2" },
      };
      const components: ComponentDetails = {
        C1: { pins: { "1": "SIGNAL", "2": "FILTERED" }, mpn: "100nF" },
      };

      const result = traverseCircuitFromNet("SIGNAL", nets, components);

      expect(result.components.length).toBe(1);
      expect(result.visited_nets).toContain("FILTERED");
    });

    it("should traverse through inductors", () => {
      const nets: NetConnections = {
        SIGNAL: { L1: "1" },
        FILTERED: { L1: "2" },
      };
      const components: ComponentDetails = {
        L1: { pins: { "1": "SIGNAL", "2": "FILTERED" }, mpn: "10uH" },
      };

      const result = traverseCircuitFromNet("SIGNAL", nets, components);

      expect(result.components.length).toBe(1);
      expect(result.visited_nets).toContain("FILTERED");
    });

    it("should traverse through ferrite beads", () => {
      const nets: NetConnections = {
        SIGNAL: { FB1: "1" },
        FILTERED: { FB1: "2" },
      };
      const components: ComponentDetails = {
        FB1: { pins: { "1": "SIGNAL", "2": "FILTERED" }, mpn: "600R@100MHz" },
      };

      const result = traverseCircuitFromNet("SIGNAL", nets, components);

      expect(result.components.length).toBe(1);
      expect(result.visited_nets).toContain("FILTERED");
    });
  });

  describe("active component handling", () => {
    it("should only show relevant pins for active components (ICs)", () => {
      const nets: NetConnections = {
        MY_SIGNAL: { U1: "5", R1: "1" },
        GND: { U1: ["1", "10", "20"], R1: "2" },
        VCC: { U1: ["2", "11"] },
        OTHER_SIGNAL: { U1: "3" },
      };
      const components: ComponentDetails = {
        U1: {
          pins: {
            "1": "GND",
            "2": "VCC",
            "3": "OTHER_SIGNAL",
            "5": "MY_SIGNAL",
            "10": "GND",
            "11": "VCC",
            "20": "GND",
          },
          mpn: "STM32F411",
        },
        R1: { pins: { "1": "MY_SIGNAL", "2": "GND" }, mpn: "10k" },
      };

      const result = traverseCircuitFromNet("MY_SIGNAL", nets, components);

      expect(result.components.length).toBe(2);

      const u1 = result.components.find((c) => c.refdes === "U1");
      expect(u1).toBeDefined();

      const u1Pins = u1!.connections.flatMap((c) => c.pins);
      expect(u1Pins.length).toBe(1);
      expect(u1Pins).toContain("5");
      expect(u1Pins).not.toContain("1");
      expect(u1Pins).not.toContain("2");
      expect(u1Pins).not.toContain("3");
    });

    it("should not traverse through active components", () => {
      const nets: NetConnections = {
        SIGNAL_A: { U1: "1" },
        SIGNAL_B: { U1: "2", R1: "1" },
        SIGNAL_C: { R1: "2" },
      };
      const components: ComponentDetails = {
        U1: { pins: { "1": "SIGNAL_A", "2": "SIGNAL_B" }, mpn: "IC" },
        R1: { pins: { "1": "SIGNAL_B", "2": "SIGNAL_C" }, mpn: "10k" },
      };

      const result = traverseCircuitFromNet("SIGNAL_A", nets, components);

      expect(result.components.length).toBe(1);
      expect(result.components[0].refdes).toBe("U1");
      expect(result.visited_nets).not.toContain("SIGNAL_B");
      expect(result.visited_nets).not.toContain("SIGNAL_C");
    });

    it("should find active components discovered through passive traversal", () => {
      const nets: NetConnections = {
        SIGNAL: { R1: "1" },
        NODE: { R1: "2", U1: "3" },
        GND: { U1: ["1", "5"] },
        VCC: { U1: "2" },
      };
      const components: ComponentDetails = {
        R1: { pins: { "1": "SIGNAL", "2": "NODE" }, mpn: "10k" },
        U1: {
          pins: { "1": "GND", "2": "VCC", "3": "NODE", "5": "GND" },
          mpn: "IC",
        },
      };

      const result = traverseCircuitFromNet("SIGNAL", nets, components);

      expect(result.components.length).toBe(2);

      const u1 = result.components.find((c) => c.refdes === "U1");
      expect(u1).toBeDefined();

      const u1Pins = u1!.connections.flatMap((c) => c.pins);
      expect(u1Pins.length).toBe(1);
      expect(u1Pins).toContain("3");
    });
  });

  describe("edge cases", () => {
    it("should return empty result for non-existent net", () => {
      const nets: NetConnections = { SIGNAL: { R1: "1" } };
      const components: ComponentDetails = {};

      const result = traverseCircuitFromNet("NONEXISTENT", nets, components);

      expect(result.components.length).toBe(0);
      expect(result.visited_nets.length).toBe(0);
    });

    it("should handle empty nets object", () => {
      const result = traverseCircuitFromNet("SIGNAL", {}, {});

      expect(result.components.length).toBe(0);
      expect(result.visited_nets.length).toBe(0);
    });

    it("should handle pins as string array", () => {
      const nets: NetConnections = {
        SIGNAL: { U1: ["1", "2", "3"] },
        GND: { U1: "4" },
      };
      const components: ComponentDetails = {
        U1: {
          pins: { "1": "SIGNAL", "2": "SIGNAL", "3": "SIGNAL", "4": "GND" },
          mpn: "IC",
        },
      };

      const result = traverseCircuitFromNet("SIGNAL", nets, components);

      expect(result.components.length).toBe(1);
      const u1 = result.components[0];
      const u1Pins = u1.connections.flatMap((c) => c.pins);
      expect(u1Pins).toContain("1");
      expect(u1Pins).toContain("2");
      expect(u1Pins).toContain("3");
      expect(u1Pins).not.toContain("4");
    });

    it("should group multiple pins on same net together", () => {
      const nets: NetConnections = {
        SIGNAL: { R1: "1" },
        GND: { R1: "2" },
      };
      const components: ComponentDetails = {
        R1: { pins: { "1": "SIGNAL", "2": "GND" }, mpn: "10k" },
      };

      const result = traverseCircuitFromNet("SIGNAL", nets, components);

      const r1 = result.components[0];
      const signalConn = r1.connections.find((c) => c.net === "SIGNAL");
      const gndConn = r1.connections.find((c) => c.net === "GND");
      expect(signalConn).toBeDefined();
      expect(gndConn).toBeDefined();
      expect(signalConn!.pins).toContain("1");
      expect(gndConn!.pins).toContain("2");
    });
  });
});

describe("computeCircuitHash", () => {
  it("should return same hash for same circuit regardless of query order", () => {
    const components1 = [
      {
        refdes: "R1",
        mpn: "10k",
        connections: [
          { net: "A", pins: ["1"] },
          { net: "B", pins: ["2"] },
        ],
      },
      {
        refdes: "R2",
        mpn: "20k",
        connections: [
          { net: "B", pins: ["1"] },
          { net: "C", pins: ["2"] },
        ],
      },
    ];
    const components2 = [
      {
        refdes: "R2",
        mpn: "20k",
        connections: [
          { net: "B", pins: ["1"] },
          { net: "C", pins: ["2"] },
        ],
      },
      {
        refdes: "R1",
        mpn: "10k",
        connections: [
          { net: "A", pins: ["1"] },
          { net: "B", pins: ["2"] },
        ],
      },
    ];

    expect(computeCircuitHash(components1)).toBe(
      computeCircuitHash(components2),
    );
  });

  it("should return different hash for different circuits", () => {
    const circuit1 = [
      { refdes: "R1", mpn: "10k", connections: [{ net: "A", pins: ["1"] }] },
    ];
    const circuit2 = [
      { refdes: "R1", mpn: "20k", connections: [{ net: "A", pins: ["1"] }] },
    ];

    expect(computeCircuitHash(circuit1)).not.toBe(computeCircuitHash(circuit2));
  });

  it("should return zero hash for empty components", () => {
    expect(computeCircuitHash([])).toBe("0000000000000000");
  });
});
