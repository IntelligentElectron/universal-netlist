/**
 * Hierarchy Stream Parser
 *
 * A view's `Views/{name}/Hierarchy/Hierarchy` stream is Capture's flattened
 * occurrence tree: the root schematic's nets and part occurrences, and inside
 * it one occurrence per placement of every hierarchical block, each carrying
 * the nets and parts of that placement. A block drawn once and placed three
 * times appears three times here, and each copy annotates its own reference
 * designators, which is how a part inside a reused block gets a distinct refdes
 * per placement.
 *
 * The stream is read sequentially, structure by structure, with the same
 * prefix-and-preamble framing every other stream uses. OpenOrCadParser's
 * `StreamHierarchy` reads the top level of this layout and leaves the part
 * occurrence's body unread; the body, the nested scope, and the block form of
 * the record come from reading the bytes.
 *
 * Layout, after the 9-byte stream header:
 *
 *   string    schematic name
 *   7 bytes
 *   uint16    count of named entries       each: structure, 4 bytes, string
 *   <scope>
 *
 * where a scope is:
 *
 *   uint16    count of nets                each: structure (type 67), uint32 dbId, string name
 *   uint16    count of type-82 structures  each: structure, 8 bytes
 *   uint32    count of type-91 structures  each: structure, 8 bytes
 *   uint16    count of occurrences         each: occurrence
 *
 * and an occurrence (type 66) is:
 *
 *   structure                              its preamble's trailing data holds a
 *                                          display-property block when present
 *   uint32    occurrence id
 *   uint32    dbId                         a PlacedInstance, or a DrawnInstance
 *   1 byte    0x42, uint32, uint32         an inner header
 *   string    schematic name               empty for a part
 *   string    reference designator         empty for a block, or when never annotated
 *   uint32
 *   uint16    count of pins                each: structure (type 68), uint32 pin occurrence id, uint16 ordinal
 *                                          a `Number` property on the structure's short prefix
 *                                          carries this occurrence's pin number
 *   <scope>                                a part's scope has every count at zero
 *
 * The top-level scope alone varies with the file version, in the widths of its
 * two later counts and in an 8-byte block before the occurrence count, exactly
 * where OpenOrCadParser's version flags say it does. Nested scopes are fixed.
 * Rather than carry a version, the parser tries each layout and keeps the one
 * that ends on the stream's last byte: the counts leave no slack for a wrong
 * layout to reach it.
 */

import { BinaryReader } from "./binary-reader.js";
import {
  FutureDataList,
  autoReadPrefixes,
  readPreamble,
  type PrefixPropertyPair,
} from "./generic-parser.js";

/** A net of one scope, with the name Capture gives it there. */
export interface HierarchyNet {
  dbId: number;
  name: string;
}

/**
 * One pin of an occurrence.
 *
 * The properties are (name, value) pairs into the Library string list, as on
 * every short prefix. A pin whose number this occurrence overrides carries a
 * `Number` property with the pin number as its value: a multi-section part
 * shared by two placements of a block uses a different section in each, and
 * the page record, drawn once, cannot say which.
 */
export interface OccurrencePin {
  /** Position in the occurrence's pin list; pin index `ordinal + 1` on the page record. */
  ordinal: number;
  properties: PrefixPropertyPair[];
}

/** A part placed once in one scope: the PlacedInstance and its refdes there. */
export interface PartOccurrence {
  occurrenceId: number;
  dbId: number;
  /** The annotated reference designator, or empty where the occurrence carries none. */
  reference: string;
  pins: OccurrencePin[];
}

/** One placement of a hierarchical block, with the scope it opens. */
export interface BlockOccurrence {
  occurrenceId: number;
  /** The dbId of the DrawnInstance on the parent page that places the block. */
  dbId: number;
  /** The child schematic the block draws, which names its `Views/{name}` folder. */
  schematic: string;
  reference: string;
  scope: HierarchyScope;
}

/** The nets and occurrences of one schematic placement. */
export interface HierarchyScope {
  nets: HierarchyNet[];
  parts: PartOccurrence[];
  blocks: BlockOccurrence[];
}

/** One view's occurrence tree. */
export interface HierarchyStream {
  /** The root schematic, which names the view's `Views/{name}` folder. */
  schematic: string;
  scope: HierarchyScope;
}

/** Structure type of a net record. */
const NET_TYPE = 67;

/** Structure type of a part or block occurrence. */
const OCCURRENCE_TYPE = 66;

/** The inner header a part occurrence's body opens with. */
const INNER_HEADER_TYPE = 0x42;

/** How the top-level scope's counts are laid out in one file version. */
interface TopLayout {
  /** Bytes in the type-91 count. */
  wideAuxCount: boolean;
  /** Whether 8 bytes sit before the occurrence count. */
  padded: boolean;
  /** Bytes in the occurrence count. */
  wideOccurrenceCount: boolean;
}

const TOP_LAYOUTS: readonly TopLayout[] = [
  { wideAuxCount: true, padded: false, wideOccurrenceCount: false },
  { wideAuxCount: true, padded: true, wideOccurrenceCount: false },
  { wideAuxCount: false, padded: false, wideOccurrenceCount: false },
  { wideAuxCount: false, padded: true, wideOccurrenceCount: false },
  { wideAuxCount: true, padded: false, wideOccurrenceCount: true },
  { wideAuxCount: true, padded: true, wideOccurrenceCount: true },
  { wideAuxCount: false, padded: false, wideOccurrenceCount: true },
  { wideAuxCount: false, padded: true, wideOccurrenceCount: true },
];

/** Read a structure's framing: its prefixes and preamble. */
function readStructure(reader: BinaryReader): {
  structType: number;
  properties: PrefixPropertyPair[];
} {
  const futureData = new FutureDataList(reader);
  const result = autoReadPrefixes(reader, futureData);
  readPreamble(reader);
  return result;
}

function readOccurrence(reader: BinaryReader, into: HierarchyScope): void {
  const { structType: type } = readStructure(reader);
  if (type !== OCCURRENCE_TYPE) {
    throw new Error(`Expected occurrence (type ${OCCURRENCE_TYPE}), got ${type}`);
  }
  const occurrenceId = reader.readUint32();
  const dbId = reader.readUint32();

  const innerType = reader.readUint8();
  if (innerType !== INNER_HEADER_TYPE) {
    throw new Error(`Expected occurrence inner header 0x42, got 0x${innerType.toString(16)}`);
  }
  reader.skip(8);

  const schematic = reader.readStringLenZeroTerm();
  const reference = reader.readStringLenZeroTerm();
  reader.skip(4);

  const pinCount = reader.readUint16();
  const pins: OccurrencePin[] = [];
  for (let i = 0; i < pinCount; i++) {
    const { properties } = readStructure(reader);
    reader.skip(4); // the pin occurrence's own id
    pins.push({ ordinal: reader.readUint16(), properties });
  }

  const scope = readScope(reader);

  if (schematic === "") {
    into.parts.push({ occurrenceId, dbId, reference, pins });
  } else {
    into.blocks.push({ occurrenceId, dbId, schematic, reference, scope });
  }
}

function readScope(reader: BinaryReader, top?: TopLayout): HierarchyScope {
  const scope: HierarchyScope = { nets: [], parts: [], blocks: [] };

  const netCount = reader.readUint16();
  for (let i = 0; i < netCount; i++) {
    const { structType: type } = readStructure(reader);
    if (type !== NET_TYPE) throw new Error(`Expected net (type ${NET_TYPE}), got ${type}`);
    const dbId = reader.readUint32();
    scope.nets.push({ dbId, name: reader.readStringLenZeroTerm() });
  }

  const auxCount = reader.readUint16();
  for (let i = 0; i < auxCount; i++) {
    readStructure(reader);
    reader.skip(8);
  }

  const aux2Count =
    top === undefined || top.wideAuxCount ? reader.readUint32() : reader.readUint16();
  for (let i = 0; i < aux2Count; i++) {
    readStructure(reader);
    reader.skip(8);
  }

  if (top?.padded) reader.skip(8);

  const occurrenceCount = top?.wideOccurrenceCount ? reader.readUint32() : reader.readUint16();
  for (let i = 0; i < occurrenceCount; i++) readOccurrence(reader, scope);

  return scope;
}

function readStream(reader: BinaryReader, top: TopLayout): HierarchyStream {
  reader.skip(9);
  const schematic = reader.readStringLenZeroTerm();
  reader.skip(7);

  const namedCount = reader.readUint16();
  for (let i = 0; i < namedCount; i++) {
    readStructure(reader);
    reader.skip(4);
    reader.readStringLenZeroTerm();
  }

  return { schematic, scope: readScope(reader, top) };
}

/**
 * Parse a Hierarchy stream into its occurrence tree.
 *
 * Throws when no layout reads the stream to its last byte, which is how a
 * stream this parser does not understand announces itself rather than
 * yielding a tree with the wrong parts in it.
 */
export function parseHierarchyStream(buffer: Buffer): HierarchyStream {
  let lastError: unknown;
  for (const layout of TOP_LAYOUTS) {
    const reader = new BinaryReader(buffer);
    try {
      const stream = readStream(reader, layout);
      if (reader.tell() === buffer.length) return stream;
      lastError = new Error(`Layout ended at ${reader.tell()} of ${buffer.length} bytes`);
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `Hierarchy stream did not parse to its end: ${lastError instanceof Error ? lastError.message : String(lastError)}`
  );
}

/** Every part occurrence in a scope and the scopes inside it, in stream order. */
export function* walkPartOccurrences(scope: HierarchyScope): Generator<PartOccurrence> {
  yield* scope.parts;
  for (const block of scope.blocks) yield* walkPartOccurrences(block.scope);
}

/** Every block occurrence in a scope and the scopes inside it, in stream order. */
export function* walkBlockOccurrences(scope: HierarchyScope): Generator<BlockOccurrence> {
  for (const block of scope.blocks) {
    yield block;
    yield* walkBlockOccurrences(block.scope);
  }
}

/**
 * Map every occurrence id in `streams` to the refdes the parser reports for it.
 *
 * An occurrence that annotates a reference reports that. One that records none
 * reports the inline reference of the instance it stands for, which is what a
 * design that was never re-annotated carries. The CIS variant store names its
 * members by occurrence id, so this is what its Do Not Stuff set resolves through.
 */
export function buildOccurrenceRefdes(
  streams: readonly HierarchyStream[],
  inlineReference: ReadonlyMap<number, string>
): Map<number, string> {
  const refdes = new Map<number, string>();
  for (const stream of streams) {
    for (const part of walkPartOccurrences(stream.scope)) {
      const reference = part.reference || inlineReference.get(part.dbId);
      if (reference) refdes.set(part.occurrenceId, reference);
    }
  }
  return refdes;
}
