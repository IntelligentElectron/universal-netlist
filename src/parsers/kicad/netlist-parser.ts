/**
 * Parse a KiCad `kicadsexpr` netlist export into the unified ParsedNetlist.
 *
 * The export is produced by `kicad-cli sch export netlist --format kicadsexpr`.
 * It is a fully-resolved netlist: connectivity (wires, junctions, labels, buses,
 * hierarchical sheets) has already been flattened by KiCad into explicit
 * `(net ...)` membership, and per-instance reference designators are assigned.
 * This parser therefore only has to map fields, not reconstruct topology.
 *
 * Export shape (abridged):
 *   (export (version "E")
 *     (components
 *       (comp (ref "R1") (value "10k") (description "Resistor")
 *         (fields (field (name "MPN") "RC0402..."))
 *         (libsource (lib "Device") (part "R") (description "Resistor"))
 *         (property (name "dnp"))            ; marker → Do Not Populate
 *         ...))
 *     (nets
 *       (net (code "1") (name "GND")
 *         (node (ref "R1") (pin "2") (pinfunction "~") (pintype "passive")))))
 */

import {
  parseSexpr,
  tag,
  childByTag,
  childrenByTag,
  childString,
  isList,
  type SExpr,
} from "./sexpr.js";
import {
  createPinEntry,
  type ParsedNetlist,
  type ComponentDetails,
  type NetConnections,
} from "../../types.js";

/** Ignore case and spelling separators, but retain meaningful punctuation like # and /. */
const normalizeKey = (s: string): string => s.toLowerCase().replace(/[\s_.-]/g, "");

/** Manufacturer fields in precedence order, independent of their order in the file. */
const MPN_FIELD_NAMES = [
  "Manufacturer Part Number",
  "Manufacturer PN",
  "Manufacturer P/N",
  "Manufacturer Part No",
  "Manufacturer Part Num",
  "Manufacturer Part #",
  "Manufacturers Part Number",
  "Manufacturer Part",
  "MFR Part Number",
  "MFR Part Num",
  "MFR Part #",
  "MFRPART",
  "MFGR PN",
  "MFG Part Number",
  "MFG Part No",
  "MFG Part #",
  "MFG PN",
  "MFG P/N",
  "MPN",
].map(normalizeKey);

/**
 * Explicit internal identifiers take precedence over generic part numbers.
 * A generic PartNumber names the design's part; it does not establish that a
 * manufacturer assigned the number, even when its value happens to be an MPN.
 */
const INTERNAL_PN_FIELD_NAMES = [
  "Internal Part Number",
  "Internal PN",
  "Internal P/N",
  "Internal Ref",
  "CUST PART NUMBER",
  "Customer Part Number",
  "Part Number",
  "PN",
].map(normalizeKey);

/**
 * Field names (case-insensitive, normalized) that hold a manufacturer's name.
 * KiCad field names are user-chosen, so the common spellings are accepted.
 */
const MANUFACTURER_FIELD_NAMES = [
  "Manufacturer",
  "Manufacturer Name",
  "MFR Name",
  "MFGR Name",
  "MFG Name",
  "MFR",
  "MFG",
  "Make",
].map(normalizeKey);

/**
 * Read the string value of a `(field (name "X") "value")` node.
 * The value is the first bare string child after the `(name ...)` sub-list,
 * and may be absent (e.g. `(field (name "Footprint"))`).
 */
const fieldValue = (field: SExpr[]): string | undefined =>
  field.slice(1).find((c): c is string => typeof c === "string");

/**
 * Collect non-empty values from both export spellings. A field wins over a
 * duplicate property of the same name; an empty field cannot hide a property.
 */
const namedValues = (comp: SExpr[]): Map<string, string> => {
  const values = new Map<string, string>();
  const add = (name: string | undefined, value: string | undefined): void => {
    if (!name || !value?.trim()) return;
    const key = normalizeKey(name);
    if (!values.has(key)) values.set(key, value.trim());
  };
  const fields = childByTag(comp, "fields");
  if (fields) {
    for (const field of childrenByTag(fields, "field")) {
      add(childString(field, "name"), fieldValue(field));
    }
  }
  for (const property of childrenByTag(comp, "property")) {
    add(childString(property, "name"), childString(property, "value"));
  }
  return values;
};

const lookupNamed = (
  values: ReadonlyMap<string, string>,
  keys: readonly string[]
): string | undefined => {
  for (const key of keys) {
    const value = values.get(key);
    if (value !== undefined) return value;
  }
  return undefined;
};

/**
 * True when the comp carries KiCad's native Do-Not-Populate attribute, emitted
 * as the bare marker `(property (name "dnp"))` — lowercase, with no value child.
 *
 * This is deliberately case-sensitive and value-less: a *user* BOM field such as
 * `(property (name "DNP") (value "DNP"))` is a different thing (a custom column,
 * not the structural attribute) and must NOT be treated as DNP. Only KiCad's own
 * `dnp` attribute drives `dns`, matching how KiCad's BOM/ERC interpret it.
 */
const isDnp = (comp: SExpr[]): boolean =>
  childrenByTag(comp, "property").some(
    (p) => childString(p, "name") === "dnp" && childByTag(p, "value") === undefined
  );

/**
 * Recover the real pin name from a KiCad `pinfunction`. The export composes
 * pinfunction as `<name>_<pinNumber>` (e.g. pin "15" named "PC7" → "PC7_15",
 * pin "1" named "1" → "1_1"). We strip the trailing `_<pinNumber>` to get the
 * symbol's pin name; `createPinEntry` then drops it when it equals the number.
 * KiCad uses a bare "~" for an unnamed pin, which carries no meaning here.
 */
const pinName = (pinfunction: string | undefined, pinNumber: string): string | undefined => {
  if (!pinfunction || pinfunction === "~") return undefined;
  // Strip only a trailing `_<pinNumber>`. A pin number containing an underscore
  // (e.g. "1_2") is non-standard; the length guard below still prevents
  // stripping a name down to empty, and any over-strip is bounded to that quirk.
  const suffix = `_${pinNumber}`;
  if (pinfunction.endsWith(suffix) && pinfunction.length > suffix.length) {
    return pinfunction.slice(0, -suffix.length);
  }
  return pinfunction;
};

/**
 * Resolve a component's description: the comp-level `(description ...)` (which
 * KiCad fills from the symbol), falling back to the libsource description.
 */
const componentDescription = (comp: SExpr[]): string | undefined => {
  const direct = childString(comp, "description");
  if (direct && direct.trim()) return direct.trim();
  const libsource = childByTag(comp, "libsource");
  const lib = libsource ? childString(libsource, "description") : undefined;
  return lib && lib.trim() ? lib.trim() : undefined;
};

/**
 * Parse a kicadsexpr netlist export (file contents) into a ParsedNetlist.
 * Pure function: same input always yields the same output.
 */
export const parseKicadNetlist = (content: string): ParsedNetlist => {
  const top = parseSexpr(content);
  const root = top.find((node) => tag(node) === "export");
  if (!root || !isList(root)) {
    throw new Error("Not a KiCad netlist export: missing top-level (export ...)");
  }

  const components: ComponentDetails = {};
  const nets: NetConnections = {};

  // --- Components ---------------------------------------------------------
  const componentsNode = childByTag(root, "components");
  if (!componentsNode) {
    throw new Error("Malformed KiCad netlist export: missing (components ...) section");
  }
  for (const comp of childrenByTag(componentsNode, "comp")) {
    const refdes = childString(comp, "ref");
    if (!refdes) continue;

    const entry: ComponentDetails[string] = { pins: {} };

    const value = childString(comp, "value");
    if (value && value.trim()) entry.value = value.trim();

    const description = componentDescription(comp);
    if (description) entry.description = description;

    const fields = namedValues(comp);
    const mpn = lookupNamed(fields, MPN_FIELD_NAMES);
    if (mpn) entry.mpn = mpn;

    const internalPn = lookupNamed(fields, INTERNAL_PN_FIELD_NAMES);
    if (internalPn) entry.internal_pn = internalPn;

    // An MPN identifies a part only within a manufacturer, so the name is what
    // makes `mpn` a key rather than a string.
    const manufacturer = lookupNamed(fields, MANUFACTURER_FIELD_NAMES);
    if (manufacturer) entry.manufacturer = manufacturer;

    if (isDnp(comp)) entry.dns = true;

    components[refdes] = entry;
  }

  // --- Nets + pin assignment ---------------------------------------------
  const netsNode = childByTag(root, "nets");
  if (!netsNode) {
    throw new Error("Malformed KiCad netlist export: missing (nets ...) section");
  }
  for (const net of childrenByTag(netsNode, "net")) {
    const netName = childString(net, "name");
    if (!netName) continue;

    const membership: NetConnections[string] = nets[netName] ?? {};

    for (const node of childrenByTag(net, "node")) {
      const refdes = childString(node, "ref");
      const pin = childString(node, "pin");
      if (!refdes || !pin) continue;

      // Net → component pin membership. This builder only ever stores arrays
      // (matching the other parsers), so the cast reflects an invariant of this
      // loop, not a general guarantee of the NetConnections type.
      const pins = (membership[refdes] as string[] | undefined) ?? [];
      pins.push(pin);
      membership[refdes] = pins;

      // Component pin → net mapping, with the symbol pin name when meaningful.
      // A node may reference a refdes absent from (components) in a truncated or
      // malformed export; we intentionally create a bare stub so the connection
      // is not lost (it will simply have no value/mpn/description).
      const component = components[refdes] ?? { pins: {} };
      const name = pinName(childString(node, "pinfunction"), pin);
      component.pins[pin] = createPinEntry(pin, name, netName);
      components[refdes] = component;
    }

    nets[netName] = membership;
  }

  return { nets, components };
};
