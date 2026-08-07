import { describe, expect, it } from "vitest";
import {
  parseHarnessDefinitions,
  resolveHarnessMembers,
  collectNestedHarnessTypes,
  readHarnessConnectors,
  assignHarnessSignals,
  harnessSignalKey,
} from "./harness.js";
import type { HarnessRecord } from "./harness.js";

/**
 * The sample definitions are the verbatim contents of
 * `channel.Harness` from pulp-bio/HELIOS-R.
 */
const HELIOS_CHANNEL_HARNESS = [
  "AGND_Domain=PULSE_OUT,PULSE_IN,AGND,VDD5,STDN,TEMPOUT",
  "Channel_interface=PGND,V_LASER_P,3V3_P,AGND,VDD5_A",
  "PGND_Domain=3V3_P,OP_OUT,PGND,V_LASER",
].join("\n");

describe("parseHarnessDefinitions", () => {
  it("parses one type per line", () => {
    const definitions = parseHarnessDefinitions(HELIOS_CHANNEL_HARNESS);

    expect([...definitions.keys()].sort()).toEqual([
      "AGND_Domain",
      "Channel_interface",
      "PGND_Domain",
    ]);
    expect(definitions.get("PGND_Domain")).toEqual(["3V3_P", "OP_OUT", "PGND", "V_LASER"]);
  });

  it("tolerates blank lines, CRLF and surrounding whitespace", () => {
    const definitions = parseHarnessDefinitions("\r\n  A = X , Y \r\n\r\nB=Z\r\n");

    expect(definitions.get("A")).toEqual(["X", "Y"]);
    expect(definitions.get("B")).toEqual(["Z"]);
  });

  it("ignores lines that are not a definition", () => {
    const definitions = parseHarnessDefinitions("not a definition\n=novalue\nC=\nD=W");

    expect([...definitions.keys()]).toEqual(["D"]);
  });
});

describe("resolveHarnessMembers", () => {
  it("returns the members of a flat harness type", () => {
    const definitions = parseHarnessDefinitions(HELIOS_CHANNEL_HARNESS);

    expect(resolveHarnessMembers("AGND_Domain", definitions)).toEqual([
      "PULSE_OUT",
      "PULSE_IN",
      "AGND",
      "VDD5",
      "STDN",
      "TEMPOUT",
    ]);
  });

  it("recurses into a nested harness type", () => {
    // Channel_interface's PGND entry carries HarnessType=PGND_Domain, so the
    // bundle also carries PGND_Domain's members. Flattening one level would drop
    // OP_OUT and V_LASER entirely.
    const definitions = parseHarnessDefinitions(HELIOS_CHANNEL_HARNESS);
    const nested = new Map([["PGND", "PGND_Domain"]]);

    expect(resolveHarnessMembers("Channel_interface", definitions, nested)).toEqual([
      "PGND.3V3_P",
      "PGND.OP_OUT",
      "PGND.PGND",
      "PGND.V_LASER",
      "V_LASER_P",
      "3V3_P",
      "AGND",
      "VDD5_A",
    ]);
  });

  it("qualifies nested members so a repeated signal name stays distinct", () => {
    const definitions = parseHarnessDefinitions(HELIOS_CHANNEL_HARNESS);
    const members = resolveHarnessMembers(
      "Channel_interface",
      definitions,
      new Map([["PGND", "PGND_Domain"]])
    );

    // 3V3_P appears both directly and inside PGND_Domain; they must not collide.
    expect(members).toContain("3V3_P");
    expect(members).toContain("PGND.3V3_P");
  });

  it("returns nothing for an unknown type", () => {
    expect(resolveHarnessMembers("NoSuchType", parseHarnessDefinitions("A=X"))).toEqual([]);
  });

  it("stops at a cycle instead of recursing forever", () => {
    const definitions = parseHarnessDefinitions("A=B,plain\nB=A,other");
    const nested = new Map([
      ["B", "B"],
      ["A", "A"],
    ]);

    const members = resolveHarnessMembers("A", definitions, nested);

    expect(members).toContain("plain");
    expect(members).toContain("B.other");
    // A -> B -> A must terminate; the revisit contributes nothing.
    expect(members.some((m) => m.split(".").length > 3)).toBe(false);
  });

  it("handles a type that names itself", () => {
    const definitions = parseHarnessDefinitions("Self=Self,X");

    expect(resolveHarnessMembers("Self", definitions, new Map([["Self", "Self"]]))).toEqual([
      "Self",
      "X",
    ]);
  });
});

describe("collectNestedHarnessTypes", () => {
  it("maps an entry name to the harness type it expands to", () => {
    // Shape taken from the Additional stream of HELIOS-R's channel.SchDoc.
    const nested = collectNestedHarnessTypes([
      { RECORD: "216", Name: "PGND", HarnessType: "PGND_Domain" },
      { RECORD: "216", Name: "AGND" },
      { RECORD: "218" },
      { RECORD: "18", Name: "CHANNEL", HarnessType: "Channel_interface" },
    ]);

    expect(nested.get("PGND")).toBe("PGND_Domain");
    // A plain member has no nested type, and a port is not a harness entry.
    expect(nested.has("AGND")).toBe(false);
    expect(nested.has("CHANNEL")).toBe(false);
  });
});

describe("readHarnessConnectors", () => {
  it("places entries on the connector's left edge at the verified pitch", () => {
    // Geometry taken from pulp-bio/HELIOS-R main.SchDoc, where the five wires
    // landing on this connector end at y = 660, 650, 580, 570 and 540.
    const records: HarnessRecord[] = [
      {
        RECORD: "215",
        "Location.X": "410",
        "Location.Y": "670",
        XSize: "80",
        HarnessConnectorSide: "1",
      },
      { RECORD: "216", Name: "V_LASER_P", DistanceFromTop: "1" },
      { RECORD: "216", Name: "PGND", DistanceFromTop: "2" },
      { RECORD: "216", Name: "3V3_P", DistanceFromTop: "9" },
      { RECORD: "216", Name: "AGND", DistanceFromTop: "10" },
      { RECORD: "216", Name: "VDD5_A", DistanceFromTop: "13" },
    ];

    const connectors = readHarnessConnectors(records);

    expect(connectors).toHaveLength(1);
    expect(connectors[0].entries).toHaveLength(5);
    expect(records.map((r) => r["Location.Y"]).slice(1)).toEqual([
      "660",
      "650",
      "580",
      "570",
      "540",
    ]);
    expect(records[1]["Location.X"]).toBe("410");
  });

  it("places entries on the right edge when the entry says so", () => {
    // qfsae/pcb DASH_BULKHEAD.SchDoc: the connector writes no
    // HarnessConnectorSide and each entry carries Side=1, which is the same
    // arrangement mirrored. Its four wires end at x = 330.
    const records: HarnessRecord[] = [
      { RECORD: "215", "Location.X": "230", "Location.Y": "250", XSize: "100" },
      { RECORD: "216", Name: "DRIVER_SWITCH_1", Side: "1", DistanceFromTop: "1" },
      { RECORD: "216", Name: "DRIVER_SWITCH_2", Side: "1", DistanceFromTop: "2" },
    ];

    readHarnessConnectors(records);

    expect(records[1]["Location.X"]).toBe("330");
    expect(records[1]["Location.Y"]).toBe("240");
    expect(records[2]["Location.Y"]).toBe("230");
  });

  it("reads a fractional distance from the top", () => {
    // HELIOS-R channel.SchDoc puts an entry half a step down, and its wire ends
    // at y = 450 rather than 455.
    const records: HarnessRecord[] = [
      { RECORD: "215", "Location.X": "815", "Location.Y": "465", XSize: "70" },
      {
        RECORD: "216",
        Name: "V_LASER",
        Side: "1",
        DistanceFromTop: "1",
        DistanceFromTop_Frac1: "500000",
      },
      // An entry on the top edge writes no whole part at all.
      { RECORD: "216", Name: "PGND", Side: "1", DistanceFromTop_Frac1: "500000" },
    ];

    readHarnessConnectors(records);

    expect(records[1]["Location.Y"]).toBe("450");
    expect(records[2]["Location.Y"]).toBe("460");
  });

  it("assigns entries to the most recent connector, not by OwnerIndex", () => {
    // OwnerIndex is present on some entries and absent on others in real files,
    // so stream order is what links an entry to its connector.
    const records: HarnessRecord[] = [
      { RECORD: "215", "Location.X": "100", "Location.Y": "500", HarnessConnectorSide: "1" },
      { RECORD: "216", Name: "A", DistanceFromTop: "1" },
      { RECORD: "215", "Location.X": "300", "Location.Y": "800", HarnessConnectorSide: "1" },
      { RECORD: "216", Name: "B", DistanceFromTop: "2" },
    ];

    readHarnessConnectors(records);

    expect(records[1]["Location.X"]).toBe("100");
    expect(records[1]["Location.Y"]).toBe("490");
    expect(records[3]["Location.X"]).toBe("300");
    expect(records[3]["Location.Y"]).toBe("780");
  });

  it("leaves an entry unpositioned when its connector has no coordinates", () => {
    // Better to contribute no connectivity than to place it at the origin,
    // where every other unplaceable entry would appear to touch it.
    const records: HarnessRecord[] = [
      { RECORD: "215", XSize: "50" },
      { RECORD: "216", Name: "X", DistanceFromTop: "1" },
    ];

    readHarnessConnectors(records);

    expect(records[1]["Location.Y"]).toBeUndefined();
  });

  it("ignores an entry with no preceding connector", () => {
    const records: HarnessRecord[] = [{ RECORD: "216", Name: "orphan", DistanceFromTop: "1" }];

    expect(readHarnessConnectors(records)).toEqual([]);
  });

  it("puts the bundle's outgoing connection on the edge opposite the entries", () => {
    // HELIOS-R channel.SchDoc: this connector's harness line runs from (760,400).
    const records: HarnessRecord[] = [
      {
        RECORD: "215",
        "Location.X": "690",
        "Location.Y": "430",
        XSize: "70",
        PrimaryConnectionPosition: "30",
        HarnessConnectorSide: "1",
      },
    ];

    expect(readHarnessConnectors(records)[0].primary).toEqual([760 * 10000, 400 * 10000]);
  });
});

describe("assignHarnessSignals", () => {
  const at = (x: number, y: number) => ({ "Location.X": String(x), "Location.Y": String(y) });

  /** Two connectors of one type, wired to each other by a harness line. */
  const bundlePair = (): HarnessRecord[] => [
    // Bundles: entries on the left, line leaves from the right at (760,400).
    {
      RECORD: "215",
      ...at(690, 430),
      XSize: "70",
      PrimaryConnectionPosition: "30",
      HarnessConnectorSide: "1",
    },
    { RECORD: "216", Name: "OP_OUT", DistanceFromTop: "1" },
    // Unbundles: line arrives at the left (815,400), entries on the right.
    { RECORD: "215", ...at(815, 465), XSize: "70", PrimaryConnectionPosition: "65" },
    { RECORD: "216", Name: "OP_OUT", Side: "1", DistanceFromTop: "1" },
  ];

  const harnessLine = (x1: number, y1: number, x2: number, y2: number): HarnessRecord => ({
    RECORD: "218",
    LocationCount: "2",
    X1: String(x1),
    Y1: String(y1),
    X2: String(x2),
    Y2: String(y2),
  });

  it("gives both ends of a harness line the same signal", () => {
    const records = bundlePair();
    const connectors = readHarnessConnectors(records);

    assignHarnessSignals(connectors, {
      records: [],
      buses: [harnessLine(760, 400, 815, 400)],
      sheetKey: "channel.SchDoc",
    });

    expect(records[1].harnessSignal).toBeDefined();
    expect(records[3].harnessSignal).toBe(records[1].harnessSignal);
  });

  it("keeps two harnesses of the same type apart", () => {
    // qfsae/pcb draws one 3WIRE_PSG_SENSOR harness per sensor, each entry named
    // SIGNAL. Only the port they leave through tells them apart.
    const records: HarnessRecord[] = [
      { RECORD: "215", ...at(240, 180), XSize: "60", PrimaryConnectionPosition: "20" },
      { RECORD: "216", Name: "SIGNAL", Side: "1", DistanceFromTop: "2" },
      { RECORD: "215", ...at(240, 120), XSize: "60", PrimaryConnectionPosition: "20" },
      { RECORD: "216", Name: "SIGNAL", Side: "1", DistanceFromTop: "2" },
    ];
    const connectors = readHarnessConnectors(records);

    assignHarnessSignals(connectors, {
      records: [
        { RECORD: "18", Name: "FL_DAMPER_POT", ...at(80, 160), Width: "160", HarnessType: "S" },
        { RECORD: "18", Name: "FR_DAMPER_POT", ...at(80, 100), Width: "160", HarnessType: "S" },
      ],
      buses: [],
      sheetKey: "DASH_BULKHEAD.SchDoc",
    });

    expect(records[1].harnessSignal).toBe(harnessSignalKey("FL_DAMPER_POT", "SIGNAL"));
    expect(records[3].harnessSignal).toBe(harnessSignalKey("FR_DAMPER_POT", "SIGNAL"));
  });

  it("names the nets of a labelled harness after the label and the entry", () => {
    // Altium: "the net is named based on the Net Label placed on the Signal
    // Harness line + the Harness Entry".
    const records = bundlePair();
    const connectors = readHarnessConnectors(records);

    assignHarnessSignals(connectors, {
      records: [{ RECORD: "25", Text: "HARD", ...at(790, 400) }],
      buses: [harnessLine(760, 400, 815, 400)],
      sheetKey: "channel.SchDoc",
    });

    expect(records[1].harnessNetName).toBe("HARD.OP_OUT");
    expect(records[3].harnessNetName).toBe("HARD.OP_OUT");
  });

  it("leaves an unlabelled harness with no net name of its own", () => {
    const records = bundlePair();
    const connectors = readHarnessConnectors(records);

    assignHarnessSignals(connectors, {
      records: [],
      buses: [harnessLine(760, 400, 815, 400)],
      sheetKey: "channel.SchDoc",
    });

    expect(records[1].harnessNetName).toBeUndefined();
  });

  it("reports the sheet entries a harness line joins as one bundle", () => {
    // qfsae/pcb TOP.SchDoc joins a bulkhead's bundle to the sheet that feeds it,
    // where the same bundle goes by a different port name.
    const links = assignHarnessSignals([], {
      records: [
        { RECORD: "15", ...at(520, 630), XSize: "370" },
        { RECORD: "16", Name: "TRANSPONDER_POWER_UL", DistanceFromTop: "2", HarnessType: "P" },
        { RECORD: "15", ...at(310, 730), XSize: "220" },
        { RECORD: "16", Name: "TRANSPONDER_POWER", Side: "1", DistanceFromTop: "3", HarnessType: "P" },
      ],
      buses: [harnessLine(520, 610, 530, 700)],
      sheetKey: "TOP.SchDoc",
    });

    expect(links).toEqual([["TRANSPONDER_POWER_UL", "TRANSPONDER_POWER"]]);
  });

  it("leaves a connector that reaches no harness line or port alone", () => {
    const records: HarnessRecord[] = [
      { RECORD: "215", ...at(10, 20), XSize: "50", PrimaryConnectionPosition: "5" },
      { RECORD: "216", Name: "X", Side: "1", DistanceFromTop: "1" },
    ];

    assignHarnessSignals(readHarnessConnectors(records), {
      records: [],
      buses: [],
      sheetKey: "lonely.SchDoc",
    });

    expect(records[1].harnessSignal).toBeUndefined();
  });
});

describe("cross-sheet harness members", () => {
  it("resolves the bundle a harness-typed sheet entry carries", () => {
    // main.SchDoc's sheet entry CHANNEL is typed Channel_interface; the members
    // below are what must cross the sheet boundary with it.
    const definitions = parseHarnessDefinitions(HELIOS_CHANNEL_HARNESS);
    const nested = new Map([["PGND", "PGND_Domain"]]);

    const members = resolveHarnessMembers("Channel_interface", definitions, nested);
    const leaves = members.map((m) => m.slice(m.lastIndexOf(".") + 1));

    // Both the qualified path and the leaf name matter: the leaf is what a net
    // inside the child sheet is actually called.
    expect(leaves).toContain("OP_OUT");
    expect(leaves).toContain("V_LASER");
    expect(members).toContain("V_LASER_P");
    expect(members).toContain("AGND");
  });

  it("carries nested members across the boundary too", () => {
    // A one-level flatten would leave OP_OUT and V_LASER behind on the child
    // sheet, where they would become per-channel nets connected to nothing.
    const definitions = parseHarnessDefinitions(HELIOS_CHANNEL_HARNESS);
    const flat = resolveHarnessMembers("Channel_interface", definitions);
    const withNesting = resolveHarnessMembers(
      "Channel_interface",
      definitions,
      new Map([["PGND", "PGND_Domain"]])
    );

    expect(flat).toContain("PGND");
    expect(flat.some((m) => m.endsWith("OP_OUT"))).toBe(false);
    expect(withNesting.some((m) => m.endsWith("OP_OUT"))).toBe(true);
  });
});
