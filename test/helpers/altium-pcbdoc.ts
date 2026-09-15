/**
 * The compiled netlist a `.PcbDoc` carries, read for cross-checking the
 * schematic parser against Altium's own result.
 *
 * `Nets6/Data` and `Components6/Data` are length-prefixed `|KEY=VALUE` text
 * records. `Pads6/Data` is binary: each pad is a type byte followed by six
 * length-prefixed blocks, the first holding the pad name as a Pascal string
 * and the fifth the primitive header, where the net index sits at byte 3 and
 * the component index at byte 7, both little-endian int16 and -1 when unset.
 */
import { OleReader } from "../../src/parsers/ole-reader/ole-reader.js";

export interface BoardNetlist {
  /** `<refdes>.<pad>` -> the nets its pads are on; a footprint can repeat a pad name. */
  pinNets: Map<string, Set<string>>;
  /** Net name -> the `<refdes>.<pad>` pins on it. */
  netPins: Map<string, Set<string>>;
  netCount: number;
}

const textRecords = (ole: OleReader, stream: string): Record<string, string>[] => {
  const data = ole.readStreamByPath(stream);
  const records: Record<string, string>[] = [];
  let pos = 0;
  while (pos + 4 <= data.length) {
    const length = data.readUInt32LE(pos);
    pos += 4;
    const text = data
      .subarray(pos, pos + length)
      .toString("latin1")
      .replace(/\0+$/, "");
    pos += length;
    const record: Record<string, string> = {};
    for (const pair of text.split("|")) {
      const eq = pair.indexOf("=");
      if (eq > 0) record[pair.slice(0, eq).toUpperCase()] = pair.slice(eq + 1);
    }
    records.push(record);
  }
  return records;
};

/**
 * The designator each component carries on the board, by component index.
 *
 * `Components6` records only the logical designator (`SOURCEDESIGNATOR`), which
 * every channel of a multi-channel sheet shares: the FMC-DIO board places
 * `IC49` thirty-two times. The physical designator Altium expanded it to
 * (`IC49A` ... `IC49\``) is the component's designator string in `Texts6`, a
 * record that names its component and, among that component's strings, is the
 * one that starts with the logical designator. Only a channel suffix is
 * accepted after it (letters, `_`, and the characters Altium counts past `Z`),
 * so a comment such as `R1 0R` or a re-annotated `R12` cannot rename `R1`. A
 * component with no such string keeps its logical designator.
 */
const CHANNEL_SUFFIX = /^[A-Za-z_[\]\\^`][A-Za-z0-9_[\]\\^`]*$/;

const boardDesignators = (ole: OleReader, sources: readonly string[]): string[] => {
  const designators = [...sources];
  const exact = new Set<number>();
  const texts = ole.readStreamByPath("Texts6/Data");
  let pos = 0;
  while (pos + 5 <= texts.length) {
    const type = texts[pos];
    pos += 1;
    const headerLength = texts.readUInt32LE(pos);
    pos += 4;
    const header = texts.subarray(pos, pos + headerLength);
    pos += headerLength;
    if (pos + 4 > texts.length) break;
    const textLength = texts.readUInt32LE(pos);
    pos += 4;
    const block = texts.subarray(pos, pos + textLength);
    pos += textLength;
    // Only the text primitive (type 5) is read; anything else is skipped whole.
    if (type !== 5 || header.length < 9 || block.length === 0) continue;
    const component = header.readInt16LE(7);
    if (component < 0 || component >= sources.length) continue;
    const text = block.subarray(1, 1 + block[0]).toString("latin1");
    const source = sources[component];
    if (text === source) {
      exact.add(component);
      designators[component] = text;
    } else if (
      !exact.has(component) &&
      text.startsWith(source) &&
      CHANNEL_SUFFIX.test(text.slice(source.length))
    ) {
      designators[component] = text;
    }
  }
  return designators;
};

export const readBoardNetlist = (pcbDocPath: string): BoardNetlist => {
  const ole = new OleReader(pcbDocPath);
  const nets = textRecords(ole, "Nets6/Data").map((record) => record.NAME);
  const components = boardDesignators(
    ole,
    textRecords(ole, "Components6/Data").map((record) => record.SOURCEDESIGNATOR)
  );
  const pads = ole.readStreamByPath("Pads6/Data");
  const pinNets = new Map<string, Set<string>>();
  const netPins = new Map<string, Set<string>>();
  let pos = 0;
  while (pos < pads.length) {
    const type = pads[pos];
    pos += 1;
    if (type !== 2) throw new Error(`Unexpected pad record type ${type} at ${pos - 1}`);
    const blocks: Buffer[] = [];
    for (let i = 0; i < 6 && pos + 4 <= pads.length; i++) {
      const length = pads.readUInt32LE(pos);
      pos += 4;
      blocks.push(pads.subarray(pos, pos + length));
      pos += length;
    }
    const name = blocks[0].subarray(1, 1 + blocks[0][0]).toString("latin1");
    const header = blocks[4];
    const net = header.readInt16LE(3);
    const component = header.readInt16LE(7);
    if (net < 0 || component < 0) continue;
    const refdes = components[component];
    const netName = nets[net];
    if (!refdes || !netName) continue;
    const pin = `${refdes}.${name}`;
    (pinNets.get(pin) ?? pinNets.set(pin, new Set()).get(pin)!).add(netName);
    (netPins.get(netName) ?? netPins.set(netName, new Set()).get(netName)!).add(pin);
  }
  return { pinNets, netPins, netCount: nets.length };
};

export interface BoardComparison {
  /** Pins present in both the schematic netlist and the board. */
  sharedPins: number;
  /** Shared pins whose net is called the same in both. */
  sameName: number;
  /**
   * Shared pins whose pads sit on more than one board net, which the board cannot place on
   * one; they are left out of the checks below.
   */
  ambiguous: string[];
  /** Board nets whose pins fall into more than one schematic net. */
  fragmented: string[];
  /** Schematic nets whose pins fall into more than one board net. */
  overMerged: string[];
  /** Schematic pins on no net that the board connects to another pad. */
  unconnected: string[];
}

export const compareToBoard = (
  pinNets: ReadonlyMap<string, string>,
  board: BoardNetlist,
  schematicPins: ReadonlySet<string>
): BoardComparison => {
  const boardToSchematic = new Map<string, Set<string>>();
  const schematicToBoard = new Map<string, Set<string>>();
  let sharedPins = 0;
  let sameName = 0;
  const ambiguous: string[] = [];
  for (const [pin, boardNets] of board.pinNets) {
    const schematicNet = pinNets.get(pin);
    if (!schematicNet) continue;
    sharedPins++;
    if (boardNets.has(schematicNet)) sameName++;
    if (boardNets.size > 1) {
      ambiguous.push(pin);
      continue;
    }
    const [boardNet] = boardNets;
    (
      boardToSchematic.get(boardNet) ?? boardToSchematic.set(boardNet, new Set()).get(boardNet)!
    ).add(schematicNet);
    (
      schematicToBoard.get(schematicNet) ??
      schematicToBoard.set(schematicNet, new Set()).get(schematicNet)!
    ).add(boardNet);
  }
  const fragmented = [...boardToSchematic]
    .filter(([, nets]) => nets.size > 1)
    .map(([name]) => name)
    .sort();
  const overMerged = [...schematicToBoard]
    .filter(([, nets]) => nets.size > 1)
    .map(([name]) => name)
    .sort();
  const unconnected = [...board.pinNets]
    .filter(
      ([pin, nets]) =>
        schematicPins.has(pin) &&
        !pinNets.has(pin) &&
        [...nets].some((net) => board.netPins.get(net)!.size > 1)
    )
    .map(([pin]) => pin)
    .sort();
  return { sharedPins, sameName, ambiguous: ambiguous.sort(), fragmented, overMerged, unconnected };
};
