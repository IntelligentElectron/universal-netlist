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
  buildOccurrenceDbIds,
  hasVariantGroups,
  parseVariantGroup,
  parseVariantNames,
  resolveDnsRefdes,
} from "./variant-store.js";
import type { OleDirectoryPath } from "../../ole-reader/types.js";

/** A group stream: uint32 payload length, then the payload. */
const groupStream = (payload: string): Buffer => {
  const body = Buffer.from(payload, "latin1");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  return Buffer.concat([header, body]);
};

/** One Hierarchy record: type, two pad bytes, the preamble, then the body. */
const record = (type: number, first: number, second: number): Buffer => {
  const buffer = Buffer.alloc(19);
  buffer[0] = type;
  Buffer.from([0xff, 0xe4, 0x5c, 0x39]).copy(buffer, 3);
  buffer.writeUInt32LE(0, 7); // preamble trailing-data length
  buffer.writeUInt32LE(first, 11);
  buffer.writeUInt32LE(second, 15);
  return buffer;
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

describe("buildOccurrenceDbIds", () => {
  it("pairs a part occurrence with the instance it stands for", () => {
    expect(buildOccurrenceDbIds(record(66, 40520, 6173697)).get(40520)).toBe(6173697);
  });

  it("leaves the net mapping beside it alone", () => {
    // Type 67 is NetDbIdMapping, whose body reads as a dbId and a net name.
    // Taking it for an occurrence would resolve a net id onto a part.
    expect(buildOccurrenceDbIds(record(67, 40520, 6173697)).size).toBe(0);
  });

  it("reads every occurrence in a stream carrying more than one", () => {
    const hierarchy = Buffer.concat([
      record(66, 40520, 6173697),
      record(67, 32677, 11),
      record(66, 45218, 6462656),
    ]);

    expect([...buildOccurrenceDbIds(hierarchy)]).toEqual([
      [40520, 6173697],
      [45218, 6462656],
    ]);
  });
});

describe("resolveDnsRefdes", () => {
  const occurrences = new Map([
    [1, 100],
    [2, 200],
  ]);
  const refdes = new Map([
    [100, "R13"],
    [200, "C24"],
  ]);

  it("names the refdes behind an unstuffed occurrence", () => {
    const dns = resolveDnsRefdes([{ occurrenceId: 1, stuffed: false }], occurrences, refdes);

    expect([...dns]).toEqual(["R13"]);
  });

  it("leaves a stuffed occurrence on the board", () => {
    const dns = resolveDnsRefdes([{ occurrenceId: 1, stuffed: true }], occurrences, refdes);

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
      occurrences,
      refdes
    );

    expect(dns.size).toBe(0);
  });

  it("skips an occurrence no instance answers to", () => {
    // reServer J2032's DNP group names one such id.
    const dns = resolveDnsRefdes([{ occurrenceId: 99, stuffed: false }], occurrences, refdes);

    expect(dns.size).toBe(0);
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
