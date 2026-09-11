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
  /** `<refdes>.<pad>` -> net name, for every pad on a net. */
  pinNets: Map<string, string>;
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

export const readBoardNetlist = (pcbDocPath: string): BoardNetlist => {
  const ole = new OleReader(pcbDocPath);
  const nets = textRecords(ole, "Nets6/Data").map((record) => record.NAME);
  const components = textRecords(ole, "Components6/Data").map((record) => record.SOURCEDESIGNATOR);
  const pads = ole.readStreamByPath("Pads6/Data");
  const pinNets = new Map<string, string>();
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
    if (refdes && netName) pinNets.set(`${refdes}.${name}`, netName);
  }
  return { pinNets, netCount: nets.length };
};

export interface BoardComparison {
  /** Pins present in both the schematic netlist and the board. */
  sharedPins: number;
  /** Shared pins whose net is called the same in both. */
  sameName: number;
  /** Board nets whose pins fall into more than one schematic net. */
  fragmented: string[];
  /** Schematic nets whose pins fall into more than one board net. */
  overMerged: string[];
}

export const compareToBoard = (
  pinNets: ReadonlyMap<string, string>,
  board: BoardNetlist
): BoardComparison => {
  const boardToSchematic = new Map<string, Set<string>>();
  const schematicToBoard = new Map<string, Set<string>>();
  let sharedPins = 0;
  let sameName = 0;
  for (const [pin, boardNet] of board.pinNets) {
    const schematicNet = pinNets.get(pin);
    if (!schematicNet) continue;
    sharedPins++;
    if (schematicNet === boardNet) sameName++;
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
  return { sharedPins, sameName, fragmented, overMerged };
};
