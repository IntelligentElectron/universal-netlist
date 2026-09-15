/**
 * Components: which pin records are connection points, and what each part carries.
 *
 * A component record is one drawn instance of one part of a library component:
 * - A multi-part component writes every part's pins under every instance; only the pins
 *   of the part the instance draws (`CURRENTPARTID` against `OwnerPartId`) connect.
 * - A component with display modes writes one pin set per mode; only the drawn mode's
 *   pins (`DISPLAYMODE` against `OwnerPartDisplayMode`, both unwritten for mode 0)
 *   connect.
 * - A later instance repeating an earlier one's designator and part is a duplicate
 *   designator: the first instance is the part, and the later ones connect nothing.
 */

import type { ComponentDetails, PinEntry } from "../../types.js";
import { createPinEntry } from "../../types.js";
import { hasDnsValueMarker, isDnsComponent, stripDnsMarkers } from "../../circuit-traversal.js";
import { RECORD_TYPES, type AltiumRecord, type AltiumSchematic } from "./types.js";
import { fieldText, ownerOf } from "./records.js";

type Component = ComponentDetails[string];

const text = (value: unknown): string =>
  value === undefined || value === null ? "" : String(value);

/** The part an instance draws; unwritten for a single-part component. */
const instancePartId = (part: AltiumRecord): string =>
  text(part.CURRENTPARTID ?? part.CurrentPartId ?? part.CurrentPartID);

/** The display mode an instance draws. */
const instanceDisplayMode = (part: AltiumRecord): string =>
  text(part.DISPLAYMODE ?? part.DisplayMode) || "0";

/** The designator a component or sheet symbol carries in its designator record. */
export const componentDesignator = (part: AltiumRecord): string | undefined => {
  const designator = part.children?.find((child) => child.RECORD === RECORD_TYPES.DESIGNATOR);
  return designator && fieldText(designator, "Text", "Name");
};

/** A pin's number, or its name where it has none. */
export const pinNumber = (pin: AltiumRecord): string | undefined =>
  fieldText(pin, "Designator", "Name");

/** The designator of the component a pin belongs to. */
export const pinDesignator = (
  pin: AltiumRecord,
  schematic: AltiumSchematic
): string | undefined => {
  const owner = ownerOf(pin, schematic);
  return owner && componentDesignator(owner);
};

/** Whether a pin is one of the pins its instance draws. */
export const pinBelongsToInstance = (pin: AltiumRecord, part: AltiumRecord): boolean => {
  const partId = instancePartId(part);
  const pinPartId = text(pin.OwnerPartId ?? pin.OWNERPARTID);
  if (partId !== "" && pinPartId !== "" && partId !== pinPartId) return false;
  return (
    (text(pin.OwnerPartDisplayMode ?? pin.OWNERPARTDISPLAYMODE) || "0") ===
    instanceDisplayMode(part)
  );
};

/** The instances that repeat an earlier instance's designator and part. */
export const duplicateInstanceIndices = (schematic: AltiumSchematic): Set<number> => {
  const seen = new Set<string>();
  const duplicates = new Set<number>();
  for (const part of schematic.records) {
    if (part.RECORD !== RECORD_TYPES.COMPONENT) continue;
    const designator = componentDesignator(part);
    if (designator === undefined) continue;
    const key = `${designator} ${instancePartId(part)}`;
    if (seen.has(key)) duplicates.add(part.index);
    else seen.add(key);
  }
  return duplicates;
};

/** Whether a pin connects: its instance draws it and is not a duplicate. An unowned pin does. */
export const pinIsLive = (
  pin: AltiumRecord,
  schematic: AltiumSchematic,
  duplicates: ReadonlySet<number>
): boolean => {
  const owner = ownerOf(pin, schematic);
  if (!owner) return true;
  return !duplicates.has(owner.index) && pinBelongsToInstance(pin, owner);
};

/**
 * Fold one reading of a component into another of the same designator: the union of
 * their pins, the first reading's entry where both declare a pin, and the first
 * reading's fields with gaps filled from the second.
 */
export const mergeComponentInto = (target: Component, source: Component): void => {
  for (const [pin, entry] of Object.entries(source.pins)) {
    if (target.pins[pin] === undefined) target.pins[pin] = entry;
  }
  for (const key of [
    "mpn",
    "internal_pn",
    "manufacturer",
    "description",
    "comment",
    "value",
  ] as const) {
    if (target[key] === undefined && source[key] !== undefined) target[key] = source[key];
  }
  if (source.dns && !target.dns) target.dns = true;
};

/** A `Comment`, with `=Name` resolved to that parameter's value. */
const resolveComment = (
  comment: string | undefined,
  parameters: Record<string, string>
): string | undefined => {
  const trimmed = comment?.trim();
  if (!trimmed) return undefined;
  if (!trimmed.startsWith("=")) return trimmed;
  const reference = trimmed.slice(1).trim();
  return (reference && parameters[reference.toLowerCase()]?.trim()) || undefined;
};

/** A part's parameter records: every value by lower-case name, and the MPN and comment. */
const readParameters = (part: AltiumRecord) => {
  const byName: Record<string, string> = {};
  let mpn: string | undefined;
  let comment: string | undefined;
  for (const child of part.children ?? []) {
    if (child.RECORD !== RECORD_TYPES.PARAMETER) continue;
    const name = fieldText(child, "Name")?.trim();
    const value = fieldText(child, "Text")?.trim();
    if (name === undefined || value === undefined) continue;
    if (name) byName[name.toLowerCase()] = value;
    if (name === "Manufacturer Part Number") mpn = value;
    else if (name === "Comment") comment = value;
  }
  return { byName, mpn, comment };
};

/** Every component of a sheet, with its pins declared and not yet on any net. */
export const extractComponents = (schematic: AltiumSchematic): ComponentDetails => {
  const components: ComponentDetails = {};
  const duplicates = duplicateInstanceIndices(schematic);

  for (const part of schematic.records) {
    if (part.RECORD !== RECORD_TYPES.COMPONENT || duplicates.has(part.index)) continue;
    const refdes = componentDesignator(part);
    if (!refdes) continue;

    const parameters = readParameters(part);
    const value = parameters.byName["value"] || undefined;
    let comment = resolveComment(parameters.comment, parameters.byName);
    if (comment === value) comment = undefined;

    const pins: Record<string, PinEntry> = {};
    for (const child of part.children ?? []) {
      if (child.RECORD !== RECORD_TYPES.PIN || !pinBelongsToInstance(child, part)) continue;
      const number = pinNumber(child);
      if (number) pins[number] = createPinEntry(number, fieldText(child, "Name"), "");
    }

    const component: Component = { pins };
    const mpn = parameters.mpn || fieldText(part, "PartNumber", "Mpn");
    const description = fieldText(part, "ComponentDescription", "Description");
    if (mpn) component.mpn = mpn;
    const manufacturer = parameters.byName["manufacturer"] || undefined;
    if (manufacturer !== undefined) component.manufacturer = manufacturer;
    if (description) component.description = description;
    if (comment !== undefined) component.comment = comment;
    if (value !== undefined) component.value = value;

    const assemblyInfo = parameters.byName["assembly info"];
    if (
      isDnsComponent({
        ...component,
        comment: [component.comment, assemblyInfo].filter(Boolean).join(" "),
      }) ||
      hasDnsValueMarker(component.value ?? "")
    ) {
      component.dns = true;
      if (component.mpn) component.mpn = stripDnsMarkers(component.mpn);
      if (component.value) component.value = stripDnsMarkers(component.value);
      if (component.description) component.description = stripDnsMarkers(component.description);
    }

    const existing = components[refdes];
    if (existing) mergeComponentInto(existing, component);
    else components[refdes] = component;
  }

  return components;
};
