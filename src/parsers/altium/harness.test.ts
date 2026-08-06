import { describe, expect, it } from "vitest";
import {
  parseHarnessDefinitions,
  resolveHarnessMembers,
  collectNestedHarnessTypes,
  positionHarnessEntries,
} from "./harness.js";

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

describe("positionHarnessEntries", () => {
  it("places entries on the connector's left edge at the verified pitch", () => {
    // Geometry taken from pulp-bio/HELIOS-R main.SchDoc, where the five wires
    // landing on this connector end at y = 660, 650, 580, 570 and 540.
    const records = [
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

    expect(positionHarnessEntries(records)).toBe(5);
    expect(records.map((r) => r["Location.Y"]).slice(1)).toEqual([
      "660",
      "650",
      "580",
      "570",
      "540",
    ]);
    expect(records[1]["Location.X"]).toBe("410");
  });

  it("assigns entries to the most recent connector, not by OwnerIndex", () => {
    // OwnerIndex is present on some entries and absent on others in real files,
    // so stream order is what links an entry to its connector.
    const records = [
      { RECORD: "215", "Location.X": "100", "Location.Y": "500", HarnessConnectorSide: "1" },
      { RECORD: "216", Name: "A", DistanceFromTop: "1" },
      { RECORD: "215", "Location.X": "300", "Location.Y": "800", HarnessConnectorSide: "1" },
      { RECORD: "216", Name: "B", DistanceFromTop: "2" },
    ];

    positionHarnessEntries(records);

    expect(records[1]["Location.X"]).toBe("100");
    expect(records[1]["Location.Y"]).toBe("490");
    expect(records[3]["Location.X"]).toBe("300");
    expect(records[3]["Location.Y"]).toBe("780");
  });

  it("leaves entries on an unverified connector side unpositioned", () => {
    // Better to contribute no connectivity than to invent a connection whose
    // geometry has not been confirmed against a real design.
    const records = [
      { RECORD: "215", "Location.X": "10", "Location.Y": "20", HarnessConnectorSide: "2" },
      { RECORD: "216", Name: "X", DistanceFromTop: "1" },
    ];

    expect(positionHarnessEntries(records)).toBe(0);
    expect(records[1]["Location.Y"]).toBeUndefined();
  });

  it("ignores an entry with no preceding connector", () => {
    const records = [{ RECORD: "216", Name: "orphan", DistanceFromTop: "1" }];

    expect(positionHarnessEntries(records)).toBe(0);
  });
});
