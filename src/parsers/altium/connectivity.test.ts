import { describe, it, expect } from "vitest";
import { findAllConnectedComponents, isConnected } from "./connectivity.js";
import { RECORD_TYPES } from "./types.js";
import type { AltiumRecord } from "./types.js";

describe("Connectivity", () => {
  describe("isConnected", () => {
    it("should detect connected wires by coordinate overlap", () => {
      const wireA: AltiumRecord = {
        index: 0,
        RECORD: RECORD_TYPES.WIRE,
        coords: [
          [0, 0],
          [100, 0],
        ],
      };

      const wireB: AltiumRecord = {
        index: 1,
        RECORD: RECORD_TYPES.WIRE,
        coords: [
          [100, 0],
          [100, 100],
        ],
      };

      expect(isConnected(wireA, wireB)).toBe(true);
    });

    // Coordinates are scaled by 100000 per schematic unit, and the grid is 10
    // units, so a gap of 5 units is 500000.
    it("should detect disconnected wires", () => {
      const wireA: AltiumRecord = {
        index: 0,
        RECORD: RECORD_TYPES.WIRE,
        coords: [
          [0, 0],
          [500000, 0],
        ],
      };

      const wireB: AltiumRecord = {
        index: 1,
        RECORD: RECORD_TYPES.WIRE,
        coords: [
          [1000000, 0],
          [1500000, 0],
        ],
      };

      expect(isConnected(wireA, wireB)).toBe(false);
    });

    it("should detect disconnected wires with overlapping bounding boxes", () => {
      const wireA: AltiumRecord = {
        index: 0,
        RECORD: RECORD_TYPES.WIRE,
        coords: [
          [0, 0],
          [1000000, 1000000],
        ],
      };

      const wireB: AltiumRecord = {
        index: 1,
        RECORD: RECORD_TYPES.WIRE,
        coords: [
          [1000000, 0],
          [0, 1000000],
        ],
      };

      expect(isConnected(wireA, wireB)).toBe(false);
    });

    it("joins a label a hundredth of a unit off its wire, as imported designs draw them", () => {
      const wire: AltiumRecord = {
        index: 0,
        RECORD: RECORD_TYPES.WIRE,
        coords: [
          [0, 0],
          [1000000, 0],
        ],
      };
      const label: AltiumRecord = {
        index: 1,
        RECORD: RECORD_TYPES.NET_LABEL,
        Text: "CLK",
        coords: [[500000, 1000]],
      };
      const farLabel: AltiumRecord = { ...label, index: 2, coords: [[500000, 100000]] };
      expect(isConnected(wire, label)).toBe(true);
      expect(isConnected(wire, farLabel)).toBe(false);
    });

    it("joins two pins end to end but not by overlapping along one line", () => {
      const pinA: AltiumRecord = {
        index: 0,
        RECORD: RECORD_TYPES.PIN,
        coords: [
          [0, 0],
          [300000, 0],
        ],
      };
      const endToEnd: AltiumRecord = {
        index: 1,
        RECORD: RECORD_TYPES.PIN,
        coords: [
          [600000, 0],
          [300000, 0],
        ],
      };
      const overlapping: AltiumRecord = {
        index: 2,
        RECORD: RECORD_TYPES.PIN,
        coords: [
          [100000, 0],
          [400000, 0],
        ],
      };
      expect(isConnected(pinA, endToEnd)).toBe(true);
      expect(isConnected(pinA, overlapping)).toBe(false);
    });

    it("keeps apart pins drawn from one point", () => {
      const pinA: AltiumRecord = {
        index: 0,
        RECORD: RECORD_TYPES.PIN,
        coords: [
          [0, 0],
          [300000, 0],
        ],
      };
      const pinB: AltiumRecord = {
        index: 1,
        RECORD: RECORD_TYPES.PIN,
        coords: [
          [0, 0],
          [0, 300000],
        ],
      };
      expect(isConnected(pinA, pinB)).toBe(false);
    });

    it("should detect pin connected to wire", () => {
      const wire: AltiumRecord = {
        index: 0,
        RECORD: RECORD_TYPES.WIRE,
        coords: [
          [0, 0],
          [100, 0],
        ],
      };

      const pin: AltiumRecord = {
        index: 1,
        RECORD: RECORD_TYPES.PIN,
        coords: [[50, 0]],
      };

      expect(isConnected(wire, pin)).toBe(true);
    });

    it("should connect power ports with same Text", () => {
      const port1: AltiumRecord = {
        index: 0,
        RECORD: RECORD_TYPES.POWER_PORT,
        Text: "VCC",
        coords: [[0, 0]],
      };

      const port2: AltiumRecord = {
        index: 1,
        RECORD: RECORD_TYPES.POWER_PORT,
        Text: "VCC",
        coords: [[100000, 100000]], // Far apart
      };

      expect(isConnected(port1, port2)).toBe(true);
    });

    it("should connect power ports with same TEXT", () => {
      const port1: AltiumRecord = {
        index: 0,
        RECORD: RECORD_TYPES.POWER_PORT,
        TEXT: "VCC",
        coords: [[0, 0]],
      };

      const port2: AltiumRecord = {
        index: 1,
        RECORD: RECORD_TYPES.POWER_PORT,
        TEXT: "VCC",
        coords: [[100000, 100000]],
      };

      expect(isConnected(port1, port2)).toBe(true);
    });

    it("should not connect power ports with different Text", () => {
      const port1: AltiumRecord = {
        index: 0,
        RECORD: RECORD_TYPES.POWER_PORT,
        Text: "VCC",
        coords: [[0, 0]],
      };

      const port2: AltiumRecord = {
        index: 1,
        RECORD: RECORD_TYPES.POWER_PORT,
        Text: "GND",
        coords: [[0, 0]], // Same location
      };

      // Different Text values, but same location - they are connected by location
      // In the Python implementation, they would connect by location
      expect(isConnected(port1, port2)).toBe(true);
    });

    it("should connect net labels with same Text globally", () => {
      const label1: AltiumRecord = {
        index: 0,
        RECORD: RECORD_TYPES.NET_LABEL,
        Text: "IMU_SCL",
        coords: [[0, 0]],
      };

      const label2: AltiumRecord = {
        index: 1,
        RECORD: RECORD_TYPES.NET_LABEL,
        Text: "IMU_SCL",
        coords: [[100000, 100000]], // Far apart
      };

      // Net labels with same Text are connected globally (off-page connection)
      expect(isConnected(label1, label2)).toBe(true);
    });

    it("connects net labels whose Text differs only in case", () => {
      const label1: AltiumRecord = {
        index: 0,
        RECORD: RECORD_TYPES.NET_LABEL,
        Text: "VBAT",
        coords: [[0, 0]],
      };
      const label2: AltiumRecord = { ...label1, index: 1, Text: "VBat", coords: [[900000, 0]] };

      expect(isConnected(label1, label2)).toBe(true);
      expect(isConnected({ ...label1, Text: "10µA" }, { ...label2, Text: "10μA" })).toBe(false);
    });

    it("should not connect net labels with different Text unless by location", () => {
      const label1: AltiumRecord = {
        index: 0,
        RECORD: RECORD_TYPES.NET_LABEL,
        Text: "IMU_SCL",
        coords: [[0, 0]],
      };

      const label2: AltiumRecord = {
        index: 1,
        RECORD: RECORD_TYPES.NET_LABEL,
        Text: "IMU_SDA",
        coords: [[100000, 100000]], // Far apart, different text
      };

      expect(isConnected(label1, label2)).toBe(false);
    });
  });
});

describe("findAllConnectedComponents", () => {
  it("joins devices that touch across a spatial index cell edge", () => {
    // Cells are ten units wide: the wire ends in cell 0 and the pin starts in cell 1.
    const wire: AltiumRecord = {
      index: 0,
      RECORD: RECORD_TYPES.WIRE,
      coords: [
        [500000, 0],
        [995000, 0],
      ],
    };
    const pin: AltiumRecord = {
      index: 1,
      RECORD: RECORD_TYPES.PIN,
      coords: [
        [1000000, 0],
        [2000000, 0],
      ],
    };
    expect(isConnected(wire, pin)).toBe(true);
    expect(findAllConnectedComponents([wire, pin])).toHaveLength(1);
  });
});

describe("Connectivity - PORT records", () => {
  it("should connect PORTs with same Name globally", () => {
    const port1: AltiumRecord = {
      index: 0,
      RECORD: RECORD_TYPES.PORT,
      Name: "DOUT",
      coords: [[0, 0]],
    };

    const port2: AltiumRecord = {
      index: 1,
      RECORD: RECORD_TYPES.PORT,
      Name: "DOUT",
      coords: [[200000, 200000]],
    };

    expect(isConnected(port1, port2)).toBe(true);
  });

  it("should not connect PORTs with different Name", () => {
    const port1: AltiumRecord = {
      index: 0,
      RECORD: RECORD_TYPES.PORT,
      Name: "DOUT",
      coords: [[0, 0]],
    };

    const port2: AltiumRecord = {
      index: 1,
      RECORD: RECORD_TYPES.PORT,
      Name: "DIN",
      coords: [[200000, 200000]],
    };

    expect(isConnected(port1, port2)).toBe(false);
  });

  it("should not connect a PORT to a NET_LABEL of the same name", () => {
    // Altium's connectivity guide: a port called Inta does not connect to a
    // net label called Inta; the two must be wired together.
    const port: AltiumRecord = {
      index: 0,
      RECORD: RECORD_TYPES.PORT,
      Name: "CLK",
      coords: [[0, 0]],
    };

    const label: AltiumRecord = {
      index: 1,
      RECORD: RECORD_TYPES.NET_LABEL,
      Text: "CLK",
      coords: [[200000, 200000]],
    };

    expect(isConnected(port, label)).toBe(false);
  });
});
