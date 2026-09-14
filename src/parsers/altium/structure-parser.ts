/**
 * Altium PrjPCBStructure Parser
 *
 * Parses the pipe-delimited PrjPCBStructure file that describes
 * hierarchical sheet relationships and multi-channel instances.
 */

export interface SheetInstance {
  /** Parent SchDoc containing this sheet symbol */
  sourceDocument: string;
  /** Channel designator (e.g., "AY1") */
  designator: string;
  /** SchDesignator field (e.g., "Repeat(AY,1,3)") */
  schDesignator: string;
  /** Child SchDoc file name (e.g., "ay.SchDoc") */
  fileName: string;
}

export interface ProjectStructure {
  topLevelDocument: string;
  sheetInstances: SheetInstance[];
}

/**
 * Parse a PrjPCBStructure file into a ProjectStructure.
 *
 * The file format is pipe-delimited key=value pairs, one record per line.
 * Example:
 *   Record=TopLevelDocument|FileName=main.SchDoc
 *   Record=SheetSymbol|SourceDocument=main.SchDoc|Designator=AY1|...
 */
export const parseProjectStructure = (content: string): ProjectStructure => {
  const result: ProjectStructure = {
    topLevelDocument: "",
    sheetInstances: [],
  };

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const fields = new Map<string, string>();
    for (const part of trimmed.split("|")) {
      const eqIdx = part.indexOf("=");
      if (eqIdx === -1) continue;
      const key = part.slice(0, eqIdx).trim();
      const value = part.slice(eqIdx + 1).trim();
      fields.set(key, value);
    }

    const recordType = fields.get("Record");
    if (!recordType) continue;

    if (recordType === "TopLevelDocument") {
      result.topLevelDocument = fields.get("FileName") ?? "";
    } else if (recordType === "SheetSymbol") {
      const sourceDocument = fields.get("SourceDocument") ?? "";
      const designator = fields.get("Designator") ?? "";
      const schDesignator = fields.get("SchDesignator") ?? "";
      const fileName = fields.get("FileName") ?? "";

      if (fileName) {
        result.sheetInstances.push({
          sourceDocument,
          designator,
          schDesignator,
          fileName,
        });
      }
    }
  }

  return result;
};

/**
 * A sheet symbol designator that instantiates a sheet once per channel.
 *
 * Altium writes the range with inconsistent spacing across real projects —
 * `Repeat(AY,1,3)`, `Repeat(ideal_diode, 1, 2)`, `Repeat(CHAN, 1,9)` — so every
 * separator tolerates surrounding whitespace.
 */
const REPEAT_SHEET_DESIGNATOR = /^Repeat\(\s*([^,)]+?)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i;

/** One channel of a `Repeat()` sheet symbol. */
export interface RepeatChannel {
  designator: string;
  /**
   * The number in the designator, `2` for `AY2`. A `Repeat(NAME)` sheet entry
   * on the symbol hands this channel the bus member `NAME2`.
   */
  index: number;
}

/**
 * Expand a `Repeat(name,start,end)` sheet symbol designator into one channel
 * per instance: `Repeat(AY,1,3)` gives `AY1`, `AY2`, `AY3`, with indices 1 to 3.
 *
 * Returns an empty array for anything that is not a repeat, or for a range that
 * yields fewer than two channels: a single instance is not multi-channel.
 */
export const expandRepeatChannels = (schDesignator: string): RepeatChannel[] => {
  const match = schDesignator.trim().match(REPEAT_SHEET_DESIGNATOR);
  if (!match) return [];

  const [, base, startText, endText] = match;
  const start = Number.parseInt(startText, 10);
  const end = Number.parseInt(endText, 10);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];

  const channels: RepeatChannel[] = [];
  for (let index = start; index <= end; index++) {
    channels.push({ designator: `${base}${index}`, index });
  }
  return channels;
};

/** The name of a `Repeat(name,start,end)` designator, `AY` for `Repeat(AY,1,3)`. */
export const repeatSheetName = (schDesignator: string): string | undefined =>
  schDesignator.trim().match(REPEAT_SHEET_DESIGNATOR)?.[1];

/** The channel designators alone: `Repeat(AY,1,3)` gives `AY1`, `AY2`, `AY3`. */
export const expandRepeatDesignator = (schDesignator: string): string[] =>
  expandRepeatChannels(schDesignator).map((channel) => channel.designator);

/**
 * Identify repeated (multi-channel) sheets.
 *
 * Returns a map from fileName to the list of channel designators.
 * Only sheets with 2+ instances are included (single-instance sheets are not multi-channel).
 */
export const findRepeatedSheets = (structure: ProjectStructure): Map<string, SheetInstance[]> => {
  const byFile = new Map<string, SheetInstance[]>();

  for (const instance of structure.sheetInstances) {
    const key = instance.fileName.toLowerCase();
    if (!byFile.has(key)) {
      byFile.set(key, []);
    }
    byFile.get(key)!.push(instance);
  }

  // Only return files with multiple instances
  const repeated = new Map<string, SheetInstance[]>();
  for (const [key, instances] of byFile) {
    if (instances.length > 1) {
      repeated.set(key, instances);
    }
  }

  return repeated;
};
