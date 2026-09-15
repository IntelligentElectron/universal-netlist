/**
 * Altium Net Extractor Tests
 *
 * Tests the core algorithm for extracting nets from Altium schematics.
 */

import { describe, it, expect } from "vitest";
import { extractNets } from "./net-extractor.js";
import { RECORD_TYPES } from "./types.js";
import type { AltiumRecord, AltiumSchematic, AltiumNet } from "./types.js";
import { COORDINATE_SCALE } from "./coordinates.js";

function scale(value: number): number {
  return value * COORDINATE_SCALE;
}

function scalePoint(x: number, y: number): [number, number] {
  return [scale(x), scale(y)];
}

describe("extractNets", () => {
  it("should extract a simple net from connected wire and pin", () => {
    const schematic: AltiumSchematic = {
      header: [],
      records: [
        {
          index: 0,
          RECORD: RECORD_TYPES.COMPONENT,
          children: [
            {
              index: 1,
              RECORD: RECORD_TYPES.PIN,
              Designator: "1",
              "Location.X": "100",
              "Location.Y": "0",
              PinLength: "0",
              PinConglomerate: "0",
            } as AltiumRecord,
            {
              index: 2,
              RECORD: RECORD_TYPES.DESIGNATOR,
              Text: "U1",
            } as AltiumRecord,
          ],
        } as AltiumRecord,
        {
          index: 3,
          RECORD: RECORD_TYPES.WIRE,
          LocationCount: "2",
          X1: "100",
          Y1: "0",
          X2: "200",
          Y2: "0",
        } as AltiumRecord,
      ],
    };

    const nets = extractNets(schematic);
    expect(nets.length).toBeGreaterThan(0);
  });

  it("should assign net name from power port", () => {
    const schematic: AltiumSchematic = {
      header: [],
      records: [
        {
          index: 0,
          RECORD: RECORD_TYPES.POWER_PORT,
          Text: "VCC",
          "Location.X": "100",
          "Location.Y": "100",
        } as AltiumRecord,
        {
          index: 1,
          RECORD: RECORD_TYPES.WIRE,
          LocationCount: "2",
          X1: "100",
          Y1: "100",
          X2: "200",
          Y2: "100",
        } as AltiumRecord,
      ],
    };

    const nets = extractNets(schematic);
    const vccNet = nets.find((n) => n.name === "VCC");
    expect(vccNet).toBeDefined();
    expect(vccNet!.devices.length).toBe(2);
  });

  it("should ignore pins that do not match the current part", () => {
    const schematic: AltiumSchematic = {
      header: [],
      records: [
        {
          index: 0,
          RECORD: RECORD_TYPES.COMPONENT,
          CURRENTPARTID: "1",
          children: [
            {
              index: 1,
              RECORD: RECORD_TYPES.PIN,
              Designator: "1",
              OwnerIndex: "0",
              OWNERPARTID: "2", // Different part ID - should be ignored
              "Location.X": "0",
              "Location.Y": "0",
              PinLength: "0",
              PinConglomerate: "0",
            } as AltiumRecord,
            {
              index: 2,
              RECORD: RECORD_TYPES.DESIGNATOR,
              Text: "U1",
            } as AltiumRecord,
          ],
        } as AltiumRecord,
        {
          index: 3,
          RECORD: RECORD_TYPES.WIRE,
          LocationCount: "2",
          X1: "0",
          Y1: "0",
          X2: "100",
          Y2: "0",
        } as AltiumRecord,
      ],
    };

    const nets = extractNets(schematic);
    const hasPin = nets.some((net) =>
      net.devices.some((device) => device.RECORD === RECORD_TYPES.PIN)
    );
    expect(hasPin).toBe(false);
  });

  it("should handle disconnected devices as separate nets", () => {
    const schematic: AltiumSchematic = {
      header: [],
      records: [
        {
          index: 0,
          RECORD: RECORD_TYPES.WIRE,
          LocationCount: "2",
          X1: "0",
          Y1: "0",
          X2: "100",
          Y2: "0",
        } as AltiumRecord,
        {
          index: 1,
          RECORD: RECORD_TYPES.WIRE,
          LocationCount: "2",
          X1: "1000",
          Y1: "1000",
          X2: "1100",
          Y2: "1000",
        } as AltiumRecord,
      ],
    };

    const nets = extractNets(schematic);
    expect(nets.length).toBe(2);
  });

  it("should chain connected wires into single net", () => {
    const schematic: AltiumSchematic = {
      header: [],
      records: [
        {
          index: 0,
          RECORD: RECORD_TYPES.WIRE,
          LocationCount: "2",
          X1: "0",
          Y1: "0",
          X2: "100",
          Y2: "0",
        } as AltiumRecord,
        {
          index: 1,
          RECORD: RECORD_TYPES.WIRE,
          LocationCount: "2",
          X1: "100",
          Y1: "0",
          X2: "200",
          Y2: "0",
        } as AltiumRecord,
        {
          index: 2,
          RECORD: RECORD_TYPES.WIRE,
          LocationCount: "2",
          X1: "200",
          Y1: "0",
          X2: "300",
          Y2: "0",
        } as AltiumRecord,
      ],
    };

    const nets = extractNets(schematic);
    expect(nets.length).toBe(1);
    expect(nets[0].devices.length).toBe(3);
  });

  it("should connect power ports with same Text globally", () => {
    const schematic: AltiumSchematic = {
      header: [],
      records: [
        {
          index: 0,
          RECORD: RECORD_TYPES.POWER_PORT,
          Text: "GND",
          "Location.X": "0",
          "Location.Y": "0",
        } as AltiumRecord,
        {
          index: 1,
          RECORD: RECORD_TYPES.POWER_PORT,
          Text: "GND",
          "Location.X": "10000",
          "Location.Y": "10000",
        } as AltiumRecord,
      ],
    };

    const nets = extractNets(schematic);
    const gndNet = nets.find((n) => n.name === "GND");
    expect(gndNet).toBeDefined();
    expect(gndNet!.devices.length).toBe(2);
  });

  it("should handle empty schematic", () => {
    const schematic: AltiumSchematic = {
      header: [],
      records: [],
    };

    const nets = extractNets(schematic);
    expect(nets).toEqual([]);
  });
});

describe("Pin coordinate calculation", () => {
  it("should calculate pin endpoint at 0 degrees rotation", () => {
    const schematic: AltiumSchematic = {
      header: [],
      records: [
        {
          index: 0,
          RECORD: RECORD_TYPES.PIN,
          "Location.X": "100",
          "Location.Y": "100",
          PinLength: "200",
          PinConglomerate: "0", // 0 * 90 = 0 degrees
        } as AltiumRecord,
      ],
    };

    const nets = extractNets(schematic);
    // Pin endpoint at (300, 100) = (100 + 200*cos(0), 100 + 200*sin(0))
    expect(nets[0].devices[0].coords).toEqual([scalePoint(100, 100), scalePoint(300, 100)]);
  });

  it("should calculate pin endpoint at 90 degrees rotation", () => {
    const schematic: AltiumSchematic = {
      header: [],
      records: [
        {
          index: 0,
          RECORD: RECORD_TYPES.PIN,
          "Location.X": "100",
          "Location.Y": "100",
          PinLength: "200",
          PinConglomerate: "1", // 1 * 90 = 90 degrees
        } as AltiumRecord,
      ],
    };

    const nets = extractNets(schematic);
    // Pin endpoint at (100, 300) = (100 + 200*cos(90), 100 + 200*sin(90))
    expect(nets[0].devices[0].coords).toEqual([scalePoint(100, 100), scalePoint(100, 300)]);
  });

  it("should handle fractional coordinates", () => {
    const schematic: AltiumSchematic = {
      header: [],
      records: [
        {
          index: 0,
          RECORD: RECORD_TYPES.PIN,
          "Location.X": "1",
          "Location.X_Frac": "2500",
          "Location.Y": "0",
          "Location.Y_Frac": "0",
          PinLength: "1",
          PinLength_Frac: "2500",
          PinConglomerate: "0",
        } as AltiumRecord,
        {
          index: 1,
          RECORD: RECORD_TYPES.WIRE,
          LocationCount: "2",
          X1: "2",
          X1_Frac: "5000",
          Y1: "0",
          Y1_Frac: "0",
          X2: "3",
          X2_Frac: "0",
          Y2: "0",
          Y2_Frac: "0",
        } as AltiumRecord,
      ],
    };

    const nets = extractNets(schematic);
    expect(nets.length).toBe(1);
    expect(nets[0].devices.length).toBe(2);
  });
});

describe("Overbar escapes", () => {
  it("keeps a fully overbarred net name as written", () => {
    const schematic: AltiumSchematic = {
      header: [],
      records: [
        {
          index: 0,
          RECORD: RECORD_TYPES.NET_LABEL,
          Text: "\\I\\F\\_\\O\\F\\F",
          "Location.X": "0",
          "Location.Y": "0",
        } as AltiumRecord,
        {
          index: 1,
          RECORD: RECORD_TYPES.WIRE,
          LocationCount: "2",
          X1: "0",
          Y1: "0",
          X2: "100",
          Y2: "0",
        } as AltiumRecord,
      ],
    };

    const nets = extractNets(schematic);
    expect(nets.find((n) => n.name === "\\I\\F\\_\\O\\F\\F")).toBeDefined();
  });

  it("keeps an overbarred power port name as written", () => {
    const schematic: AltiumSchematic = {
      header: [],
      records: [
        {
          index: 0,
          RECORD: RECORD_TYPES.POWER_PORT,
          Text: "\\V\\C\\C",
          "Location.X": "0",
          "Location.Y": "0",
        } as AltiumRecord,
      ],
    };

    const nets = extractNets(schematic);
    expect(nets.find((n) => n.name === "\\V\\C\\C")).toBeDefined();
  });

  it("should not alter names without backslashes", () => {
    const schematic: AltiumSchematic = {
      header: [],
      records: [
        {
          index: 0,
          RECORD: RECORD_TYPES.NET_LABEL,
          Text: "DATA_BUS",
          "Location.X": "0",
          "Location.Y": "0",
        } as AltiumRecord,
        {
          index: 1,
          RECORD: RECORD_TYPES.WIRE,
          LocationCount: "2",
          X1: "0",
          Y1: "0",
          X2: "100",
          Y2: "0",
        } as AltiumRecord,
      ],
    };

    const nets = extractNets(schematic);
    expect(nets.find((n) => n.name === "DATA_BUS")).toBeDefined();
  });

  it("keeps a partially overbarred name as written", () => {
    const schematic: AltiumSchematic = {
      header: [],
      records: [
        {
          index: 0,
          RECORD: RECORD_TYPES.NET_LABEL,
          Text: "SPI_\\C\\L\\K",
          "Location.X": "0",
          "Location.Y": "0",
        } as AltiumRecord,
        {
          index: 1,
          RECORD: RECORD_TYPES.WIRE,
          LocationCount: "2",
          X1: "0",
          Y1: "0",
          X2: "100",
          Y2: "0",
        } as AltiumRecord,
      ],
    };

    const nets = extractNets(schematic);
    expect(nets.find((n) => n.name === "SPI_\\C\\L\\K")).toBeDefined();
  });
});

describe("Net naming", () => {
  it("should name net from net label", () => {
    const schematic: AltiumSchematic = {
      header: [],
      records: [
        {
          index: 0,
          RECORD: RECORD_TYPES.NET_LABEL,
          Text: "DATA_BUS",
          "Location.X": "500",
          "Location.Y": "500",
        } as AltiumRecord,
        {
          index: 1,
          RECORD: RECORD_TYPES.WIRE,
          LocationCount: "2",
          X1: "500",
          Y1: "500",
          X2: "600",
          Y2: "500",
        } as AltiumRecord,
      ],
    };

    const nets = extractNets(schematic);
    const dataBusNet = nets.find((n) => n.name === "DATA_BUS");
    expect(dataBusNet).toBeDefined();
  });

  it("should leave name null when no naming source", () => {
    const schematic: AltiumSchematic = {
      header: [],
      records: [
        {
          index: 0,
          RECORD: RECORD_TYPES.WIRE,
          LocationCount: "2",
          X1: "0",
          Y1: "0",
          X2: "100",
          Y2: "0",
        } as AltiumRecord,
      ],
    };

    const nets = extractNets(schematic);
    expect(nets[0].name).toBeNull();
  });
});

describe("signal harnesses", () => {
  /**
   * Two components joined through a harness, with a
   * different net label on the wire at each end.
   *
   *   U1.1 --[FROM_U1]-- (entry SIG) [connector] ==harness== [connector] (entry SIG) --[TO_U2]-- U2.1
   */
  const harnessJoinedComponents = (leftLabel: string, rightLabel: string): AltiumSchematic => {
    const component = (index: number, refdes: string, x: number): AltiumRecord =>
      ({
        index,
        RECORD: RECORD_TYPES.COMPONENT,
        children: [
          {
            index: index + 1,
            RECORD: RECORD_TYPES.PIN,
            Designator: "1",
            "Location.X": String(x),
            "Location.Y": "100",
            PinLength: "0",
            PinConglomerate: "0",
          } as AltiumRecord,
          { index: index + 2, RECORD: RECORD_TYPES.DESIGNATOR, Text: refdes } as AltiumRecord,
        ],
      }) as AltiumRecord;

    return {
      header: [],
      records: [
        component(0, "U1", 100),
        component(3, "U2", 500),
        // U1's wire runs into the left connector's entry at x = 200.
        {
          index: 6,
          RECORD: RECORD_TYPES.WIRE,
          LocationCount: "2",
          X1: "100",
          Y1: "100",
          X2: "200",
          Y2: "100",
        },
        {
          index: 7,
          RECORD: RECORD_TYPES.NET_LABEL,
          Text: leftLabel,
          "Location.X": "150",
          "Location.Y": "100",
        },
        // U2's wire runs into the right connector's entry at x = 400.
        {
          index: 8,
          RECORD: RECORD_TYPES.WIRE,
          LocationCount: "2",
          X1: "400",
          Y1: "100",
          X2: "500",
          Y2: "100",
        },
        {
          index: 9,
          RECORD: RECORD_TYPES.NET_LABEL,
          Text: rightLabel,
          "Location.X": "450",
          "Location.Y": "100",
        },
        // Both entries carry the same signal of the same bundle, as
        // assignHarnessSignals would have marked them.
        {
          index: 10,
          RECORD: RECORD_TYPES.HARNESS_ENTRY,
          Name: "SIG",
          "Location.X": "200",
          "Location.Y": "100",
          harnessSignal: "BUNDLE.SIG",
        },
        {
          index: 11,
          RECORD: RECORD_TYPES.HARNESS_ENTRY,
          Name: "SIG",
          "Location.X": "400",
          "Location.Y": "100",
          harnessSignal: "BUNDLE.SIG",
        },
      ] as AltiumRecord[],
    };
  };

  const refdesOf = (schematic: AltiumSchematic, net: { devices: AltiumRecord[] }): string[] =>
    net.devices
      .filter((device) => device.RECORD === RECORD_TYPES.PIN)
      .map((pin) => {
        const owner = schematic.records.find((record) =>
          record.children?.some((child) => child.index === pin.index)
        );
        const designator = owner?.children?.find((c) => c.RECORD === RECORD_TYPES.DESIGNATOR);
        return String(designator?.Text);
      })
      .sort();

  it("joins the two ends of a harness whose wires are labelled differently", () => {
    const schematic = harnessJoinedComponents("FROM_U1", "TO_U2");

    const joined = extractNets(schematic).filter((net) => refdesOf(schematic, net).length === 2);

    expect(joined).toHaveLength(1);
    expect(refdesOf(schematic, joined[0])).toEqual(["U1", "U2"]);
  });

  it("names such a net from a wire label, never from the harness entry", () => {
    // A harness entry names a member of a bundle, not the net, so "SIG" must not
    // become a net name: it is only unique within its own harness.
    const schematic = harnessJoinedComponents("FROM_U1", "TO_U2");

    const names = extractNets(schematic).map((net) => net.name);

    expect(names).toContain("FROM_U1");
    expect(names).not.toContain("SIG");
  });

  it("skips a harness entry that was never positioned", () => {
    // Two unpositioned entries would otherwise both sit at the origin and look
    // like one point, wiring unrelated nets together.
    const schematic = harnessJoinedComponents("FROM_U1", "TO_U2");
    for (const record of schematic.records) {
      if (record.RECORD !== RECORD_TYPES.HARNESS_ENTRY) continue;
      delete record["Location.X"];
      delete record["Location.Y"];
    }

    const nets = extractNets(schematic);

    expect(nets.every((net) => refdesOf(schematic, net).length <= 1)).toBe(true);
    expect(
      nets.some((net) => net.devices.some((d) => d.RECORD === RECORD_TYPES.HARNESS_ENTRY))
    ).toBe(false);
  });
});

/** A one-pin component, so a net has a pin to be named after. */
const partWithPin = (
  index: number,
  refdes: string,
  pin: string,
  x: number,
  y: number
): AltiumRecord =>
  ({
    index,
    RECORD: RECORD_TYPES.COMPONENT,
    children: [
      {
        index: index + 1,
        RECORD: RECORD_TYPES.PIN,
        OwnerIndex: String(index),
        Designator: pin,
        "Location.X": String(x),
        "Location.Y": String(y),
        PinLength: "0",
        PinConglomerate: "0",
      } as AltiumRecord,
      { index: index + 2, RECORD: RECORD_TYPES.DESIGNATOR, Text: refdes } as AltiumRecord,
    ],
  }) as AltiumRecord;

const wire = (index: number, x1: number, y1: number, x2: number, y2: number): AltiumRecord =>
  ({
    index,
    RECORD: RECORD_TYPES.WIRE,
    LocationCount: "2",
    X1: String(x1),
    Y1: String(y1),
    X2: String(x2),
    Y2: String(y2),
  }) as AltiumRecord;

const netOf = (nets: AltiumNet[], refdes: string): AltiumNet | undefined =>
  nets.find((net) =>
    net.devices.some(
      (device) => device.RECORD === RECORD_TYPES.DESIGNATOR && device.Text === refdes
    )
  ) ??
  nets.find((net) =>
    net.devices.some((device) => device.RECORD === RECORD_TYPES.PIN && device.Designator === "1")
  );

describe("Port geometry", () => {
  const schematicWithPort = (port: Partial<AltiumRecord>, wireEndX: number): AltiumSchematic => ({
    header: [],
    records: [
      partWithPin(0, "U1", "1", 100, 0),
      wire(3, 100, 0, wireEndX, 0),
      {
        index: 4,
        RECORD: RECORD_TYPES.PORT,
        Name: "CLK",
        "Location.X": "200",
        "Location.Y": "0",
        Width: "60",
        ...port,
      } as AltiumRecord,
    ],
  });

  it("joins a wire landing on the port's location", () => {
    const nets = extractNets(schematicWithPort({}, 200));
    expect(netOf(nets, "U1")?.name).toBe("CLK");
  });

  it("joins a wire landing on the far end of the port's bar", () => {
    const nets = extractNets(schematicWithPort({}, 260));
    expect(netOf(nets, "U1")?.name).toBe("CLK");
  });

  it("extends a vertical port upward", () => {
    const schematic: AltiumSchematic = {
      header: [],
      records: [
        partWithPin(0, "U1", "1", 200, 100),
        wire(3, 200, 100, 200, 60),
        {
          index: 4,
          RECORD: RECORD_TYPES.PORT,
          Name: "CLK",
          "Location.X": "200",
          "Location.Y": "0",
          Width: "60",
          Style: "4",
        } as AltiumRecord,
      ],
    };
    expect(netOf(extractNets(schematic), "U1")?.name).toBe("CLK");
  });

  it("leaves a wire that stops short of the port unjoined", () => {
    const nets = extractNets(schematicWithPort({}, 190));
    expect(netOf(nets, "U1")?.name).toBe("NetU1_1");
  });
});

describe("Sheet entry placement", () => {
  const sheetSymbol = (entries: Partial<AltiumRecord>[]): AltiumRecord =>
    ({
      index: 10,
      RECORD: RECORD_TYPES.SHEET_SYMBOL,
      "Location.X": "500",
      "Location.Y": "400",
      XSize: "120",
      YSize: "80",
      children: entries.map(
        (entry, offset) =>
          ({
            index: 11 + offset,
            RECORD: RECORD_TYPES.SHEET_ENTRY,
            OwnerIndex: "10",
            ...entry,
          }) as AltiumRecord
      ),
    }) as AltiumRecord;

  const schematicWith = (entries: Partial<AltiumRecord>[], ...wires: AltiumRecord[]) => ({
    header: [],
    records: [partWithPin(0, "U1", "1", 100, 100), ...wires, sheetSymbol(entries)],
  });

  /** Whether U1's net reaches a sheet entry. */
  const reachesEntry = (nets: AltiumNet[]): boolean =>
    netOf(nets, "U1")?.devices.some((device) => device.RECORD === RECORD_TYPES.SHEET_ENTRY) ??
    false;

  it("places a left-edge entry DistanceFromTop steps below the symbol's top-left corner", () => {
    const nets = extractNets(
      schematicWith([{ Name: "EN", DistanceFromTop: "3" }], wire(3, 100, 100, 500, 370))
    );
    expect(reachesEntry(nets)).toBe(true);
  });

  it("places a right-edge entry on the symbol's right edge", () => {
    const nets = extractNets(
      schematicWith([{ Name: "EN", Side: "1", DistanceFromTop: "3" }], wire(3, 100, 100, 620, 370))
    );
    expect(reachesEntry(nets)).toBe(true);
  });

  it("reads DistanceFromTop_Frac1 as millionths of a step", () => {
    const nets = extractNets(
      schematicWith(
        [{ Name: "EN", DistanceFromTop: "3", DistanceFromTop_Frac1: "500000" }],
        wire(3, 100, 100, 500, 365)
      )
    );
    expect(reachesEntry(nets)).toBe(true);
  });

  it("places top and bottom edge entries DistanceFromTop steps to the right", () => {
    const top = extractNets(
      schematicWith([{ Name: "EN", Side: "2", DistanceFromTop: "3" }], wire(3, 100, 100, 530, 400))
    );
    expect(reachesEntry(top)).toBe(true);
    const bottom = extractNets(
      schematicWith([{ Name: "EN", Side: "3", DistanceFromTop: "3" }], wire(3, 100, 100, 530, 320))
    );
    expect(reachesEntry(bottom)).toBe(true);
  });

  it("leaves a harness-typed entry and a bus-notation entry to their own handling", () => {
    const nets = extractNets(
      schematicWith(
        [
          { Name: "AD[0..7]", DistanceFromTop: "3" },
          { Name: "SPI", HarnessType: "SPI", DistanceFromTop: "4" },
        ],
        wire(3, 100, 100, 500, 370),
        wire(4, 100, 100, 500, 360)
      )
    );
    expect(netOf(nets, "U1")?.name).toBe("NetU1_1");
  });

  it("names a net after its port, never after its sheet entry", () => {
    const nets = extractNets({
      header: [],
      records: [
        partWithPin(0, "U1", "1", 100, 100),
        wire(3, 100, 100, 300, 100),
        wire(5, 300, 100, 500, 370),
        {
          index: 4,
          RECORD: RECORD_TYPES.PORT,
          Name: "FROM_PORT",
          "Location.X": "300",
          "Location.Y": "100",
          Width: "60",
        } as AltiumRecord,
        sheetSymbol([{ Name: "FROM_ENTRY", DistanceFromTop: "3" }]),
      ],
    });
    expect(netOf(nets, "U1")?.name).toBe("FROM_PORT");
  });
});

describe("Net naming options", () => {
  const schematic = (): AltiumSchematic => ({
    header: [],
    records: [
      partWithPin(0, "U1", "1", 100, 0),
      wire(3, 100, 0, 200, 0),
      {
        index: 4,
        RECORD: RECORD_TYPES.PORT,
        Name: "CLK",
        "Location.X": "200",
        "Location.Y": "0",
        Width: "60",
      } as AltiumRecord,
    ],
  });

  it("names a net after its label rather than its power port unless the project says otherwise", () => {
    const labelled = (): AltiumSchematic => ({
      header: [],
      records: [
        partWithPin(0, "U1", "1", 100, 0),
        wire(3, 100, 0, 200, 0),
        {
          index: 4,
          RECORD: RECORD_TYPES.POWER_PORT,
          Text: "+5V",
          "Location.X": "200",
          "Location.Y": "0",
        } as AltiumRecord,
        {
          index: 5,
          RECORD: RECORD_TYPES.NET_LABEL,
          Text: "VCC_5V",
          "Location.X": "150",
          "Location.Y": "0",
        } as AltiumRecord,
      ],
    });
    const byLabel = netOf(
      extractNets(labelled(), {
        allowPortNetNames: true,
        powerPortNamesTakePriority: false,
      }),
      "U1"
    );
    expect(byLabel?.name).toBe("VCC_5V");
    expect(byLabel?.nameSource).toBe("label");
    const byPower = netOf(
      extractNets(labelled(), {
        allowPortNetNames: true,
        powerPortNamesTakePriority: true,
      }),
      "U1"
    );
    expect(byPower?.name).toBe("+5V");
    expect(byPower?.nameSource).toBe("power");
  });

  it("names a net after its port unless AllowPortNetNames is off", () => {
    expect(netOf(extractNets(schematic()), "U1")?.name).toBe("CLK");
    const nets = extractNets(schematic(), {
      allowPortNetNames: false,
      powerPortNamesTakePriority: true,
    });
    const net = netOf(nets, "U1");
    expect(net?.name).toBe("NetU1_1");
    expect(net?.nameSource).toBe("pin");
  });
});
