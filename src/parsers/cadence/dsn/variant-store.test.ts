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
  buildOccurrenceRefdes,
  hasVariantGroups,
  listCadenceVariants,
  parseBomVariantGroups,
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

/**
 * One Hierarchy record: type, two pad bytes, the preamble, then the body.
 *
 * `extra` is the preamble's trailing-data length. It is zero on most designs,
 * and where it is not, the whole body sits that many bytes further on.
 * `reference` is the occurrence's reference designator, which trails the body.
 */
const record = (
  type: number,
  first: number,
  second: number,
  { reference, extra = 0 }: { reference?: string; extra?: number } = {}
): Buffer => {
  const body = 11 + extra; // type, two pads, magic, trailing-data length
  const buffer = Buffer.alloc(
    reference === undefined ? body + 8 : body + 20 + 3 + reference.length
  );
  buffer[0] = type;
  Buffer.from([0xff, 0xe4, 0x5c, 0x39]).copy(buffer, 3);
  buffer.writeUInt32LE(extra, 7);
  buffer.writeUInt32LE(first, body);
  buffer.writeUInt32LE(second, body + 4);
  if (reference !== undefined) {
    buffer.writeUInt16LE(reference.length, body + 20);
    buffer.write(reference, body + 22, "latin1");
  }
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

  it("reads past the preamble's trailing data to find the body", () => {
    // A record carrying a display-property block declares its length in the
    // preamble. Reading the body at the fixed offset instead lands inside that
    // block and pairs an occurrence that does not exist with a dbId that is not
    // an instance.
    const hierarchy = record(66, 40520, 6173697, { extra: 37 });

    expect([...buildOccurrenceDbIds(hierarchy)]).toEqual([[40520, 6173697]]);
  });
});

describe("buildOccurrenceRefdes", () => {
  it("names the instance an occurrence annotates", () => {
    expect(buildOccurrenceRefdes(record(66, 40520, 6173697, { reference: "U32" }))).toEqual(
      new Map([[6173697, "U32"]])
    );
  });

  it("finds the reference past the preamble's trailing data", () => {
    const hierarchy = record(66, 40520, 6173697, { reference: "U32", extra: 37 });

    expect(buildOccurrenceRefdes(hierarchy)).toEqual(new Map([[6173697, "U32"]]));
  });

  it("keeps a never-annotated placeholder, which is a real occurrence value", () => {
    expect(buildOccurrenceRefdes(record(66, 1, 9, { reference: "U?" })).get(9)).toBe("U?");
  });

  it("leaves the net mapping beside it alone", () => {
    expect(buildOccurrenceRefdes(record(67, 40520, 6173697, { reference: "U32" })).size).toBe(0);
  });

  it("gives every section of a multi-section part the same reference", () => {
    // Both sections annotate to one refdes, each under its own dbId.
    const hierarchy = Buffer.concat([
      record(66, 1, 45502261, { reference: "U32" }),
      record(66, 2, 45501482, { reference: "U32" }),
    ]);

    expect([...buildOccurrenceRefdes(hierarchy).values()]).toEqual(["U32", "U32"]);
  });

  it("returns nothing for occurrences that record no reference", () => {
    // The common case: the instance copy in the page record is the annotated
    // one, so there is nothing here to override it with.
    expect(buildOccurrenceRefdes(record(66, 40520, 6173697)).size).toBe(0);
  });

  it("skips a field at the reference's offset that is not shaped like one", () => {
    // The offset is fixed, so shape is what tells a reference from whatever a
    // record this parser does not recognise happens to put there.
    expect(buildOccurrenceRefdes(record(66, 1, 9, { reference: "123" })).size).toBe(0);
  });

  it("ignores a record truncated before its reference", () => {
    const hierarchy = record(66, 1, 9, { reference: "C9" });

    expect(buildOccurrenceRefdes(hierarchy.subarray(0, hierarchy.length - 2)).size).toBe(0);
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
