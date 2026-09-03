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
  isDnsComponent,
  stripDnsMarkers,
  getRefdesPrefix,
  matchesRefdesType,
  naturalSort,
  traverseCircuitFromNet,
  computeCircuitHash,
  hasDnsValueMarker,
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

  it("should match suffixed ground names (KiCad GNDREF and friends)", () => {
    expect(isGroundNet("GNDREF")).toBe(true); // KiCad's default global ground
    expect(isGroundNet("gndref")).toBe(true);
    expect(isGroundNet("GNDPWR")).toBe(true);
    expect(isGroundNet("GNDD")).toBe(true);
    expect(isGroundNet("GNDS")).toBe(true);
    expect(isGroundNet("AGND1")).toBe(true);
    expect(isGroundNet("VSSA")).toBe(true);
  });

  it("should match underscore-suffixed ground domains (intentional)", () => {
    // `\w` includes `_`, so GND_* names classify as ground. Almost always a real
    // ground domain; a missed ground that floods traversal is worse than this.
    expect(isGroundNet("GND_SENSE")).toBe(true);
    expect(isGroundNet("GND_RETURN")).toBe(true);
    expect(isGroundNet("GND_DIGITAL")).toBe(true);
  });

  it("should match hierarchical (sheet-path-prefixed) ground nets", () => {
    expect(isGroundNet("/GND")).toBe(true); // GND on the root sheet
    expect(isGroundNet("/Power/AGND")).toBe(true); // AGND on a sub-sheet
    expect(isGroundNet("/Analog/GNDREF")).toBe(true);
  });

  it("should not match signal nets", () => {
    expect(isGroundNet("SIG_GND")).toBe(false); // suffix GND, not a global ground
    expect(isGroundNet("SIGNAL")).toBe(false);
    expect(isGroundNet("GROUND_LOOP")).toBe(false); // starts with G-R-O, not GND
    expect(isGroundNet("/Sheet/DATA")).toBe(false); // hierarchical signal
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

  it("should match VREG* power nets", () => {
    expect(isPowerNet("VREG")).toBe(true);
    expect(isPowerNet("VREG_3V3")).toBe(true);
    expect(isPowerNet("VREG1V8")).toBe(true);
    expect(isPowerNet("vreg")).toBe(true);
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

  it("should match hierarchical (sheet-path-prefixed) power rails", () => {
    expect(isPowerNet("/+3V3")).toBe(true);
    expect(isPowerNet("/Power/VCC")).toBe(true);
  });

  it("should match P<n>V* rails (P3V3_AUX / P12V style)", () => {
    expect(isPowerNet("P3V3_AUX")).toBe(true);
    expect(isPowerNet("P12V")).toBe(true);
    expect(isPowerNet("P1V8_BMC")).toBe(true);
    expect(isPowerNet("p5v_stby")).toBe(true);
  });

  it("should match PVCC*/PVNN* VR rails", () => {
    expect(isPowerNet("PVCCIN_CPU0")).toBe(true);
    expect(isPowerNet("PVCC_GT")).toBe(true);
    expect(isPowerNet("PVNN_TERM_CPU0")).toBe(true);
    expect(isPowerNet("pvnn_main")).toBe(true);
  });

  it("should match rail-derived names like P1V8_PG (accepted trade-off)", () => {
    // Prefix-anchored, exactly like `VCC\w*` catching `VCC_EN`. A power-good
    // signal misclassified as a rail costs one unexplored branch; a missed rail
    // floods the whole board.
    expect(isPowerNet("P1V8_PG")).toBe(true);
  });

  it("should not match signal nets", () => {
    expect(isPowerNet("I2C_SDA")).toBe(false);
    expect(isPowerNet("SPI_CLK")).toBe(false);
    expect(isPowerNet("SIGNAL")).toBe(false);
    expect(isPowerNet("/Sheet/I2C_SDA")).toBe(false); // hierarchical signal stays a signal
  });

  it("should not match P-prefixed signals that are not rails", () => {
    expect(isPowerNet("SPI2_FLASH_CS0_N")).toBe(false);
    expect(isPowerNet("FM_CTRL_ENABLE_N")).toBe(false);
    expect(isPowerNet("PWM_OUT")).toBe(false); // P not followed by digits+V
    expect(isPowerNet("PCIE_TX3_P")).toBe(false); // no digit immediately after P
    expect(isPowerNet("PERST_N")).toBe(false);
    expect(isPowerNet("PWRGD_CPU0")).toBe(false); // PWR_ requires the underscore
  });
});

describe("isStopNet", () => {
  it("should match ground nets", () => {
    expect(isStopNet("GND")).toBe(true);
    expect(isStopNet("VSS")).toBe(true);
    expect(isStopNet("AGND")).toBe(true);
    expect(isStopNet("DGND")).toBe(true);
  });

  it("should halt on suffixed and hierarchical ground nets", () => {
    // These previously slipped through, so xnet traversal flooded the whole
    // ground tree (token-limit blowups). They must now register as stop nets.
    expect(isStopNet("GNDREF")).toBe(true);
    expect(isStopNet("GNDPWR")).toBe(true);
    expect(isStopNet("/GND")).toBe(true);
    expect(isStopNet("/Power/GNDREF")).toBe(true);
  });

  it("should match power nets", () => {
    expect(isStopNet("VCC")).toBe(true);
    expect(isStopNet("VDD")).toBe(true);
    expect(isStopNet("VREG")).toBe(true);
    expect(isStopNet("VREG_3V3")).toBe(true);
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

  it("should halt on server-board rail names", () => {
    // These slipped through too, and unlike a ground they carry pull-ups on
    // every pulled-up signal, so one query fused most of the board into a
    // single supernet.
    expect(isStopNet("P3V3_AUX")).toBe(true);
    expect(isStopNet("P12V")).toBe(true);
    expect(isStopNet("P1V8_BMC")).toBe(true);
    expect(isStopNet("PVCCIN_CPU0")).toBe(true);
    expect(isStopNet("PVNN_TERM_CPU0")).toBe(true);
    expect(isStopNet("PVCC_GT")).toBe(true);
    expect(isStopNet("/Power/P3V3_AUX")).toBe(true);
  });

  it("should not match signal nets", () => {
    expect(isStopNet("I2C_SDA")).toBe(false);
    expect(isStopNet("SPI_CLK")).toBe(false);
    expect(isStopNet("SIGNAL")).toBe(false);
    expect(isStopNet("RESET_L")).toBe(false);
    expect(isStopNet("DATA_BUS")).toBe(false);
    expect(isStopNet("SPI2_FLASH_CS0_N")).toBe(false);
    expect(isStopNet("FM_CTRL_ENABLE_N")).toBe(false);
    expect(isStopNet("PWM_OUT")).toBe(false);
    expect(isStopNet("PCIE_TX3_P")).toBe(false);
  });

  it("should not match standalone + or - (requires at least one more char)", () => {
    expect(isStopNet("+")).toBe(false);
    expect(isStopNet("-")).toBe(false);
  });
});

// Regression guard: STOP_NET_PATTERN is intended to be exactly the union of the
// ground and power patterns. If the patterns ever drift (e.g. a rail is added to
// POWER but not STOP), the invariant below breaks even when the targeted cases
// above still pass.
describe("stop-net invariant (STOP === GROUND ∪ POWER)", () => {
  const sampleNets = [
    // ground
    "GND",
    "VSS",
    "AGND",
    "DGND",
    "PGND",
    "SGND",
    "CGND",
    // power rails
    "VCC",
    "VCC_IO",
    "VDD",
    "VDD_CORE",
    "VIN",
    "VOUT",
    "VBAT",
    "VBUS",
    "VSYS",
    "VREG",
    "VREG_3V3",
    "PWR_3V3",
    "RAIL_5V",
    "PP3V3",
    "PN5V",
    "LD_PP1V8",
    "LD_PN12V",
    "P3V3_AUX",
    "P12V",
    "PVCCIN_CPU0",
    "PVNN_TERM_CPU0",
    "3V3",
    "5V",
    "+12V",
    "-15V",
    "+VBAT",
    "-VEE",
    // non-rails (should be in neither set)
    "I2C_SDA",
    "SPI_CLK",
    "SIGNAL",
    "RESET_L",
    "DATA_BUS",
    "PWM_OUT",
    "PCIE_TX3_P",
    "+",
    "-",
  ];

  it.each(sampleNets)("isStopNet(%s) === isGroundNet || isPowerNet", (net) => {
    expect(isStopNet(net)).toBe(isGroundNet(net) || isPowerNet(net));
  });

  it("every ground net is also a stop net", () => {
    for (const net of ["GND", "VSS", "AGND", "DGND", "PGND", "SGND", "CGND"]) {
      expect(isStopNet(net)).toBe(true);
    }
  });

  it("every power net is also a stop net", () => {
    for (const net of ["VCC", "VDD", "VREG", "VBUS", "PP3V3", "+3V3", "-12V"]) {
      expect(isStopNet(net)).toBe(true);
    }
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

  it("should not match prefixes that merely start with a passive letter", () => {
    expect(isPassive("LED1")).toBe(false);
    expect(isPassive("CON1")).toBe(false);
    expect(isPassive("CR1")).toBe(false);
    expect(isPassive("RT1")).toBe(false);
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
    expect(isValidRefdes("@BOARD_TOP.BOARD_MAIN(SCH_1):INS21415196@LAN8710")).toBe(
      false
    );
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

  it("rejects unannotated refdes (annotation placeholder) — intentional", () => {
    // The "?" placeholder fails whole-string validation by design. This guards
    // the deliberate divergence from getRefdesPrefix: callers needing a prefix
    // from a possibly-unannotated refdes must use getRefdesPrefix, not this.
    // (Relaxing this would alter the Cadence parsers that depend on it.)
    expect(isValidRefdes("C?")).toBe(false);
    expect(isValidRefdes("PS?")).toBe(false);
  });
});

describe("getRefdesPrefix", () => {
  it("extracts the leading-letter prefix from annotated refdes", () => {
    expect(getRefdesPrefix("U1")).toBe("U");
    expect(getRefdesPrefix("R100")).toBe("R");
    expect(getRefdesPrefix("FB3")).toBe("FB");
    expect(getRefdesPrefix("U1_A")).toBe("U");
  });

  it("extracts the prefix from unannotated refdes (ignores the '?' placeholder)", () => {
    expect(getRefdesPrefix("C?")).toBe("C");
    expect(getRefdesPrefix("D?")).toBe("D");
    expect(getRefdesPrefix("PS?")).toBe("PS");
  });
});

describe("matchesRefdesType", () => {
  it("should match exact prefix", () => {
    expect(matchesRefdesType("R1", "R")).toBe(true);
    expect(matchesRefdesType("FB1", "FB")).toBe(true);
    expect(matchesRefdesType("C100", "C")).toBe(true);
  });

  it("matches unannotated refdes by their letter prefix", () => {
    expect(matchesRefdesType("C?", "C")).toBe(true);
    expect(matchesRefdesType("D?", "D")).toBe(true);
    expect(matchesRefdesType("PS?", "PS")).toBe(true);
  });

  it("should not match when type is a substring of the prefix", () => {
    expect(matchesRefdesType("LED1", "L")).toBe(false);
    expect(matchesRefdesType("CON1", "C")).toBe(false);
    expect(matchesRefdesType("FB1", "F")).toBe(false);
  });

  it("should be case-insensitive", () => {
    expect(matchesRefdesType("r1", "R")).toBe(true);
    expect(matchesRefdesType("R1", "r")).toBe(true);
    expect(matchesRefdesType("fb1", "FB")).toBe(true);
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
        SIGNAL: { R1: ["1"] },
        GND: { R1: ["2"], R2: ["1"], C1: ["1"] },
        OTHER_SIGNAL: { R2: ["2"] },
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
        SIGNAL: { R1: ["1"] },
        VCC: { R1: ["2"], R2: ["1"] },
        OTHER_SIGNAL: { R2: ["2"] },
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
        SIGNAL: { R1: ["1"] },
        "+3V3": { R1: ["2"], R2: ["1"] },
        OTHER: { R2: ["2"] },
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

  describe("structural stop-net guard (pin count)", () => {
    /**
     * A rail no pattern can recognize, carrying pull-ups onto unrelated signals
     * plus bypass caps to ground. `pinCount` is the rail's total pin count.
     * Entering through R0 must not leak onto FAR_SIGNAL_*.
     */
    const buildRailFixture = (
      railName: string,
      pinCount: number
    ): { nets: NetConnections; components: ComponentDetails } => {
      const nets: NetConnections = {
        ENTRY_SIGNAL: { R0: ["1"], U1: ["1"] },
        [railName]: { R0: ["2"] },
      };
      const components: ComponentDetails = {
        U1: { pins: { "1": "ENTRY_SIGNAL" }, mpn: "IC" },
        R0: { pins: { "1": "ENTRY_SIGNAL", "2": railName }, mpn: "10k" },
      };

      // Pull-ups: each becomes a pass-through onto another signal if the rail
      // is expanded — this is the mechanism that fuses a board into a supernet.
      for (let i = 1; i <= 3; i++) {
        const farNet = `FAR_SIGNAL_${i}`;
        nets[railName][`R${i}`] = ["1"];
        nets[farNet] = { [`R${i}`]: ["2"], [`U${i + 1}`]: ["1"] };
        components[`R${i}`] = { pins: { "1": railName, "2": farNet }, mpn: "10k" };
        components[`U${i + 1}`] = { pins: { "1": farNet }, mpn: "FAR_IC" };
      }

      // Bypass caps to ground, bulking the rail out to `pinCount` pins.
      const filler = pinCount - Object.values(nets[railName]).flat().length;
      for (let i = 1; i <= filler; i++) {
        nets[railName][`C${i}`] = ["1"];
        components[`C${i}`] = { pins: { "1": railName, "2": "GND" }, mpn: "100nF" };
      }

      return { nets, components };
    };

    it("should stop at a fat rail whose name matches no pattern", () => {
      const { nets, components } = buildRailFixture("E610_MYSTERY_RAIL", 41);
      expect(isStopNet("E610_MYSTERY_RAIL")).toBe(false); // name alone would not stop it

      const result = traverseCircuitFromNet("ENTRY_SIGNAL", nets, components);

      const refdes = result.components.map((c) => c.refdes).sort(naturalSort);
      expect(refdes).toEqual(["R0", "U1"]);
      expect(result.visited_nets).toContain("E610_MYSTERY_RAIL");
      expect(result.visited_nets).not.toContain("FAR_SIGNAL_1");
      expect(result.visited_nets).not.toContain("FAR_SIGNAL_2");
      expect(result.visited_nets).not.toContain("FAR_SIGNAL_3");
    });

    it("should expand the same rail when stopNetPinThreshold is raised", () => {
      const { nets, components } = buildRailFixture("E610_MYSTERY_RAIL", 41);

      const result = traverseCircuitFromNet("ENTRY_SIGNAL", nets, components, {
        stopNetPinThreshold: 1000,
      });

      const refdes = result.components.map((c) => c.refdes);
      expect(refdes).toContain("R1");
      expect(refdes).toContain("U2");
      expect(result.visited_nets).toContain("FAR_SIGNAL_1");
    });

    it("should expand a rail queried directly (start net is exempt)", () => {
      // Upstream semantics: asking for a rail by name is an explicit request to
      // see it, so the guard only applies to nets reached through a passive.
      const { nets, components } = buildRailFixture("E610_MYSTERY_RAIL", 41);

      const result = traverseCircuitFromNet("E610_MYSTERY_RAIL", nets, components);

      const refdes = result.components.map((c) => c.refdes);
      expect(refdes).toContain("U1");
      expect(refdes).toContain("U2");
      expect(result.visited_nets).toContain("ENTRY_SIGNAL");
      expect(result.visited_nets).toContain("FAR_SIGNAL_1");
    });

    it("should honour a custom low threshold on a mid-size net", () => {
      const nets: NetConnections = {
        SIGNAL: { R1: ["1"] },
        MID_NET: { R1: ["2"], R2: ["1"], U1: ["1", "2", "3", "4", "5", "6"] },
        OTHER_SIGNAL: { R2: ["2"] },
      };
      const components: ComponentDetails = {
        R1: { pins: { "1": "SIGNAL", "2": "MID_NET" }, mpn: "10k" },
        R2: { pins: { "1": "MID_NET", "2": "OTHER_SIGNAL" }, mpn: "0" },
        U1: {
          pins: {
            "1": "MID_NET",
            "2": "MID_NET",
            "3": "MID_NET",
            "4": "MID_NET",
            "5": "MID_NET",
            "6": "MID_NET",
          },
          mpn: "IC",
        },
      };

      // 8 pins: below the default threshold, so the net expands as a signal.
      expect(traverseCircuitFromNet("SIGNAL", nets, components).visited_nets).toContain(
        "OTHER_SIGNAL"
      );

      const guarded = traverseCircuitFromNet("SIGNAL", nets, components, {
        stopNetPinThreshold: 5,
      });
      expect(guarded.visited_nets).toContain("MID_NET");
      expect(guarded.visited_nets).not.toContain("OTHER_SIGNAL");
    });

    it("should not stop at ordinary signal nets under the threshold", () => {
      const nets: NetConnections = {
        SIGNAL_A: { R1: ["1"] },
        SIGNAL_B: { R1: ["2"], R2: ["1"], U1: ["1"] },
        SIGNAL_C: { R2: ["2"] },
      };
      const components: ComponentDetails = {
        R1: { pins: { "1": "SIGNAL_A", "2": "SIGNAL_B" }, mpn: "10k" },
        R2: { pins: { "1": "SIGNAL_B", "2": "SIGNAL_C" }, mpn: "0" },
        U1: { pins: { "1": "SIGNAL_B" }, mpn: "IC" },
      };

      const result = traverseCircuitFromNet("SIGNAL_A", nets, components);

      expect(result.visited_nets).toContain("SIGNAL_B");
      expect(result.visited_nets).toContain("SIGNAL_C");
    });
  });

  describe("no-connect nets", () => {
    it("should stop at NC reached through a passive", () => {
      const nets: NetConnections = {
        SIGNAL: { R1: ["1"] },
        NC: { R1: ["2"], R2: ["1"] },
        OTHER_SIGNAL: { R2: ["2"] },
      };
      const components: ComponentDetails = {
        R1: { pins: { "1": "SIGNAL", "2": "NC" }, mpn: "10k" },
        R2: { pins: { "1": "NC", "2": "OTHER_SIGNAL" }, mpn: "10k" },
      };

      const result = traverseCircuitFromNet("SIGNAL", nets, components);

      expect(result.components.length).toBe(1);
      expect(result.components[0].refdes).toBe("R1");
      expect(result.visited_nets).toContain("NC");
      expect(result.visited_nets).not.toContain("OTHER_SIGNAL");
    });

    it("should stop at NC regardless of case or sheet path", () => {
      const nets: NetConnections = {
        SIGNAL: { R1: ["1"] },
        "/Sheet/nc": { R1: ["2"], R2: ["1"] },
        OTHER_SIGNAL: { R2: ["2"] },
      };
      const components: ComponentDetails = {
        R1: { pins: { "1": "SIGNAL", "2": "/Sheet/nc" }, mpn: "10k" },
        R2: { pins: { "1": "/Sheet/nc", "2": "OTHER_SIGNAL" }, mpn: "10k" },
      };

      const result = traverseCircuitFromNet("SIGNAL", nets, components);

      expect(result.visited_nets).not.toContain("OTHER_SIGNAL");
    });

    it("should stop at a fat aggregated NC net", () => {
      const nets: NetConnections = { SIGNAL: { R1: ["1"] }, NC: { R1: ["2"] } };
      const components: ComponentDetails = {
        R1: { pins: { "1": "SIGNAL", "2": "NC" }, mpn: "10k" },
      };
      for (let i = 1; i <= 60; i++) {
        nets.NC[`U${i}`] = ["1"];
        nets[`U${i}_SIG`] = { [`U${i}`]: ["2"] };
        components[`U${i}`] = { pins: { "1": "NC", "2": `U${i}_SIG` }, mpn: "IC" };
      }

      const result = traverseCircuitFromNet("SIGNAL", nets, components);

      expect(result.components.map((c) => c.refdes)).toEqual(["R1"]);
    });
  });

  describe("passive component traversal", () => {
    it("should traverse through passive components and show all their pins", () => {
      const nets: NetConnections = {
        SIGNAL_A: { R1: ["1"] },
        SIGNAL_B: { R1: ["2"], R2: ["1"] },
        SIGNAL_C: { R2: ["2"] },
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

    it("should traverse a series 0R between two driven signals", () => {
      const nets: NetConnections = {
        DRIVER_OUT: { U1: ["1"], R1: ["1"] },
        RECEIVER_IN: { R1: ["2"], U2: ["1"] },
      };
      const components: ComponentDetails = {
        U1: { pins: { "1": "DRIVER_OUT" }, mpn: "DRIVER" },
        R1: { pins: { "1": "DRIVER_OUT", "2": "RECEIVER_IN" }, mpn: "0" },
        U2: { pins: { "1": "RECEIVER_IN" }, mpn: "RECEIVER" },
      };

      const result = traverseCircuitFromNet("DRIVER_OUT", nets, components);

      expect(result.components.map((c) => c.refdes).sort(naturalSort)).toEqual(["R1", "U1", "U2"]);
      expect(result.visited_nets).toContain("RECEIVER_IN");
    });

    it("should traverse a series ferrite bead between two driven signals", () => {
      const nets: NetConnections = {
        DRIVER_OUT: { U1: ["1"], FB1: ["1"] },
        RECEIVER_IN: { FB1: ["2"], U2: ["1"] },
      };
      const components: ComponentDetails = {
        U1: { pins: { "1": "DRIVER_OUT" }, mpn: "DRIVER" },
        FB1: { pins: { "1": "DRIVER_OUT", "2": "RECEIVER_IN" }, mpn: "600R@100MHz" },
        U2: { pins: { "1": "RECEIVER_IN" }, mpn: "RECEIVER" },
      };

      const result = traverseCircuitFromNet("DRIVER_OUT", nets, components);

      expect(result.components.map((c) => c.refdes).sort(naturalSort)).toEqual(["FB1", "U1", "U2"]);
      expect(result.visited_nets).toContain("RECEIVER_IN");
    });

    it("should traverse an AC-coupling series capacitor between two signals", () => {
      // Series caps stay pass-throughs: the guard only rejects nets that are
      // structurally planes, not the passive type.
      const nets: NetConnections = {
        TX_P: { U1: ["1"], C1: ["1"] },
        TX_P_CONN: { C1: ["2"], J1: ["1"] },
      };
      const components: ComponentDetails = {
        U1: { pins: { "1": "TX_P" }, mpn: "SERDES" },
        C1: { pins: { "1": "TX_P", "2": "TX_P_CONN" }, mpn: "100nF" },
        J1: { pins: { "1": "TX_P_CONN" }, mpn: "CONN" },
      };

      const result = traverseCircuitFromNet("TX_P", nets, components);

      expect(result.components.map((c) => c.refdes).sort(naturalSort)).toEqual(["C1", "J1", "U1"]);
      expect(result.visited_nets).toContain("TX_P_CONN");
    });

    it("should traverse through capacitors", () => {
      const nets: NetConnections = {
        SIGNAL: { C1: ["1"] },
        FILTERED: { C1: ["2"] },
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
        SIGNAL: { L1: ["1"] },
        FILTERED: { L1: ["2"] },
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
        SIGNAL: { FB1: ["1"] },
        FILTERED: { FB1: ["2"] },
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
        MY_SIGNAL: { U1: ["5"], R1: ["1"] },
        GND: { U1: ["1", "10", "20"], R1: ["2"] },
        VCC: { U1: ["2", "11"] },
        OTHER_SIGNAL: { U1: ["3"] },
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
        SIGNAL_A: { U1: ["1"] },
        SIGNAL_B: { U1: ["2"], R1: ["1"] },
        SIGNAL_C: { R1: ["2"] },
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
        SIGNAL: { R1: ["1"] },
        NODE: { R1: ["2"], U1: ["3"] },
        GND: { U1: ["1", "5"] },
        VCC: { U1: ["2"] },
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
      const nets: NetConnections = { SIGNAL: { R1: ["1"] } };
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
        GND: { U1: ["4"] },
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
        SIGNAL: { R1: ["1"] },
        GND: { R1: ["2"] },
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

    expect(computeCircuitHash(components1)).toBe(computeCircuitHash(components2));
  });

  it("should return different hash for different circuits", () => {
    const circuit1 = [{ refdes: "R1", mpn: "10k", connections: [{ net: "A", pins: ["1"] }] }];
    const circuit2 = [{ refdes: "R1", mpn: "10k", connections: [{ net: "B", pins: ["1"] }] }];

    expect(computeCircuitHash(circuit1)).not.toBe(computeCircuitHash(circuit2));
  });

  it("should return different hash when a pin moves to another net", () => {
    const circuit1 = [{ refdes: "R1", mpn: "10k", connections: [{ net: "A", pins: ["1", "2"] }] }];
    const circuit2 = [
      {
        refdes: "R1",
        mpn: "10k",
        connections: [
          { net: "A", pins: ["1"] },
          { net: "B", pins: ["2"] },
        ],
      },
    ];

    expect(computeCircuitHash(circuit1)).not.toBe(computeCircuitHash(circuit2));
  });

  // mpn is backend-dependent -- the .dat path reports a netlister part-name
  // string, the .DSN path the bare symbol name -- so hashing it made the same
  // physical circuit mismatch across backends.
  it("should ignore mpn so the same topology hashes equal across backends", () => {
    const fromDat = [
      {
        refdes: "R1",
        mpn: "RES_H_R0402_0R/0.05/0402_72E00*",
        connections: [
          { net: "A", pins: ["1"] },
          { net: "B", pins: ["2"] },
        ],
      },
      {
        refdes: "U1",
        mpn: "SOME_PART_NUMBER_TRUNCATED_AT_31",
        connections: [{ net: "B", pins: ["W3"] }],
      },
    ];
    const fromDsn = [
      {
        refdes: "R1",
        mpn: "RES_H",
        connections: [
          { net: "A", pins: ["1"] },
          { net: "B", pins: ["2"] },
        ],
      },
      { refdes: "U1", mpn: "SYMBOL_NAME", connections: [{ net: "B", pins: ["W3"] }] },
    ];

    expect(computeCircuitHash(fromDat)).toBe(computeCircuitHash(fromDsn));
  });

  it("should ignore a missing mpn as well", () => {
    const withMpn = [{ refdes: "R1", mpn: "10k", connections: [{ net: "A", pins: ["1"] }] }];
    const withoutMpn = [{ refdes: "R1", connections: [{ net: "A", pins: ["1"] }] }];

    expect(computeCircuitHash(withMpn)).toBe(computeCircuitHash(withoutMpn));
  });

  it("should return zero hash for empty components", () => {
    expect(computeCircuitHash([])).toBe("0000000000000000");
  });
});

describe("isDnsComponent", () => {
  it("should detect DNS, DNI, DNP, DNF in mpn", () => {
    expect(isDnsComponent({ mpn: "DNS" })).toBe(true);
    expect(isDnsComponent({ mpn: "DNI" })).toBe(true);
    expect(isDnsComponent({ mpn: "DNP" })).toBe(true);
    expect(isDnsComponent({ mpn: "DNF" })).toBe(true);
  });

  it("should detect DNS markers in description", () => {
    expect(isDnsComponent({ description: "Do Not Stuff" })).toBe(true);
    expect(isDnsComponent({ description: "NOT POPULATED" })).toBe(true);
    expect(isDnsComponent({ description: "DO NOT INSTALL" })).toBe(true);
  });

  it("should detect DNS markers in comment", () => {
    expect(isDnsComponent({ comment: "DNI" })).toBe(true);
    expect(isDnsComponent({ comment: "NO POP" })).toBe(true);
  });

  it("should be case-insensitive", () => {
    expect(isDnsComponent({ mpn: "dns" })).toBe(true);
    expect(isDnsComponent({ mpn: "Dni" })).toBe(true);
    expect(isDnsComponent({ description: "do not stuff" })).toBe(true);
  });

  it("should detect DNI embedded in comma-separated values", () => {
    expect(isDnsComponent({ mpn: "CAP_100PF,DNI" })).toBe(true);
    expect(isDnsComponent({ mpn: "DNI,10K" })).toBe(true);
  });

  it("should not detect DNS in normal component names", () => {
    expect(isDnsComponent({ mpn: "STM32F411" })).toBe(false);
    expect(isDnsComponent({ mpn: "10K" })).toBe(false);
    expect(isDnsComponent({})).toBe(false);
    expect(isDnsComponent(undefined)).toBe(false);
  });
});

describe("stripDnsMarkers", () => {
  it("should remove leading DNS token", () => {
    expect(stripDnsMarkers("DNI,10K")).toBe("10K");
  });

  it("should remove trailing DNS token", () => {
    expect(stripDnsMarkers("10K,DNI")).toBe("10K");
  });

  it("should remove middle DNS token", () => {
    expect(stripDnsMarkers("0.1uF,DNI,10V")).toBe("0.1uF,10V");
  });

  it("should return undefined for solo DNS token", () => {
    expect(stripDnsMarkers("DNI")).toBeUndefined();
    expect(stripDnsMarkers("DNS")).toBeUndefined();
    expect(stripDnsMarkers("DNP")).toBeUndefined();
    expect(stripDnsMarkers("DNF")).toBeUndefined();
  });

  it("should strip trailing underscore suffix", () => {
    expect(stripDnsMarkers("RES_10K_0402_R402-25RD_DNI")).toBe("RES_10K_0402_R402-25RD");
  });

  it("should handle whitespace around tokens", () => {
    expect(stripDnsMarkers("15pF , DNI")).toBe("15pF");
  });

  it("should handle case-insensitive markers", () => {
    expect(stripDnsMarkers("10K,dni")).toBe("10K");
    expect(stripDnsMarkers("PART_Dni")).toBe("PART");
  });

  it("should preserve non-DNS content unchanged", () => {
    expect(stripDnsMarkers("10K,1%")).toBe("10K,1%");
    expect(stripDnsMarkers("CAP_0603")).toBe("CAP_0603");
  });
});

/**
 * The marker test a value field is read with.
 *
 * A value carries units, and `NF` is the one marker token that is also one.
 * `isDnsComponent` reads mpn, description and comment, where `NF` genuinely
 * means "no fit"; a value writes nanofarads, and reading it with the same set
 * would unstuff a fitted capacitor whose value is written `2.2 nF`. Both the
 * Cadence `.DSN` path and the Altium parser read values through this.
 */
describe("hasDnsValueMarker", () => {
  it("reads the markers a value writes to mean Do Not Stuff", () => {
    for (const value of ["DNP", "DNS", "DNI", "DNM", "10K,DNI", "DNM_0402", "10K_NC", "NC"]) {
      expect(hasDnsValueMarker(value)).toBe(true);
    }
  });

  it("reads the phrases spelled out", () => {
    for (const value of ["DO NOT STUFF", "Do Not Populate", "NOT FITTED", "NO POP"]) {
      expect(hasDnsValueMarker(value)).toBe(true);
    }
  });

  it("leaves a capacitance written with a space before the unit alone", () => {
    // The delimited `nF` here is what `isDnsComponent` reads as "no fit".
    for (const value of ["2.2 nF", "1 nF", "10 NF", "4.7 nf"]) {
      expect(isDnsComponent({ mpn: value })).toBe(true);
      expect(hasDnsValueMarker(value)).toBe(false);
    }
  });

  it("leaves ordinary values alone", () => {
    for (const value of ["100nF", "10K", "0R", "1uF", "4.7uH", "5.1K"]) {
      expect(hasDnsValueMarker(value)).toBe(false);
    }
  });
});
