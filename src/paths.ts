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
 *
 * A design that is only a netlist is addressed by one of its three .dat files,
 * which every such design names identically, so stripping the extension called
 * all of them "pstxnet" and two side by side answered to the same name. Their
 * directory holds the identity instead: discovery collects a triad per
 * directory, so a directory contains at most one of these designs.
 *
 * Example: "/projects/BeagleBone-Black-copy/pstxnet.dat" -> "BeagleBone-Black-copy"
 */
export const getDesignName = (design: string): string => {
  const base = path.basename(design);
  if (REQUIRED_DAT_FILES.includes(base.toLowerCase() as (typeof REQUIRED_DAT_FILES)[number])) {
    // A .dat sitting at the root of a filesystem has no directory to be named
    // after, and an empty name is worse than the one this replaces.
    const parent = path.basename(path.dirname(design));
    if (parent) return parent;
  }
  return path.basename(design, path.extname(design));
};

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
export const netlistDirName = (designName: string): string => `${designName}${NETLIST_DIR_SUFFIX}`;

/** Does this directory name look like `<design>`'s export directory? */
export const isNetlistDirFor = (dirName: string, designName: string): boolean =>
  dirName.toLowerCase() === netlistDirName(designName).toLowerCase();

/**
 * The three files a netlist export must produce for any consumer to use it.
 *
 * Here for the same reason as the suffix above: the exporter decides an export
 * succeeded by finding them and discovery decides a directory holds a netlist by
 * finding them, and a list retyped on each side agrees only by coincidence.
 */
export const REQUIRED_DAT_FILES = ["pstxnet.dat", "pstxprt.dat", "pstchip.dat"] as const;
