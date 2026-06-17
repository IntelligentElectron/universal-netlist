/**
 * Shared helpers for locating the running CLI executable.
 */

/**
 * Get the path to the current executable.
 *
 * For Bun-compiled binaries, `process.execPath` points to the binary itself.
 * For Node.js, `process.argv[1]` is the script path.
 */
export const getCurrentExecutablePath = (): string => {
  if (process.execPath.includes("node") || process.execPath.includes("bun")) {
    // Running via node/bun interpreter - use argv[1]
    return process.argv[1];
  }
  // Compiled binary - use execPath
  return process.execPath;
};

/**
 * Whether the process is running as a Bun-compiled standalone binary.
 *
 * Running from source via the `node`/`bun`/`tsx` interpreter leaves
 * `process.execPath` pointing at that interpreter; a compiled binary's
 * `execPath` is the binary itself. Only the compiled binary should ever
 * self-update.
 */
export const isCompiledBinary = (): boolean =>
  !process.execPath.includes("node") && !process.execPath.includes("bun");
