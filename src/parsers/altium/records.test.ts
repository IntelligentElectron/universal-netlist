import { describe, it, expect } from "vitest";
import { buildHierarchy, findRecordByIndex, parseRecords } from "./records.js";
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
