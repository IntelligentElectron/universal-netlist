import { describe, it, expect } from "vitest";
import { assignNetName } from "./net-naming.js";
import { buildHierarchy, flattenHierarchy } from "./records.js";
import { RECORD_TYPES } from "./types.js";
import type { AltiumNet, AltiumRecord, AltiumSchematic } from "./types.js";

describe("naming a net after one of its pins", () => {
  const pin = (refdes: string, number: string, index: number): AltiumRecord[] => [
    { index, RECORD: RECORD_TYPES.COMPONENT, children: [] } as AltiumRecord,
    {
      index: index + 1,
      RECORD: RECORD_TYPES.DESIGNATOR,
      OwnerIndex: String(index),
      Text: refdes,
    } as AltiumRecord,
    {
      index: index + 2,
      RECORD: RECORD_TYPES.PIN,
      OwnerIndex: String(index),
      Designator: number,
    } as AltiumRecord,
  ];

  /** A schematic whose one net holds the given (refdes, pin) pairs. */
  const netOf = (pins: [string, string][]): AltiumSchematic => {
    const records: AltiumRecord[] = [];
    pins.forEach(([refdes, number], i) => records.push(...pin(refdes, number, i * 3)));
    return { header: [], records };
  };

  const nameOf = (pins: [string, string][]): string | null | undefined => {
    const schematic = buildHierarchy(netOf(pins));
    const net: AltiumNet = {
      name: null,
      devices: flattenHierarchy(schematic).filter((r) => r.RECORD === RECORD_TYPES.PIN),
    };
    assignNetName(net, schematic);
    return net.name;
  };

  it("counts the designator's number rather than reading it as text", () => {
    // R9 comes before R11; sorted as text it would not, and the net would be
    // named after R11. Altium calls this net NetR9_2.
    expect(
      nameOf([
        ["R11", "1"],
        ["R9", "2"],
      ])
    ).toBe("NetR9_2");
    expect(
      nameOf([
        ["C10", "2"],
        ["C9", "2"],
      ])
    ).toBe("NetC9_2");
  });

  it("still orders different prefixes alphabetically", () => {
    expect(
      nameOf([
        ["U2", "1"],
        ["C9", "2"],
      ])
    ).toBe("NetC9_2");
  });

  it("breaks a tie on what follows the number", () => {
    expect(
      nameOf([
        ["R5B", "1"],
        ["R5A", "2"],
      ])
    ).toBe("NetR5A_2");
  });

  it("sorts a designator carrying no number ahead of the same prefix numbered", () => {
    expect(
      nameOf([
        ["JP1", "1"],
        ["JP", "2"],
      ])
    ).toBe("NetJP_2");
  });
});
