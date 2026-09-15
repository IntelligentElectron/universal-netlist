/** Altium schematic records, and the nets a sheet's records form. */

/** The `RECORD` number of every object a netlist is read from. */
export const RECORD_TYPES = {
  COMPONENT: "1",
  PIN: "2",
  SHEET_SYMBOL: "15",
  SHEET_ENTRY: "16",
  POWER_PORT: "17",
  PORT: "18",
  NET_LABEL: "25",
  BUS: "26",
  WIRE: "27",
  SHEET: "31",
  SHEET_NAME: "32",
  SHEET_FILE_NAME: "33",
  DESIGNATOR: "34",
  BUS_ENTRY: "37",
  PARAMETER: "41",
  HARNESS_CONNECTOR: "215",
  HARNESS_ENTRY: "216",
  SIGNAL_HARNESS: "218",
} as const;

/** A record's fields as written, and what reading its sheet attaches to them. */
export interface RecordFields {
  RECORD?: string;
  /** The harness signal a harness entry carries. */
  harnessSignal?: string;
  /** The net name a labelled signal harness gives a harness entry's net. */
  harnessNetName?: string;
  [key: string]: unknown;
}

/** A record placed in its sheet. */
export interface AltiumRecord extends RecordFields {
  /** Position in the sheet's record list, which `OwnerIndex` counts. */
  index: number;
  /** The records this one owns. */
  children?: AltiumRecord[];
  /** Connection points, in scaled units. */
  coords?: [number, number][];
}

/** A sheet's records: `header` holds the `HEADER` record, `records` the objects. */
export interface AltiumSchematic {
  header: AltiumRecord[];
  records: AltiumRecord[];
}

/** The kind of object a net's name comes from; `pin` is a name built from a pin. */
export type NetNameSource = "power" | "harness" | "label" | "port" | "entry" | "pin";

/** A set of records connected on one sheet. */
export interface AltiumNet {
  name: string | null;
  nameSource?: NetNameSource;
  /**
   * The pin a `pin` name was built from. A channel rebuilds the name around its own
   * designator, and a designator may itself contain `_`.
   */
  pinNameSource?: { refdes: string; pin: string };
  devices: AltiumRecord[];
  /** The range identifiers this net reaches through a bus, one per member name. */
  busCarriers?: BusCarrier[];
}

/** A bus member's claim on a range identifier: `AD3` on the port `AD[0..7]`. */
export interface BusCarrier {
  /** The port, sheet entry or harness entry written as a range or `Repeat(NAME)`. */
  device: AltiumRecord;
  /** The member name, as the net's label spells it. */
  member: string;
  /** The channel a `Repeat(NAME)` entry hands the member to. */
  channel?: number;
}
