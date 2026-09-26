/**
 * CIS variant store: the Do Not Stuff set a design's variants declare.
 *
 * The streams are undocumented, so every rule here was read off a design and is
 * asserted against the bytes that design writes. The numbers in the fixture
 * suite below come from the CIS-generated BOM that ships beside the schematic,
 * which is the only independent statement of what the board is stuffed with.
 */

import { describe, expect, it } from "vitest";
import {
  hasVariantGroups,
  listCadenceVariants,
  parseBomVariantGroups,
  parseVariantGroup,
  parseVariantNames,
  resolveDnsRefdes,
  resolveVariantStuffing,
} from "./variant-store.js";
import type { OleDirectoryPath } from "../../ole-reader/types.js";

/** A group stream: uint32 payload length, then the payload. */
const groupStream = (payload: string): Buffer => {
  const body = Buffer.from(payload, "latin1");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  return Buffer.concat([header, body]);
};

const streamEntry = (path: string): OleDirectoryPath =>
  ({ path, entry: { type: 2 } }) as OleDirectoryPath;

describe("parseVariantGroup", () => {
  it("reads each occurrence and the state the group gives it", () => {
    // Verbatim from a real design's DNM group.
    const entries = parseVariantGroup(groupStream("0\xb020922~0\xb020919~0\xb0"));

    expect(entries).toEqual([
      { occurrenceId: 20922, stuffed: false },
      { occurrenceId: 20919, stuffed: false },
    ]);
  });

  it("reads a group that stuffs its members rather than unstuffing them", () => {
    // The same design's RF group, which puts its parts on the board.
    const entries = parseVariantGroup(groupStream("0\xb019231~1\xb017820~1\xb0"));

    expect(entries.every((e) => e.stuffed)).toBe(true);
  });

  it("skips the leading flag, which is a token carrying no state", () => {
    // Counting it as an occurrence would claim a part numbered 0 or 1.
    expect(parseVariantGroup(groupStream("1\xb0121680~0\xb0"))).toEqual([
      { occurrenceId: 121680, stuffed: false },
    ]);
  });

  it("reads across the empty token that separates two sections", () => {
    // reServer J2032 writes its DNP group in two runs; the parts after the
    // break are as unstuffed as the ones before it.
    const entries = parseVariantGroup(groupStream("0\xb049458~0\xb0\xb044585~0\xb044294~0\xb0"));

    expect(entries.map((e) => e.occurrenceId)).toEqual([49458, 44585, 44294]);
  });

  it("stops at the length the stream declares", () => {
    // A stream read past its own payload picks up whatever follows it.
    const truncated = Buffer.concat([groupStream("0\xb020922~0\xb0"), Buffer.from("99999~0\xb0")]);

    expect(parseVariantGroup(truncated).map((e) => e.occurrenceId)).toEqual([20922]);
  });

  it("ignores a state no design has shown", () => {
    // Reading an unknown state as 0 would unstuff a part on a guess.
    expect(parseVariantGroup(groupStream("0\xb020922~7\xb0"))).toEqual([]);
  });

  it("returns nothing for a stream too short to carry a length", () => {
    expect(parseVariantGroup(Buffer.from([0x00, 0x01]))).toEqual([]);
  });
});

describe("parseVariantNames", () => {
  it("reads the length-prefixed names the stream lists", () => {
    // Verbatim from reServer J2032: magic, count, then each name and its NUL.
    const buffer = Buffer.concat([
      Buffer.from([0x84, 0x03, 0x00, 0x00, 0x05, 0x00, 0x00, 0x00]),
      Buffer.from([0x03, 0x00]),
      Buffer.from("DNP\0", "latin1"),
      Buffer.from([0x08, 0x00]),
      Buffer.from("bom-Main\0", "latin1"),
    ]);

    expect(parseVariantNames(buffer)).toEqual(["DNP", "bom-Main"]);
  });

  it("returns nothing for the empty store a design without variants writes", () => {
    expect(parseVariantNames(Buffer.from([0x84, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00]))).toEqual([]);
  });
});

describe("BOM variant membership", () => {
  it("reads the exact groups assigned to one BOM variant", () => {
    // Verbatim payload shape from LAUNCHXL-CC1310's `BOM/Standard/Standard`.
    expect(
      parseBomVariantGroups(
        groupStream("6\xf9Common\xf9DNM\xf9DebuggerIF\xf9Peripherals\xf9RF\xf9XDS")
      )
    ).toEqual(["Common", "DNM", "DebuggerIF", "Peripherals", "RF", "XDS"]);
  });

  it("uses the count rather than reading bytes beyond the declared membership", () => {
    expect(parseBomVariantGroups(groupStream("1\xf9DNP\xf9NotInThisVariant"))).toEqual(["DNP"]);
  });

  it("lists BOM variants but not their helper streams", () => {
    expect(
      listCadenceVariants([
        streamEntry("CIS/VariantStore/BOM/Standard/Standard"),
        streamEntry("CIS/VariantStore/BOM/Standard/BOMPartData"),
        streamEntry("CIS/VariantStore/BOM/BOMDataStream"),
      ])
    ).toEqual([{ name: "Standard" }]);
  });
});

describe("resolveDnsRefdes", () => {
  // Occurrence id to the refdes the parser reports for it, as the hierarchy
  // expander builds it: a reused block's instance appears once per placement.
  const refdes = new Map([
    [1, "R13"],
    [2, "C24"],
    [3, "C124"],
  ]);

  it("names the refdes behind an unstuffed occurrence", () => {
    const dns = resolveDnsRefdes([{ occurrenceId: 1, stuffed: false }], refdes);

    expect([...dns]).toEqual(["R13"]);
  });

  it("unstuffs one placement of a reused block and leaves the other on the board", () => {
    const dns = resolveDnsRefdes([{ occurrenceId: 3, stuffed: false }], refdes);

    expect([...dns]).toEqual(["C124"]);
  });

  it("leaves a stuffed occurrence on the board", () => {
    const dns = resolveDnsRefdes([{ occurrenceId: 1, stuffed: true }], refdes);

    expect(dns.size).toBe(0);
  });

  it("stuffs a part one group unstuffs and another stuffs", () => {
    // No design in the corpus names a part both ways. Were one to, reporting it
    // stuffed leaves a part on the board rather than dropping one that is on it.
    const dns = resolveDnsRefdes(
      [
        { occurrenceId: 1, stuffed: false },
        { occurrenceId: 1, stuffed: true },
      ],
      refdes
    );

    expect(dns.size).toBe(0);
  });

  it("skips an occurrence no instance answers to", () => {
    // reServer J2032's DNP group names one such id.
    const dns = resolveDnsRefdes([{ occurrenceId: 99, stuffed: false }], refdes);

    expect(dns.size).toBe(0);
  });
});

describe("resolveVariantStuffing", () => {
  const refdes = new Map([
    [1, "R13"],
    [2, "C24"],
  ]);

  it("reports the parts a group explicitly puts on the board beside the ones it leaves off", () => {
    // A variant's stuffed set is what lets it override a part's own property.
    const stuffing = resolveVariantStuffing(
      [
        { occurrenceId: 1, stuffed: true },
        { occurrenceId: 2, stuffed: false },
      ],
      refdes
    );

    expect([...stuffing.stuffed]).toEqual(["R13"]);
    expect([...stuffing.unstuffed]).toEqual(["C24"]);
  });

  it("keeps a part named both ways in the stuffed set alone", () => {
    const stuffing = resolveVariantStuffing(
      [
        { occurrenceId: 1, stuffed: false },
        { occurrenceId: 1, stuffed: true },
      ],
      refdes
    );

    expect([...stuffing.stuffed]).toEqual(["R13"]);
    expect(stuffing.unstuffed.size).toBe(0);
  });
});

describe("hasVariantGroups", () => {
  it("recognises a group by the stream that repeats its name", () => {
    expect(hasVariantGroups([streamEntry("CIS/VariantStore/Groups/DNP/DNP")])).toBe(true);
  });

  it("does not take the store's own index for a group", () => {
    // Every design carrying the storage has this stream, variants or not.
    expect(hasVariantGroups([streamEntry("CIS/VariantStore/Groups/GroupsDataStream")])).toBe(false);
  });

  it("does not take a group's update log for its member list", () => {
    expect(
      hasVariantGroups([streamEntry("CIS/VariantStore/Groups/DNP/UpdateStorageGroupDataStream")])
    ).toBe(false);
  });
});
