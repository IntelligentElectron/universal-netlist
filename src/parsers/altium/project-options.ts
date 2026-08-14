/**
 * Altium Project Options
 *
 * The `[Design]` block of a `.PrjPcb` says how the sheets in a project connect
 * to each other and how the resulting nets are named. Two sheets that both
 * carry a net label `SCL` are one net in some projects and two in others, and
 * the only thing that decides which is the Net Identifier Scope recorded here.
 *
 * Reference: Altium Designer, "Creating Circuit Connectivity in Your
 * Schematics" (Setting the Net Identifier Scope, Options for Controlling the
 * Naming of the Nets).
 */

/**
 * How net identifiers reach from one sheet to another.
 *
 * - `global`: net labels and ports both connect by name across every sheet.
 * - `flat`: ports connect by name across sheets; net labels stay on their sheet.
 * - `hierarchical`: a port connects only upward, to the sheet entry of the same
 *   name in the sheet symbol that instantiates it. Net labels stay on their
 *   sheet; power ports remain global.
 * - `strict-hierarchical`: as `hierarchical`, and power ports are local to a
 *   sheet as well, so every supply is wired down through ports.
 */
export type NetIdentifierScope = "global" | "flat" | "hierarchical" | "strict-hierarchical";

export interface AltiumProjectOptions {
  /** Scope as written in the project, `undefined` when it is left on Automatic. */
  scope: NetIdentifierScope | undefined;
  /** Suffix each sheet-local net with that sheet's `SheetNumber`. */
  appendSheetNumberToLocalNets: boolean;
  /** Ports may name the net they sit on. */
  allowPortNetNames: boolean;
  /** Sheet entries may name the net they sit on. */
  allowSheetEntryNetNames: boolean;
  /** A power port outranks a net label when both name one net. */
  powerPortNamesTakePriority: boolean;
  /** Designator format for multi-channel expansion. */
  channelFormat: string;
}

/**
 * `HierarchyMode` values, in the order the Net Identifier Scope drop-down
 * lists them. `0` is Automatic, which is the default and by far the most
 * common value; a project that names a scope outright has been changed by hand.
 *
 * The mapping is corroborated by the fixtures: the LimeSDR-USB boards record
 * `3` and are drawn with no sheet symbols and no ports at all, so their sheets
 * can only be joined by matching net labels, which is Global; the nRF52840
 * development kit records `2` and is drawn as a full parent/child hierarchy.
 *
 * A value outside this table is read as Automatic, so a mode we have not seen
 * is resolved from the shape of the design rather than guessed at.
 */
const HIERARCHY_MODE_SCOPE: Readonly<Record<string, NetIdentifierScope>> = {
  "1": "flat",
  "2": "hierarchical",
  "3": "global",
  "4": "strict-hierarchical",
};

export const DEFAULT_CHANNEL_FORMAT = "$Component_$RoomName";

/** Read one `Key=Value` line out of an ini-style project file. */
const readKey = (lines: readonly string[], key: string): string | undefined => {
  const pattern = new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`, "i");
  for (const line of lines) {
    const match = line.match(pattern);
    if (match) return match[1].trim();
  }
  return undefined;
};

/**
 * Altium writes these as `0` or `1`. An absent key takes the default Altium
 * itself applies to a project that has never had the option touched.
 */
const readFlag = (lines: readonly string[], key: string, fallback: boolean): boolean => {
  const value = readKey(lines, key);
  if (value === undefined || value === "") return fallback;
  return value !== "0";
};

/**
 * Parse the `[Design]` options out of a `.PrjPcb`.
 *
 * The keys are read from the file as a whole rather than from the `[Design]`
 * section alone: they appear only there, and a project written by an older
 * Altium may omit the section header while keeping the keys.
 */
export const parseProjectOptions = (content: string): AltiumProjectOptions => {
  const lines = content.split(/\r?\n/);
  const hierarchyMode = readKey(lines, "HierarchyMode");

  return {
    scope: hierarchyMode ? HIERARCHY_MODE_SCOPE[hierarchyMode] : undefined,
    appendSheetNumberToLocalNets: readFlag(lines, "AppendSheetNumberToLocalNets", false),
    allowPortNetNames: readFlag(lines, "AllowPortNetNames", false),
    allowSheetEntryNetNames: readFlag(lines, "AllowSheetEntryNetNames", true),
    powerPortNamesTakePriority: readFlag(lines, "PowerPortNamesTakePriority", false),
    channelFormat: readKey(lines, "ChannelDesignatorFormatString") || DEFAULT_CHANNEL_FORMAT,
  };
};

/** What the design is drawn with, which is what Automatic reads to pick a scope. */
export interface DesignShape {
  /** The project draws sheet entries inside its sheet symbols. */
  hasSheetEntries: boolean;
  /** The project draws ports on its sheets. */
  hasPorts: boolean;
}

/**
 * Settle on the scope a project is netlisted under.
 *
 * Automatic is the default, and Altium resolves it from the design itself:
 * sheet entries mean the sheets are joined vertically, so Hierarchical; ports
 * without sheet entries mean they are joined by name across one level, so
 * Flat; neither means nothing but net labels can be doing the joining, so
 * Global.
 */
export const resolveNetIdentifierScope = (
  options: AltiumProjectOptions,
  shape: DesignShape
): NetIdentifierScope => {
  if (options.scope) return options.scope;
  if (shape.hasSheetEntries) return "hierarchical";
  if (shape.hasPorts) return "flat";
  return "global";
};

/**
 * Whether a net label reaches past the sheet it is drawn on.
 *
 * Only Global carries labels between sheets. Under every other scope a label
 * names a net within its own sheet, and a signal leaves the sheet through a
 * port or a power port instead.
 */
export const netLabelsAreGlobal = (scope: NetIdentifierScope): boolean => scope === "global";

/**
 * Whether a power port reaches every sheet in the project.
 *
 * Power ports are global under every scope but Strict Hierarchical, which
 * localizes them so that each supply is wired down through ports like any
 * other signal.
 */
export const powerPortsAreGlobal = (scope: NetIdentifierScope): boolean =>
  scope !== "strict-hierarchical";
