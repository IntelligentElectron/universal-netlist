/**
 * A resolved schematic written as the `kicadsexpr` netlist `kicad-cli` exports.
 *
 * The raw reader resolves connectivity, then hands this text to the same
 * `parseKicadNetlist` that reads a saved `.net`, so the fields a component
 * carries (value, description, MPN, manufacturer), Do Not Populate and pin
 * names are mapped by one piece of code whichever source the netlist came from.
 * Only what that parser reads is written.
 */

/** One symbol instance, merged across its units. */
export interface ResolvedComponent {
  readonly reference: string;
  readonly value: string;
  readonly footprint: string;
  /** Every field, Reference and Value included, in file order. */
  readonly properties: readonly { readonly name: string; readonly value: string }[];
  readonly dnp: boolean;
}

/** One pin on a net. */
export interface ResolvedPin {
  readonly reference: string;
  readonly pin: string;
  /** The symbol's pin name; `~` or empty for an unnamed pin. */
  readonly name: string;
  /** KiCad's electrical type: passive, input, power_in, ... */
  readonly type: string;
}

export interface ResolvedNet {
  readonly name: string;
  readonly pins: readonly ResolvedPin[];
}

/** A design's connectivity, on-board parts only, as KiCad's netlister reports it. */
export interface ResolvedSchematic {
  readonly components: readonly ResolvedComponent[];
  readonly nets: readonly ResolvedNet[];
}

/** A quoted s-expression string, escaped as KiCad escapes one. */
const quote = (text: string): string =>
  `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r")}"`;

/** Fields KiCad writes as their own nodes, or not at all, rather than in `(fields ...)`. */
const NOT_A_FIELD = new Set(["Reference", "Value"]);

/** The netlist text: components with their fields, then nets with their pins. */
export const writeKicadNetlist = (design: ResolvedSchematic): string => {
  const lines: string[] = ["(export", '  (version "E")', "  (components"];
  for (const component of design.components) {
    lines.push(
      "    (comp",
      `      (ref ${quote(component.reference)})`,
      `      (value ${quote(component.value)})`
    );
    if (component.footprint) lines.push(`      (footprint ${quote(component.footprint)})`);
    lines.push("      (fields");
    for (const property of component.properties) {
      if (NOT_A_FIELD.has(property.name)) continue;
      lines.push(
        `        (field (name ${quote(property.name)})${property.value ? ` ${quote(property.value)}` : ""})`
      );
    }
    lines.push("      )");
    if (component.dnp) lines.push('      (property (name "dnp"))');
    lines.push("    )");
  }
  lines.push("  )", "  (nets");
  design.nets.forEach((net, index) => {
    lines.push(
      "    (net",
      `      (code ${quote(String(index + 1))})`,
      `      (name ${quote(net.name)})`
    );
    for (const pin of net.pins) {
      const named = pin.name && pin.name !== "~";
      lines.push(
        `      (node (ref ${quote(pin.reference)}) (pin ${quote(pin.pin)})` +
          (named ? ` (pinfunction ${quote(`${pin.name}_${pin.pin}`)})` : "") +
          ` (pintype ${quote(pin.type)}))`
      );
    }
    lines.push("    )");
  });
  lines.push("  )", ")");
  return `${lines.join("\n")}\n`;
};
