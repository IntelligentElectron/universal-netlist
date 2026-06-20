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

/**
 * Field names (case-insensitive, normalized) that hold a manufacturer part number.
 * KiCad MPN fields are user-named, so we accept the common spellings.
 */
const MPN_FIELD_NAMES = new Set(
  [
    "mpn",
    "manufacturer part number",
    "manufacturer_part_number",
    "mfr part #",
    "mfr. part #",
    "mfrpart",
    "part number",
    "partnumber",
    "manufacturerpartnumber",
  ].map((s) => s.toLowerCase())
);

/** Normalize a field/property name for case-insensitive matching. */
const normalizeKey = (s: string): string => s.trim().toLowerCase();

/**
 * Read the string value of a `(field (name "X") "value")` node.
 * The value is the first bare string child after the `(name ...)` sub-list,
 * and may be absent (e.g. `(field (name "Footprint"))`).
 */
const fieldValue = (field: SExpr[]): string | undefined =>
  field.slice(1).find((c): c is string => typeof c === "string");

/**
 * Look up a named value in a comp's `fields` container and top-level
 * `property` children, returning the first non-empty match. `property` uses
 * `(value "...")`; `field` uses a trailing bare string.
 */
const lookupNamed = (comp: SExpr[], matches: (name: string) => boolean): string | undefined => {
  const fields = childByTag(comp, "fields");
  if (fields) {
    for (const field of childrenByTag(fields, "field")) {
      const name = childString(field, "name");
      if (name && matches(normalizeKey(name))) {
        const value = fieldValue(field);
        if (value && value.trim()) return value.trim();
      }
    }
  }
  for (const property of childrenByTag(comp, "property")) {
    const name = childString(property, "name");
    if (name && matches(normalizeKey(name))) {
      const value = childString(property, "value");
      if (value && value.trim()) return value.trim();
    }
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
 */
const pinName = (pinfunction: string | undefined, pinNumber: string): string | undefined => {
  if (!pinfunction) return undefined;
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
  for (const comp of childrenByTag(componentsNode, "comp")) {
    const refdes = childString(comp, "ref");
    if (!refdes) continue;

    const entry: ComponentDetails[string] = { pins: {} };

    const value = childString(comp, "value");
    if (value && value.trim()) entry.value = value.trim();

    const description = componentDescription(comp);
    if (description) entry.description = description;

    const mpn = lookupNamed(comp, (name) => MPN_FIELD_NAMES.has(name));
    if (mpn) entry.mpn = mpn;

    if (isDnp(comp)) entry.dns = true;

    components[refdes] = entry;
  }

  // --- Nets + pin assignment ---------------------------------------------
  const netsNode = childByTag(root, "nets");
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
      const component = components[refdes] ?? { pins: {} };
      const name = pinName(childString(node, "pinfunction"), pin);
      component.pins[pin] = createPinEntry(pin, name, netName);
      components[refdes] = component;
    }

    nets[netName] = membership;
  }

  return { nets, components };
};
