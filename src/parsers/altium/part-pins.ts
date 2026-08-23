/**
 * Which pin records of a schematic are connection points.
 *
 * A component record (RECORD=1) is one drawn instance of one part of a
 * library component, and the pins written under it are not all live:
 *
 * - A multi-part component writes every part's pins under every instance, and
 *   `CURRENTPARTID` says which part the instance draws. Pins of the other
 *   parts belong to other instances (`OwnerPartId`).
 * - A component with alternate display modes writes one pin set per mode, at
 *   the coordinates of that mode's graphic, and `DISPLAYMODE` says which mode
 *   is drawn. Pins of the other modes (`OwnerPartDisplayMode`) sit wherever
 *   that graphic would put them, which can be on top of another net's wire. A
 *   header drawn in its alternate mode used to land half its pins on GND that
 *   way.
 * - Two instances with the same designator and the same part are a duplicate
 *   designator, which Altium's compiler reports as an error. One physical part
 *   cannot have one pin on two nets, so the first instance in the document is
 *   the part and the later ones are ignored: their pins connect nothing and
 *   their fields are not read. A multi-part component drawn as several
 *   instances with different part ids is not a duplicate.
 *
 * Both `findConnectableDevices` (which pins join nets) and `extractComponents`
 * (which pins a component declares) decide through here, so the two indices of
 * the netlist are built from the same pins.
 */

import type { AltiumRecord, AltiumSchematic } from "./types.js";
import { RECORD_TYPES } from "./types.js";
import { getPartsList } from "./hierarchy.js";

const text = (value: unknown): string =>
  value === undefined || value === null ? "" : String(value);

/** The part id an instance draws. Altium writes none for a single-part component. */
export const instancePartId = (part: AltiumRecord): string =>
  text(part.CURRENTPARTID ?? part.CurrentPartId ?? part.CurrentPartID);

/** The display mode an instance draws. Altium leaves the default mode (0) unwritten. */
export const instanceDisplayMode = (part: AltiumRecord): string =>
  text(part.DISPLAYMODE ?? part.DisplayMode) || "0";

/** The designator text of a component instance, if it has one. */
export const instanceDesignator = (part: AltiumRecord): string | undefined => {
  const designator = part.children?.find((c) => c.RECORD === RECORD_TYPES.DESIGNATOR);
  const value = designator?.Text ?? designator?.TEXT ?? designator?.Name ?? designator?.NAME;
  const out = text(value);
  return out === "" ? undefined : out;
};

/**
 * Whether a pin record is a live connection point of the instance it is
 * written under: same part (when both say) and same display mode.
 */
export const pinBelongsToInstance = (pin: AltiumRecord, part: AltiumRecord): boolean => {
  const partId = instancePartId(part);
  const pinPartId = text(pin.OwnerPartId ?? pin.OWNERPARTID);
  if (partId !== "" && pinPartId !== "" && partId !== pinPartId) return false;

  const pinMode = text(pin.OwnerPartDisplayMode ?? pin.OWNERPARTDISPLAYMODE) || "0";
  return pinMode === instanceDisplayMode(part);
};

/**
 * Record indices of component instances that repeat an earlier instance's
 * designator and part id in the same document. The first instance is the part;
 * these are the duplicates.
 */
export const duplicateInstanceIndices = (schematic: AltiumSchematic): Set<number> => {
  const seen = new Set<string>();
  const duplicates = new Set<number>();
  for (const part of getPartsList(schematic)) {
    const designator = instanceDesignator(part);
    if (designator === undefined) continue;
    const key = `${designator} ${instancePartId(part)}`;
    if (seen.has(key)) duplicates.add(part.index);
    else seen.add(key);
  }
  return duplicates;
};
