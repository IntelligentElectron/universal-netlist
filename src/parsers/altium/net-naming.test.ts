import { describe, it, expect } from "vitest";
import { nameSheetNets } from "./net-naming.js";
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
    nameSheetNets([net], schematic);
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

describe("naming a sheet's nets", () => {
  const label = (index: number, text: string): AltiumRecord =>
    ({ index, RECORD: RECORD_TYPES.NET_LABEL, Text: text }) as AltiumRecord;
  const port = (index: number, name: string): AltiumRecord =>
    ({ index, RECORD: RECORD_TYPES.PORT, Name: name }) as AltiumRecord;
  const entry = (index: number, name: string): AltiumRecord =>
    ({ index, RECORD: RECORD_TYPES.SHEET_ENTRY, Name: name }) as AltiumRecord;

  /** Nets of `devices`, each with pin 1 of every part in `parts`. */
  const sheet = (...nets: { devices: AltiumRecord[]; parts?: string[] }[]) => {
    const records: AltiumRecord[] = [];
    const pins = nets.map(({ parts = [] }) =>
      parts.map((refdes) => {
        const component = records.length;
        records.push(
          { index: component, RECORD: RECORD_TYPES.COMPONENT } as AltiumRecord,
          {
            index: component + 1,
            RECORD: RECORD_TYPES.DESIGNATOR,
            OwnerIndex: String(component),
            Text: refdes,
          },
          {
            index: component + 2,
            RECORD: RECORD_TYPES.PIN,
            OwnerIndex: String(component),
            Designator: "1",
          }
        );
        return records[component + 2];
      })
    );
    const schematic = buildHierarchy({ header: [], records });
    const built = nets.map(
      ({ devices }, i): AltiumNet => ({ name: null, devices: [...devices, ...pins[i]] })
    );
    return { schematic, nets: built };
  };

  it("takes the first name in sort order between two of one rank", () => {
    const { schematic, nets } = sheet({ devices: [label(1, "ZETA"), label(2, "ALPHA")] });
    nameSheetNets(nets, schematic);
    expect(nets[0].name).toBe("ALPHA");
  });

  it("keeps a sheet entry's net apart from a label's net of its name", () => {
    // A sheet entry joins nothing by name, so its net takes its next name, here its pin's.
    const { schematic, nets } = sheet(
      { devices: [label(1, "EN")], parts: ["R1"] },
      { devices: [entry(2, "en")], parts: ["R2"] }
    );
    nameSheetNets(nets, schematic);
    expect(nets.map((net) => net.name)).toEqual(["EN", "NetR2_1"]);
  });

  it("gives the later of two sheet entries named alike its next name", () => {
    const { schematic, nets } = sheet(
      { devices: [entry(1, "SIG")], parts: ["R1"] },
      { devices: [entry(2, "SIG")], parts: ["R2"] }
    );
    nameSheetNets(nets, schematic);
    expect(nets.map((net) => net.name)).toEqual(["SIG", "NetR2_1"]);
  });

  it("settles a name at the rank a refused net falls to", () => {
    // The port name P goes to the label; E then falls to the stronger port, not the entry.
    const { schematic, nets } = sheet(
      { devices: [label(1, "P")], parts: ["R0"] },
      { devices: [port(2, "P"), entry(3, "E")], parts: ["R1"] },
      { devices: [port(4, "E")], parts: ["R2"] }
    );
    nameSheetNets(nets, schematic);
    expect(nets.map((net) => net.name)).toEqual(["P", "NetR1_1", "E"]);
  });

  it("passes over a pin name another net's label holds", () => {
    const { schematic, nets } = sheet(
      { devices: [label(1, "NetR1_1")], parts: ["R0"] },
      { devices: [], parts: ["R1", "R2"] }
    );
    nameSheetNets(nets, schematic);
    expect(nets.map((net) => net.name)).toEqual(["NetR1_1", "NetR2_1"]);
  });

  it("gives a harness member's name and a net label's of the same text to one net only", () => {
    const member = {
      index: 1,
      RECORD: RECORD_TYPES.HARNESS_ENTRY,
      harnessNetName: "USB.DP",
    } as AltiumRecord;
    const { schematic, nets } = sheet(
      { devices: [label(2, "USB.DP")], parts: ["R1"] },
      { devices: [member], parts: ["R2"] }
    );
    nameSheetNets(nets, schematic);
    expect(nets.map((net) => net.name)).toEqual(["NetR1_1", "USB.DP"]);
  });

  it("leaves a net without pins unnamed when the name it claims is taken", () => {
    const { schematic, nets } = sheet(
      { devices: [entry(1, "EN")], parts: ["R1"] },
      { devices: [entry(2, "EN")] }
    );
    nameSheetNets(nets, schematic);
    expect(nets.map((net) => net.name)).toEqual(["EN", null]);
  });

  it("numbers a net whose every name another net holds after its lowest pin", () => {
    const { schematic, nets } = sheet(
      { devices: [label(1, "NetR2_1")], parts: ["R1"] },
      { devices: [entry(2, "NetR2_1")], parts: ["R2"] }
    );
    nameSheetNets(nets, schematic);
    expect(nets.map((net) => net.name)).toEqual(["NetR2_1", "NetR2_1_2"]);
  });
});
