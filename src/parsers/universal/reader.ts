/**
 * Universal Netlist reader.
 *
 * Reads a file that is already in the Universal Netlist shape
 * (docs/schemas/universal-netlist.md) and validates it before any tool sees it.
 * The EDA parsers build a consistent netlist by construction. This reader is
 * handed a file that anyone may have written or edited, so it checks that
 * `nets` and `components` are exact inverses of each other and that every
 * reference resolves, and it refuses the file on the first mismatch, naming it.
 */

import type { ComponentDetails, NetConnections, ParsedNetlist, PinEntry } from "../../types.js";

/** A file that is not a valid Universal Netlist. The message names the defect. */
export class UniversalNetlistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UniversalNetlistError";
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Whether a parsed JSON value has the top-level shape of a Universal Netlist. */
export const hasUniversalShape = (
  value: unknown
): value is { nets: Record<string, unknown>; components: Record<string, unknown> } =>
  isObject(value) && isObject(value.nets) && isObject(value.components);

const TOP_LEVEL_KEYS = new Set(["nets", "components"]);
const COMPONENT_TEXT_FIELDS = ["mpn", "description", "comment", "value"] as const;

/**
 * Read a pin entry's net name. `""` is how the EDA parsers write a pin that is
 * connected to nothing; `loadNetlist` normalizes it to `NC` after parsing.
 */
const netOf = (entry: PinEntry): string => (typeof entry === "string" ? entry : entry.net);

/**
 * Validate a parsed JSON value as a Universal Netlist and return it typed.
 *
 * `source` names the file in error messages. Fields the schema does not define
 * on a component are dropped; the two top-level keys are the only ones allowed.
 * A net member written as one pin number string is read as a one-element array,
 * which is the form every tool works on.
 */
export const validateUniversalNetlist = (raw: unknown, source = "netlist"): ParsedNetlist => {
  const fail: (message: string) => never = (message) => {
    throw new UniversalNetlistError(`${source}: ${message}`);
  };

  if (!hasUniversalShape(raw)) {
    fail("not a Universal Netlist: the top level must be an object with `nets` and `components` objects");
  }
  const root = raw as { nets: Record<string, unknown>; components: Record<string, unknown> };
  for (const key of Object.keys(root)) {
    if (!TOP_LEVEL_KEYS.has(key)) {
      fail(`unexpected top-level key '${key}'; a Universal Netlist has only \`nets\` and \`components\``);
    }
  }

  // Components: shape of every entry, and the pin map each one declares.
  const components: ComponentDetails = {};
  for (const [refdes, body] of Object.entries(root.components)) {
    if (!refdes) fail("a component has an empty reference designator");
    if (!isObject(body)) fail(`component '${refdes}' must be an object`);
    if (!isObject(body.pins)) fail(`component '${refdes}' has no \`pins\` object`);
    for (const field of COMPONENT_TEXT_FIELDS) {
      if (body[field] !== undefined && typeof body[field] !== "string") {
        fail(`component '${refdes}' field '${field}' must be a string`);
      }
    }
    if (body.dns !== undefined && typeof body.dns !== "boolean") {
      fail(`component '${refdes}' field 'dns' must be a boolean`);
    }

    const pins: Record<string, PinEntry> = {};
    for (const [pin, entry] of Object.entries(body.pins)) {
      if (!pin) fail(`component '${refdes}' has a pin with an empty number`);
      if (typeof entry === "string") {
        pins[pin] = entry;
      } else if (
        isObject(entry) &&
        typeof entry.name === "string" &&
        typeof entry.net === "string" &&
        Object.keys(entry).length === 2
      ) {
        pins[pin] = { name: entry.name, net: entry.net };
      } else {
        fail(`pin ${refdes}.${pin} must be a net name or an object with exactly \`name\` and \`net\``);
      }
    }

    const component: ComponentDetails[string] = { pins };
    for (const field of COMPONENT_TEXT_FIELDS) {
      if (typeof body[field] === "string") component[field] = body[field];
    }
    if (body.dns === true) component.dns = true;
    components[refdes] = component;
  }

  // Nets: shape of every member list.
  const nets: NetConnections = {};
  for (const [net, members] of Object.entries(root.nets)) {
    if (!net) fail("a net has an empty name");
    if (!isObject(members)) fail(`net '${net}' must be an object mapping refdes to pin number(s)`);
    const out: Record<string, string[]> = {};
    for (const [refdes, value] of Object.entries(members)) {
      if (!refdes) fail(`net '${net}' lists a member with an empty reference designator`);
      const list =
        typeof value === "string"
          ? [value]
          : Array.isArray(value) && value.every((p) => typeof p === "string")
            ? (value as string[])
            : fail(`net '${net}' member '${refdes}' must be a pin number or an array of pin numbers`);
      if (list.length === 0) fail(`net '${net}' lists ${refdes} with no pins`);
      if (list.some((p) => !p)) fail(`net '${net}' lists ${refdes} with an empty pin number`);
      const seen = new Set<string>();
      for (const pin of list) {
        if (seen.has(pin)) fail(`net '${net}' lists ${refdes}.${pin} twice`);
        seen.add(pin);
      }
      out[refdes] = [...list];
    }
    nets[net] = out;
  }

  // nets -> components: every listed pin exists and points back at this net.
  for (const [net, members] of Object.entries(nets)) {
    for (const [refdes, value] of Object.entries(members)) {
      const component = components[refdes];
      if (!component) fail(`net '${net}' lists ${refdes}, but no component '${refdes}' is declared`);
      for (const pin of value) {
        const entry = component.pins[pin];
        if (entry === undefined) {
          fail(`net '${net}' lists ${refdes}.${pin}, but ${refdes} declares no pin '${pin}'`);
        }
        const actual = netOf(entry);
        if (actual !== net) {
          const where = actual === "" ? "is unconnected" : `is on '${actual}'`;
          fail(`net '${net}' lists ${refdes}.${pin}, but ${refdes}.${pin} ${where}`);
        }
      }
    }
  }

  // components -> nets: every connected pin is listed under its net.
  for (const [refdes, component] of Object.entries(components)) {
    for (const [pin, entry] of Object.entries(component.pins)) {
      const net = netOf(entry);
      if (net === "") continue; // an unconnected pin belongs to no net
      const members = nets[net];
      if (!members) fail(`${refdes}.${pin} is on '${net}', but no net '${net}' is declared`);
      if (!(members[refdes] ?? []).includes(pin)) {
        fail(`${refdes}.${pin} is on '${net}', but net '${net}' does not list it`);
      }
    }
  }

  return { nets, components };
};

/** Parse JSON text as a Universal Netlist. `source` names the file in errors. */
export const parseUniversalNetlist = (text: string, source = "netlist"): ParsedNetlist => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new UniversalNetlistError(`${source}: not valid JSON (${detail})`);
  }
  return validateUniversalNetlist(raw, source);
};
