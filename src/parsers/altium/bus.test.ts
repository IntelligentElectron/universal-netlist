import { describe, it, expect } from "vitest";
import { isBusIdentifier } from "./bus.js";
import { extractNets } from "./net-extractor.js";
import { buildHierarchy } from "./records.js";
import { RECORD_TYPES } from "./types.js";
import type { AltiumRecord, AltiumSchematic, AltiumNet } from "./types.js";

describe("isBusIdentifier", () => {
  it("recognises range identifiers by record type", () => {
    expect(isBusIdentifier({ index: 0, RECORD: RECORD_TYPES.PORT, Name: "D[0..7]" })).toBe(true);
    expect(isBusIdentifier({ index: 0, RECORD: RECORD_TYPES.NET_LABEL, Text: "D[0..7]" })).toBe(
      false
    );
    expect(isBusIdentifier({ index: 0, RECORD: RECORD_TYPES.PORT, Name: "D0" })).toBe(false);
  });
});

/**
 * A sheet drawn on the 10-unit grid, in schematic units:
 *
 *   port D[0..1] at (100,100) meets a bus running down to (100,200);
 *   a bus entry leaves it at (100,150) for (110,160), where a wire labelled
 *   D1 runs to a pin at (200,160). D0 is on the bus but no wire is labelled
 *   with it.
 *
 *   A second bus, labelled X[1..2] like a third one beside a sheet symbol,
 *   carries X2 to the symbol's Repeat(X) entry through a wire.
 *
 *   The options rename those two bus labels and the member wire, add a second
 *   range label to the bus beside the symbol, or draw a labelled wire that
 *   touches no bus at all.
 */
interface SheetOptions {
  busLabel?: string;
  member?: string;
  extraLabel?: string;
  detached?: string;
}

const sheet = ({
  busLabel = "X[1..2]",
  member = "X2",
  extraLabel,
  detached,
}: SheetOptions = {}): AltiumSchematic => {
  let index = 0;
  const record = (fields: Record<string, unknown>): AltiumRecord =>
    ({ index: index++, ...fields }) as AltiumRecord;
  const part = record({ RECORD: RECORD_TYPES.COMPONENT });
  const designator = record({ RECORD: RECORD_TYPES.DESIGNATOR, Text: "U1", OwnerIndex: "0" });
  const pin = record({
    RECORD: RECORD_TYPES.PIN,
    Designator: "1",
    OwnerIndex: "0",
    "Location.X": "200",
    "Location.Y": "160",
    PinLength: "10",
    PinConglomerate: "0",
  });
  const port = record({
    RECORD: RECORD_TYPES.PORT,
    Name: "D[0..1]",
    "Location.X": "60",
    "Location.Y": "100",
    Width: "40",
  });
  const bus = record({
    RECORD: RECORD_TYPES.BUS,
    LocationCount: "2",
    X1: "100",
    Y1: "100",
    X2: "100",
    Y2: "200",
  });
  const busEntry = record({
    RECORD: RECORD_TYPES.BUS_ENTRY,
    "Location.X": "100",
    "Location.Y": "150",
    "Corner.X": "110",
    "Corner.Y": "160",
  });
  const wire = record({
    RECORD: RECORD_TYPES.WIRE,
    LocationCount: "2",
    X1: "110",
    Y1: "160",
    X2: "200",
    Y2: "160",
  });
  const label = record({
    RECORD: RECORD_TYPES.NET_LABEL,
    Text: "D1",
    "Location.X": "150",
    "Location.Y": "160",
  });

  const symbol = record({
    RECORD: RECORD_TYPES.SHEET_SYMBOL,
    "Location.X": "500",
    "Location.Y": "500",
    XSize: "100",
    YSize: "100",
  });
  const symbolIndex = symbol.index;
  const fileName = record({
    RECORD: RECORD_TYPES.SHEET_FILE_NAME,
    Text: "channel.SchDoc",
    OwnerIndex: String(symbolIndex),
  });
  const repeatEntry = record({
    RECORD: RECORD_TYPES.SHEET_ENTRY,
    Name: "Repeat(X)",
    DistanceFromTop: "2",
    OwnerIndex: String(symbolIndex),
  });
  // The entry sits at (500, 480); a wire reaches it from a bus entry.
  const busA = record({
    RECORD: RECORD_TYPES.BUS,
    LocationCount: "2",
    X1: "400",
    Y1: "470",
    X2: "300",
    Y2: "470",
  });
  const busAEntry = record({
    RECORD: RECORD_TYPES.BUS_ENTRY,
    "Location.X": "400",
    "Location.Y": "470",
    "Corner.X": "410",
    "Corner.Y": "480",
  });
  const entryWire = record({
    RECORD: RECORD_TYPES.WIRE,
    LocationCount: "2",
    X1: "410",
    Y1: "480",
    X2: "500",
    Y2: "480",
  });
  const busALabel = record({
    RECORD: RECORD_TYPES.NET_LABEL,
    Text: busLabel,
    "Location.X": "350",
    "Location.Y": "470",
  });
  // A separate bus carrying the same label, with the labelled member wire.
  const busB = record({
    RECORD: RECORD_TYPES.BUS,
    LocationCount: "2",
    X1: "100",
    Y1: "800",
    X2: "200",
    Y2: "800",
  });
  const busBLabel = record({
    RECORD: RECORD_TYPES.NET_LABEL,
    Text: busLabel,
    "Location.X": "150",
    "Location.Y": "800",
  });
  const busBEntry = record({
    RECORD: RECORD_TYPES.BUS_ENTRY,
    "Location.X": "200",
    "Location.Y": "800",
    "Corner.X": "210",
    "Corner.Y": "810",
  });
  const memberWire = record({
    RECORD: RECORD_TYPES.WIRE,
    LocationCount: "2",
    X1: "210",
    Y1: "810",
    X2: "300",
    Y2: "810",
  });
  const memberLabel = record({
    RECORD: RECORD_TYPES.NET_LABEL,
    Text: member,
    "Location.X": "250",
    "Location.Y": "810",
  });

  const extras: AltiumRecord[] = [];
  if (extraLabel) {
    extras.push(
      record({
        RECORD: RECORD_TYPES.NET_LABEL,
        Text: extraLabel,
        "Location.X": "320",
        "Location.Y": "470",
      })
    );
  }
  if (detached) {
    extras.push(
      record({
        RECORD: RECORD_TYPES.WIRE,
        LocationCount: "2",
        X1: "100",
        Y1: "900",
        X2: "200",
        Y2: "900",
      })
    );
    extras.push(
      record({
        RECORD: RECORD_TYPES.NET_LABEL,
        Text: detached,
        "Location.X": "150",
        "Location.Y": "900",
      })
    );
  }

  return buildHierarchy({
    header: [],
    records: [
      part,
      designator,
      pin,
      port,
      bus,
      busEntry,
      wire,
      label,
      symbol,
      fileName,
      repeatEntry,
      busA,
      busAEntry,
      entryWire,
      busALabel,
      busB,
      busBLabel,
      busBEntry,
      memberWire,
      memberLabel,
      ...extras,
    ],
  });
};

const netNamed = (nets: AltiumNet[], name: string): AltiumNet | undefined =>
  nets.find((net) => net.name === name);

describe("attachBusMembers", () => {
  it("attaches a labelled wire on the bus to the range port it reaches", () => {
    const nets = extractNets(sheet());
    const d1 = netNamed(nets, "D1")!;
    expect(d1.busCarriers).toHaveLength(1);
    expect(d1.busCarriers![0].member).toBe("D1");
    expect(d1.busCarriers![0].device.Name).toBe("D[0..1]");
  });

  it("returns a pinless net for a member no wire labels", () => {
    const nets = extractNets(sheet());
    const d0 = nets.find((net) => net.busCarriers?.some((c) => c.member === "D0"))!;
    expect(d0.name).toBeNull();
    expect(d0.devices).toEqual([]);
    expect(d0.busCarriers![0].device.Name).toBe("D[0..1]");
  });

  it("joins buses that carry one label and reaches a Repeat() entry through its wire", () => {
    const nets = extractNets(sheet());
    const x2 = netNamed(nets, "X2")!;
    expect(x2.busCarriers).toHaveLength(1);
    expect(x2.busCarriers![0].device.Name).toBe("Repeat(X)");
    expect(x2.busCarriers![0].member).toBe("X2");
  });

  it("leaves a net that never reaches a bus alone", () => {
    const nets = extractNets(sheet());
    expect(nets.filter((net) => net.busCarriers && net.name !== "D1" && net.name !== "X2")).toEqual(
      [expect.objectContaining({ name: null })]
    );
  });

  it("hands a Repeat() entry the members of a bus called something else, by index", () => {
    // FMC-DIO wires IN1_P[32..1] into Repeat(IN_P); the board joins IN1_P8 to channel 8.
    const nets = extractNets(sheet({ busLabel: "IN1_P[2..1]", member: "IN1_P2" }));
    const member = netNamed(nets, "IN1_P2")!;
    expect(member.busCarriers).toEqual([expect.objectContaining({ member: "IN1_P2", channel: 2 })]);
    expect(member.busCarriers![0].device.Name).toBe("Repeat(X)");
  });

  it("reads the channel after the prefix, not the trailing digits of the member", () => {
    // A bus called X1[1..2] carries X11 and X12; X12 is channel 2, not 12.
    const nets = extractNets(sheet({ busLabel: "X1[1..2]", member: "X12" }));
    expect(netNamed(nets, "X12")!.busCarriers).toEqual([
      expect.objectContaining({ member: "X12", channel: 2 }),
    ]);
  });

  it("matches bus labels, ranges and members ignoring case", () => {
    const nets = extractNets(sheet({ busLabel: "in1_p[2..1]", member: "IN1_P2" }));
    expect(netNamed(nets, "IN1_P2")!.busCarriers).toEqual([
      expect.objectContaining({ member: "IN1_P2", channel: 2 }),
    ]);
  });

  it("keeps a Repeat() entry to its own name when the run carries two ranges", () => {
    const nets = extractNets(
      sheet({ busLabel: "IN1_P[2..1]", member: "IN1_P2", extraLabel: "IN1_N[2..1]" })
    );
    expect(netNamed(nets, "IN1_P2")!.busCarriers).toBeUndefined();
    expect(netNamed(nets, "X2")).toBeUndefined();
  });

  it("carries a member labelled away from the bus, the label naming it anywhere on the sheet", () => {
    const nets = extractNets(sheet({ detached: "X1" }));
    const x1 = netNamed(nets, "X1")!;
    expect(x1.devices.map((device) => device.RECORD)).toEqual([
      RECORD_TYPES.WIRE,
      RECORD_TYPES.NET_LABEL,
    ]);
    expect(x1.busCarriers).toEqual([expect.objectContaining({ member: "X1", channel: 1 })]);
  });
});

describe("Repeat() entries on a labelled wire", () => {
  /** A `Repeat(CH,1,2)` symbol whose entry `Repeat(VIN)` meets a wire labelled `vbat`, and a net `VBAT1`. */
  const repeatWireSheet = (): AltiumSchematic => {
    let index = 0;
    const record = (fields: Record<string, unknown>): AltiumRecord =>
      ({ index: index++, ...fields }) as AltiumRecord;
    const symbol = record({
      RECORD: RECORD_TYPES.SHEET_SYMBOL,
      "Location.X": "500",
      "Location.Y": "500",
      XSize: "100",
      YSize: "100",
    });
    const owner = String(symbol.index);
    return buildHierarchy({
      header: [],
      records: [
        symbol,
        record({ RECORD: RECORD_TYPES.SHEET_NAME, Text: "Repeat(CH,1,2)", OwnerIndex: owner }),
        record({ RECORD: RECORD_TYPES.SHEET_FILE_NAME, Text: "ch.SchDoc", OwnerIndex: owner }),
        record({
          RECORD: RECORD_TYPES.SHEET_ENTRY,
          Name: "Repeat(VIN)",
          DistanceFromTop: "2",
          OwnerIndex: owner,
        }),
        record({
          RECORD: RECORD_TYPES.WIRE,
          LocationCount: "2",
          X1: "400",
          Y1: "480",
          X2: "500",
          Y2: "480",
        }),
        record({
          RECORD: RECORD_TYPES.NET_LABEL,
          Text: "vbat",
          "Location.X": "450",
          "Location.Y": "480",
        }),
        record({
          RECORD: RECORD_TYPES.WIRE,
          LocationCount: "2",
          X1: "100",
          Y1: "900",
          X2: "200",
          Y2: "900",
        }),
        record({
          RECORD: RECORD_TYPES.NET_LABEL,
          Text: "VBAT1",
          "Location.X": "150",
          "Location.Y": "900",
        }),
      ],
    });
  };

  it("hands channel n the sheet's net named after the wire's label and n", () => {
    const nets = extractNets(repeatWireSheet());

    expect(netNamed(nets, "VBAT1")!.busCarriers).toEqual([
      expect.objectContaining({ member: "vbat1", channel: 1 }),
    ]);
    const pinless = nets.filter((net) => net.name === null);
    expect(pinless.map((net) => net.busCarriers)).toEqual([
      [expect.objectContaining({ member: "vbat2", channel: 2 })],
    ]);
  });
});
