/**
 * Shared helpers for locating the running CLI executable.
 */

import { COMPILED_BINARY } from "../build-flags.js";

/** Whether the process is the compiled standalone binary. Only it self-updates or uninstalls. */
export const isCompiledBinary = (): boolean => COMPILED_BINARY;

/**
 * Get the path to the current executable: the binary itself when compiled, otherwise the
 * script the interpreter runs.
 */
export const getCurrentExecutablePath = (): string =>
  isCompiledBinary() ? process.execPath : process.argv[1];
