/**
 * The `.PrjPcb` options that decide how a project's sheets connect and what nets are
 * called.
 */

/**
 * The net identifier scope:
 * - `global`: net labels and ports join by name across every sheet.
 * - `flat`: ports join by name across sheets; net labels stay on their sheet.
 * - `hierarchical`: a port meets only the entry of its name on the symbol placing its
 *   sheet; net labels stay on their sheet; power ports are global.
 * - `strict-hierarchical`: as `hierarchical`, with power ports local too.
 */
export type NetIdentifierScope = "global" | "flat" | "hierarchical" | "strict-hierarchical";

export interface AltiumProjectOptions {
  /** The scope `HierarchyMode` sets; undefined for Automatic. */
  scope: NetIdentifierScope | undefined;
  appendSheetNumberToLocalNets: boolean;
  allowPortNetNames: boolean;
  powerPortNamesTakePriority: boolean;
  /** `ChannelDesignatorFormatString`. */
  channelFormat: string;
  /** `ChannelRoomNamingStyle`; `1` numbers rooms with letters. */
  roomNamingStyle: string;
}

/**
 * `HierarchyMode` values and their scope: `0` Automatic, `2` Hierarchical, `3` Global, `4`
 * Strict Hierarchical. Any other value is read as Automatic.
 */
const HIERARCHY_MODE_SCOPE: Readonly<Record<string, NetIdentifierScope>> = {
  "2": "hierarchical",
  "3": "global",
  "4": "strict-hierarchical",
};

export const DEFAULT_CHANNEL_FORMAT = "$Component_$RoomName";

/** One `Key=Value` line of a project file, anywhere in the file. */
const readKey = (lines: readonly string[], key: string): string | undefined => {
  const pattern = new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`, "i");
  for (const line of lines) {
    const match = line.match(pattern);
    if (match) return match[1].trim();
  }
  return undefined;
};

/** A `0`/`1` option, or Altium's default when unwritten. */
const readFlag = (lines: readonly string[], key: string, fallback: boolean): boolean => {
  const value = readKey(lines, key);
  return value === undefined || value === "" ? fallback : value !== "0";
};

/** Parse a `.PrjPcb`'s netlisting options. */
export const parseProjectOptions = (content: string): AltiumProjectOptions => {
  const lines = content.split(/\r?\n/);
  const hierarchyMode = readKey(lines, "HierarchyMode");
  return {
    scope: hierarchyMode ? HIERARCHY_MODE_SCOPE[hierarchyMode] : undefined,
    appendSheetNumberToLocalNets: readFlag(lines, "AppendSheetNumberToLocalNets", false),
    allowPortNetNames: readFlag(lines, "AllowPortNetNames", false),
    powerPortNamesTakePriority: readFlag(lines, "PowerPortNamesTakePriority", false),
    channelFormat: readKey(lines, "ChannelDesignatorFormatString") || DEFAULT_CHANNEL_FORMAT,
    roomNamingStyle: readKey(lines, "ChannelRoomNamingStyle") || "0",
  };
};

/** What a project draws, which Automatic reads. */
export interface DesignShape {
  hasSheetEntries: boolean;
  hasPorts: boolean;
}

/** The scope a project resolves to: Automatic picks Hierarchical, Flat or Global by shape. */
export const resolveNetIdentifierScope = (
  options: AltiumProjectOptions,
  shape: DesignShape
): NetIdentifierScope =>
  options.scope ?? (shape.hasSheetEntries ? "hierarchical" : shape.hasPorts ? "flat" : "global");

/** Whether net labels join across sheets: under Global only. */
export const netLabelsAreGlobal = (scope: NetIdentifierScope): boolean => scope === "global";

/** Whether power ports join across sheets: under every scope but Strict Hierarchical. */
export const powerPortsAreGlobal = (scope: NetIdentifierScope): boolean =>
  scope !== "strict-hierarchical";
