/**
 * How Altium writes names: case, bus ranges and `Repeat()`. A name keeps its overbar
 * escapes: `C\S\` and `CS` are different names.
 */

/** The key a net, port, entry or harness name matches by: ASCII case is ignored. */
export const identifierKey = (name: string): string =>
  name.replace(/[a-z]+/g, (letters) => letters.toUpperCase());

/** `name`, or the first of `name_2`, `name_3`, ... whose key `taken` does not hold. */
export const firstFreeName = (name: string, taken: ReadonlySet<string>): string => {
  let candidate = name;
  for (let n = 2; taken.has(identifierKey(candidate)); n++) candidate = `${name}_${n}`;
  return candidate;
};

const RANGE = /^(.+)\[(\d+)\.\.(\d+)\]$/;
const REPEAT_ENTRY = /^Repeat\((.+)\)$/i;
const REPEAT_SYMBOL = /^Repeat\(\s*([^,)]+?)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i;

/** A range identifier's prefix and bounds: `AD[0..11]` is `AD`, 0, 11. */
const parseRange = (name: string): { prefix: string; start: number; end: number } | undefined => {
  const range = name.match(RANGE);
  return range
    ? { prefix: range[1], start: parseInt(range[2], 10), end: parseInt(range[3], 10) }
    : undefined;
};

/** The prefix of a range identifier, `AD` for `AD[0..11]`. */
export const rangePrefix = (name: string): string | undefined => parseRange(name)?.prefix;

/** Every member of a range, in written order: `AD[0..2]` is `AD0`, `AD1`, `AD2`. */
export const expandBusRange = (name: string): string[] => {
  const range = parseRange(name);
  if (!range) return [];
  const step = range.start <= range.end ? 1 : -1;
  const members: string[] = [];
  for (let index = range.start; index !== range.end + step; index += step) {
    members.push(`${range.prefix}${index}`);
  }
  return members;
};

/** The base name of a `Repeat(NAME)` entry, or undefined for any other name. */
export const repeatBaseName = (name: string): string | undefined =>
  name.match(REPEAT_ENTRY)?.[1].trim();

/**
 * The members a range identifier carries, as a test on a label, ignoring case.
 * `AD[0..11]` carries `AD0` to `AD11`; `Repeat(NAME)` carries `NAME<n>` for any `n`,
 * the symbol deciding which channels exist. Undefined for any other name.
 */
export const busMemberTest = (name: string): ((label: string) => boolean) | undefined => {
  const range = parseRange(name);
  const prefix = range?.prefix ?? repeatBaseName(name);
  if (prefix === undefined) return undefined;
  const prefixKey = identifierKey(prefix);
  const low = range ? Math.min(range.start, range.end) : -Infinity;
  const high = range ? Math.max(range.start, range.end) : Infinity;
  return (label) => {
    if (!identifierKey(label).startsWith(prefixKey)) return false;
    const rest = label.slice(prefix.length);
    if (!/^\d+$/.test(rest)) return false;
    const index = parseInt(rest, 10);
    return index >= low && index <= high;
  };
};

/** One channel of a `Repeat(NAME,start,end)` sheet symbol: `AY2`, index 2. */
export interface RepeatChannel {
  designator: string;
  index: number;
}

/**
 * The channels of a `Repeat(NAME,start,end)` symbol designator, one per index. Empty
 * for any other designator, and for a range of fewer than two.
 */
export const repeatChannels = (designator: string): RepeatChannel[] => {
  const match = designator.trim().match(REPEAT_SYMBOL);
  if (!match) return [];
  const [, name, startText, endText] = match;
  const start = parseInt(startText, 10);
  const end = parseInt(endText, 10);
  const channels: RepeatChannel[] = [];
  for (let index = start; index <= end && end > start; index++) {
    channels.push({ designator: `${name}${index}`, index });
  }
  return channels;
};

/** `NAME` of a `Repeat(NAME,start,end)` symbol designator. */
export const repeatSheetName = (designator: string): string | undefined =>
  designator.trim().match(REPEAT_SYMBOL)?.[1];
