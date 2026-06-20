/**
 * Small filesystem access helpers shared by the KiCad CLI resolver (`cli.ts`)
 * and the design walker (`discovery.ts`). They differ only in the access mode
 * they check, so they live here rather than being duplicated in each module.
 */

import { access } from "node:fs/promises";
import { constants } from "node:fs";

const accessible = async (p: string, mode: number): Promise<boolean> => {
  try {
    await access(p, mode);
    return true;
  } catch {
    return false;
  }
};

/** True when `p` exists and is executable (X_OK) — used to validate a kicad-cli binary. */
export const isExecutable = (p: string): Promise<boolean> => accessible(p, constants.X_OK);

/** True when `p` exists and is readable (R_OK) — used to validate discovered artifacts. */
export const isReadable = (p: string): Promise<boolean> => accessible(p, constants.R_OK);
