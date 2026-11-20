import type { ParsedNetlist } from "../types.js";

/** Material limits of scalar analysis when the source also contains buses or unresolved pads. */
export function topologyNotes(netlist: ParsedNetlist): string[] {
  const components = Object.values(netlist.components);
  const notes: string[] = [];
  if (
    Object.keys(netlist.buses ?? {}).length ||
    components.some((c) => Object.keys(c.busPins ?? {}).length)
  ) {
    notes.push(
      "Bus terminals are reported separately in busPins; scalar XNET and ERC do not infer electrical lanes through a bus."
    );
  }
  if (components.some((c) => Object.keys(c.pinIdentities ?? {}).length)) {
    notes.push(
      "@instanceId:pinIndex keys identify source-symbol terminals, not physical package pins. pinIdentities retains resolved source labels; omitted numbers remain unresolved."
    );
  }
  const unresolved = (netlist.busEntries ?? []).filter((e) => e.net === undefined).length;
  if (unresolved)
    notes.push(`${unresolved} bus entries have unresolved or ambiguous endpoint geometry.`);
  return notes;
}
