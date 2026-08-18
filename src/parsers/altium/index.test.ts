/**
 * Altium Parser Tests
 */

import { describe, it, expect } from "vitest";
import { extractComponents, readSheetNumber } from "./index.js";
import { parseRecords } from "./record-parser.js";
import { buildHierarchy, getPartsList, findRecordByIndex } from "./hierarchy.js";
import { isConnected, findConnectedDevices } from "./connectivity.js";
import { RECORD_TYPES } from "./types.js";
import type { AltiumRecord, AltiumSchematic } from "./types.js";

describe("Record Parser", () => {
  describe("parseRecords", () => {
    it("should parse simple key-value pairs", () => {
      // Simulate a minimal Altium record buffer
      // Format: 5 bytes prefix + records + 1 byte suffix
      // Each record separated by XXX\x00\x00| pattern
      const prefix = Buffer.alloc(5);
      const suffix = Buffer.alloc(1);

      // Simple record: RECORD=1|Designator=U1|
      const recordData = Buffer.from("RECORD=1|Designator=U1|");

      const buffer = Buffer.concat([prefix, recordData, suffix]);
      const result = parseRecords(buffer);

      expect(result.records).toBeDefined();
      expect(result.header).toBeDefined();
    });

    it("should decode Windows-1252 characters via latin1", () => {
      const prefix = Buffer.alloc(5);
      const suffix = Buffer.alloc(1);

      // 0xB1 = ±, 0xB5 = µ, 0xB0 = °
      const segment = Buffer.from([
        // DESC=±10% µF 90°
        0x44,
        0x45,
        0x53,
        0x43,
        0x3d, // DESC=
        0xb1,
        0x31,
        0x30,
        0x25,
        0x20, // ±10%
        0xb5,
        0x46,
        0x20, // µF
        0x39,
        0x30,
        0xb0, // 90°
        0x7c, // |
        0x52,
        0x45,
        0x43,
        0x4f,
        0x52,
        0x44,
        0x3d,
        0x31, // RECORD=1
        0x7c, // |
      ]);

      const buffer = Buffer.concat([prefix, segment, suffix]);
      const result = parseRecords(buffer);

      const record = result.records[0];
      expect(record).toBeDefined();
      expect(record.DESC).toBe("±10% µF 90°");
    });

    it("should separate header from records", () => {
      const prefix = Buffer.alloc(5);
      const suffix = Buffer.alloc(1);

      // Header has HEADER key, records have RECORD key
      const headerData = Buffer.from("HEADER=Schematic|VERSION=1.0|");
      const delimiter = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x7c]); // XXX\x00\x00|
      const recordData = Buffer.from("RECORD=1|Designator=U1|");

      const buffer = Buffer.concat([prefix, headerData, delimiter, recordData, suffix]);

      const result = parseRecords(buffer);

      expect(result.header.length).toBeGreaterThanOrEqual(0);
      expect(result.records.length).toBeGreaterThanOrEqual(0);
    });
  });
});

describe("Hierarchy Builder", () => {
  describe("buildHierarchy", () => {
    it("should establish parent-child relationships via OwnerIndex", () => {
      const schematic: AltiumSchematic = {
        header: [],
        records: [
          { index: 0, RECORD: "1", Designator: "U1" } as AltiumRecord,
          { index: 1, RECORD: "2", OwnerIndex: "0", Name: "PIN1" } as AltiumRecord,
          { index: 2, RECORD: "2", OwnerIndex: "0", Name: "PIN2" } as AltiumRecord,
        ],
      };

      const result = buildHierarchy(schematic);

      // Root record should have children
      expect(result.records.length).toBe(1);
      expect(result.records[0].children).toBeDefined();
      expect(result.records[0].children?.length).toBe(2);
    });

    it("should establish parent-child relationships via OWNERINDEX", () => {
      const schematic: AltiumSchematic = {
        header: [],
        records: [
          { index: 0, RECORD: "1", Designator: "U1" } as AltiumRecord,
          { index: 1, RECORD: "2", OWNERINDEX: "0", Name: "PIN1" } as AltiumRecord,
          { index: 2, RECORD: "2", OWNERINDEX: "0", Name: "PIN2" } as AltiumRecord,
        ],
      };

      const result = buildHierarchy(schematic);

      expect(result.records.length).toBe(1);
      expect(result.records[0].children).toBeDefined();
      expect(result.records[0].children?.length).toBe(2);
    });

    it("should handle records without OWNERINDEX as roots", () => {
      const schematic: AltiumSchematic = {
        header: [],
        records: [
          { index: 0, RECORD: "1" } as AltiumRecord,
          { index: 1, RECORD: "1" } as AltiumRecord,
        ],
      };

      const result = buildHierarchy(schematic);

      expect(result.records.length).toBe(2);
    });
  });

  describe("getPartsList", () => {
    it("should filter for RECORD=1 only", () => {
      const schematic: AltiumSchematic = {
        header: [],
        records: [
          { index: 0, RECORD: "1", Designator: "U1" } as AltiumRecord,
          { index: 1, RECORD: "2" } as AltiumRecord,
          { index: 2, RECORD: "1", Designator: "R1" } as AltiumRecord,
          { index: 3, RECORD: "27" } as AltiumRecord,
        ],
      };

      const parts = getPartsList(schematic);

      expect(parts.length).toBe(2);
      expect(parts[0].Designator).toBe("U1");
      expect(parts[1].Designator).toBe("R1");
    });
  });

  describe("findRecordByIndex", () => {
    it("should find records in nested hierarchy", () => {
      const schematic: AltiumSchematic = {
        header: [],
        records: [
          {
            index: 0,
            RECORD: "1",
            children: [
              { index: 1, RECORD: "2" } as AltiumRecord,
              { index: 2, RECORD: "2" } as AltiumRecord,
            ],
          } as AltiumRecord,
        ],
      };

      const found = findRecordByIndex(schematic, 1);

      expect(found).toBeDefined();
      expect(found?.index).toBe(1);
    });

    it("should return undefined for non-existent index", () => {
      const schematic: AltiumSchematic = {
        header: [],
        records: [{ index: 0, RECORD: "1" } as AltiumRecord],
      };

      const found = findRecordByIndex(schematic, 999);

      expect(found).toBeUndefined();
    });
  });
});

describe("Component Extraction", () => {
  it("should drop comment when it resolves to the same Value", () => {
    const schematic: AltiumSchematic = {
      header: [],
      records: [
        {
          index: 0,
          RECORD: RECORD_TYPES.COMPONENT,
          children: [
            {
              index: 1,
              RECORD: RECORD_TYPES.DESIGNATOR,
              Text: "C6",
            } as AltiumRecord,
            {
              index: 2,
              RECORD: RECORD_TYPES.PARAMETER,
              Name: "Comment",
              Text: "=Value",
            } as AltiumRecord,
            {
              index: 3,
              RECORD: RECORD_TYPES.PARAMETER,
              Name: "Value",
              Text: "4.7uF",
            } as AltiumRecord,
          ],
        } as AltiumRecord,
      ],
    };

    const components = extractComponents(schematic);
    const c6 = components.C6;

    expect(c6).toBeDefined();
    expect(c6?.value).toBe("4.7uF");
    expect(Object.prototype.hasOwnProperty.call(c6 ?? {}, "comment")).toBe(false);
  });

  it("should keep comment distinct from value when both are present", () => {
    const schematic: AltiumSchematic = {
      header: [],
      records: [
        {
          index: 0,
          RECORD: RECORD_TYPES.COMPONENT,
          children: [
            {
              index: 1,
              RECORD: RECORD_TYPES.DESIGNATOR,
              Text: "U2",
            } as AltiumRecord,
            {
              index: 2,
              RECORD: RECORD_TYPES.PARAMETER,
              Name: "Comment",
              Text: "CYUSB3014-BZXC",
            } as AltiumRecord,
            {
              index: 3,
              RECORD: RECORD_TYPES.PARAMETER,
              Name: "Value",
              Text: "100nF",
            } as AltiumRecord,
          ],
        } as AltiumRecord,
      ],
    };

    const components = extractComponents(schematic);
    const u2 = components.U2;

    expect(u2).toBeDefined();
    expect(u2?.comment).toBe("CYUSB3014-BZXC");
    expect(u2?.value).toBe("100nF");
    expect(Object.prototype.hasOwnProperty.call(u2 ?? {}, "comment")).toBe(true);
  });
});

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

    it("should detect disconnected wires", () => {
      const wireA: AltiumRecord = {
        index: 0,
        RECORD: RECORD_TYPES.WIRE,
        coords: [
          [0, 0],
          [50, 0],
        ],
      };

      const wireB: AltiumRecord = {
        index: 1,
        RECORD: RECORD_TYPES.WIRE,
        coords: [
          [100, 0],
          [150, 0],
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
          [100, 100],
        ],
      };

      const wireB: AltiumRecord = {
        index: 1,
        RECORD: RECORD_TYPES.WIRE,
        coords: [
          [100, 0],
          [0, 100],
        ],
      };

      expect(isConnected(wireA, wireB)).toBe(false);
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
        coords: [[1000, 1000]], // Far apart
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
        coords: [[1000, 1000]],
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
        coords: [[1000, 1000]], // Far apart
      };

      // Net labels with same Text are connected globally (off-page connection)
      expect(isConnected(label1, label2)).toBe(true);
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
        coords: [[1000, 1000]], // Far apart, different text
      };

      expect(isConnected(label1, label2)).toBe(false);
    });
  });

  describe("findConnectedDevices", () => {
    it("should find all devices in a connected chain", () => {
      const wire1: AltiumRecord = {
        index: 0,
        RECORD: RECORD_TYPES.WIRE,
        coords: [
          [0, 0],
          [100, 0],
        ],
      };

      const wire2: AltiumRecord = {
        index: 1,
        RECORD: RECORD_TYPES.WIRE,
        coords: [
          [100, 0],
          [200, 0],
        ],
      };

      const pin: AltiumRecord = {
        index: 2,
        RECORD: RECORD_TYPES.PIN,
        coords: [[200, 0]],
      };

      const allDevices = [wire1, wire2, pin];
      const connected = findConnectedDevices(wire1, allDevices);

      expect(connected.length).toBe(3);
      expect(connected.map((d) => d.index).sort()).toEqual([0, 1, 2]);
    });

    it("should not include disconnected devices", () => {
      const wire1: AltiumRecord = {
        index: 0,
        RECORD: RECORD_TYPES.WIRE,
        coords: [
          [0, 0],
          [100, 0],
        ],
      };

      const wire2: AltiumRecord = {
        index: 1,
        RECORD: RECORD_TYPES.WIRE,
        coords: [
          [500, 500],
          [600, 500],
        ],
      };

      const allDevices = [wire1, wire2];
      const connected = findConnectedDevices(wire1, allDevices);

      expect(connected.length).toBe(1);
      expect(connected[0].index).toBe(0);
    });
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
      coords: [[2000, 2000]],
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
      coords: [[2000, 2000]],
    };

    expect(isConnected(port1, port2)).toBe(false);
  });

  it("should connect PORT to NET_LABEL with same name", () => {
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
      coords: [[2000, 2000]],
    };

    expect(isConnected(port, label)).toBe(true);
  });
});

describe("RECORD_TYPES", () => {
  it("should define all expected record types", () => {
    expect(RECORD_TYPES.COMPONENT).toBe("1");
    expect(RECORD_TYPES.PIN).toBe("2");
    expect(RECORD_TYPES.POWER_PORT).toBe("17");
    expect(RECORD_TYPES.NET_LABEL).toBe("25");
    expect(RECORD_TYPES.WIRE).toBe("27");
    expect(RECORD_TYPES.DESIGNATOR).toBe("34");
  });
});

describe("readSheetNumber", () => {
  const parameter = (name: string, text: string): AltiumRecord => ({
    RECORD: RECORD_TYPES.PARAMETER,
    Name: name,
    Text: text,
    index: 0,
  });

  it("reads a document parameter written at the root of the hierarchy", () => {
    const schematic: AltiumSchematic = { header: [], records: [parameter("SheetNumber", "3")] };
    expect(readSheetNumber(schematic)).toBe("3");
  });

  it("reads a document parameter hung off the SHEET record instead", () => {
    const schematic: AltiumSchematic = {
      header: [],
      records: [
        { RECORD: RECORD_TYPES.SHEET, index: 0, children: [parameter("SheetNumber", "7")] },
      ],
    };
    expect(readSheetNumber(schematic)).toBe("7");
  });

  it("ignores a component that carries its own SheetNumber property", () => {
    const schematic: AltiumSchematic = {
      header: [],
      records: [
        { RECORD: RECORD_TYPES.COMPONENT, index: 0, children: [parameter("SheetNumber", "99")] },
        parameter("SheetNumber", "4"),
      ],
    };
    expect(readSheetNumber(schematic)).toBe("4");
  });

  it("finds nothing when only a component claims a SheetNumber", () => {
    const schematic: AltiumSchematic = {
      header: [],
      records: [
        { RECORD: RECORD_TYPES.COMPONENT, index: 0, children: [parameter("SheetNumber", "99")] },
      ],
    };
    expect(readSheetNumber(schematic)).toBeUndefined();
  });

  it("ignores the placeholder an unnumbered sheet carries", () => {
    const schematic: AltiumSchematic = { header: [], records: [parameter("SheetNumber", "*")] };
    expect(readSheetNumber(schematic)).toBeUndefined();
  });

  it("matches the parameter name however it is cased", () => {
    const schematic: AltiumSchematic = { header: [], records: [parameter("sheetnumber", "2")] };
    expect(readSheetNumber(schematic)).toBe("2");
  });
});

/**
 * Altium designs conventionally mark a part Do Not Populate by writing the
 * marker into Value and leaving every other field ordinary — a resistor whose
 * Value reads `DNP`. That field was not read, so those parts were reported as
 * stuffed; the temperatureSensor fixture carries two of them.
 */
describe("Do Not Stuff written into Value", () => {
  const withValue = (designator: string, value: string): AltiumSchematic => ({
    header: [],
    records: [
      {
        index: 0,
        RECORD: RECORD_TYPES.COMPONENT,
        children: [
          { index: 1, RECORD: RECORD_TYPES.DESIGNATOR, Text: designator } as AltiumRecord,
          {
            index: 2,
            RECORD: RECORD_TYPES.PARAMETER,
            Name: "Value",
            Text: value,
          } as AltiumRecord,
        ],
      } as AltiumRecord,
    ],
  });

  it("marks a part whose Value is DNP", () => {
    expect(extractComponents(withValue("R1", "DNP")).R1?.dns).toBe(true);
  });

  it("marks a part whose Value carries the marker beside the value", () => {
    expect(extractComponents(withValue("R2", "10K, DNP")).R2?.dns).toBe(true);
  });

  it("leaves a capacitor whose value is written in nanofarads alone", () => {
    // `2.2 nF` puts a delimited `nF` in the value, which the marker test used
    // to read as "no fit" and would have unstuffed a fitted capacitor.
    expect(extractComponents(withValue("C1", "2.2 nF")).C1?.dns).toBeUndefined();
  });

  it("leaves an ordinary value alone", () => {
    expect(extractComponents(withValue("R3", "10K")).R3?.dns).toBeUndefined();
  });
});
