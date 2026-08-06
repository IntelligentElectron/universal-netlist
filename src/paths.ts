/**
 * Path resolution utilities.
 *
 * Resolves relative paths against the current working directory.
 */

import path from "path";

/**
 * Resolve a file path to an absolute path using native separators.
 * Relative paths are resolved against the current working directory.
 *
 * On Windows, path.normalize() converts / to \
 * On Unix, we must manually convert \ to / since path.normalize() doesn't
 * (backslash is a valid filename character on Unix, but agents often send
 * Windows-style paths regardless of platform).
 *
 * Examples:
 *   "./design.dsn"          -> "/Users/eng/projects/design.dsn"
 *   "C:/Users/foo/bar"      -> "C:\\Users\\foo\\bar"     (Windows)
 *   "\\Users\\foo\\bar"     -> "/Users/foo/bar"          (Unix)
 */
export const resolvePath = (inputPath: string): string => {
  if (process.platform === "win32") {
    return path.resolve(path.normalize(inputPath));
  }
  // On Unix, convert backslashes to forward slashes before normalizing
  return path.resolve(path.normalize(inputPath.replace(/\\/g, "/")));
};

/**
 * Derive a human-readable design name from a design path by stripping the
 * directory and file extension.
 *
 * Example: "/projects/board-rev-c/top.dsn" -> "top"
 */
export const getDesignName = (design: string): string =>
  path.basename(design, path.extname(design));

/**
 * Suffix of the directory `export_cadence_netlist` writes a design's netlist to.
 *
 * Lives here because the exporter that creates these directories and the
 * discovery that has to recognise them sit in different layers, and `service`
 * may import `parsers` but not the reverse. Retyping the literal in both left
 * the writer and the reader agreeing only by coincidence: renaming it on one
 * side would leave every new export unrecognised with nothing failing.
 */
export const NETLIST_DIR_SUFFIX = "_netlist";

/** Name of the export directory belonging to a design. */
export const netlistDirName = (designName: string): string =>
  `${designName}${NETLIST_DIR_SUFFIX}`;

/** Does this directory name look like `<design>`'s export directory? */
export const isNetlistDirFor = (dirName: string, designName: string): boolean =>
  dirName.toLowerCase() === netlistDirName(designName).toLowerCase();
