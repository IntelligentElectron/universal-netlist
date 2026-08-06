import { describe, expect, it } from "vitest";
import {
  parseHarnessDefinitions,
  resolveHarnessMembers,
  collectNestedHarnessTypes,
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
