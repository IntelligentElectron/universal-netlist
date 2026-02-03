/**
 * Path resolution utilities.
 *
 * Converts between relative and absolute paths for tool input/output.
 * Relative paths are resolved against the current working directory.
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
 * Convert an absolute path to a path relative to the current working directory.
 *
 * On Windows, when the target is on a different drive than CWD,
 * `path.relative()` returns an absolute path since no relative
 * representation exists. This is a known limitation — the absolute
 * path is returned as-is in that case.
 */
export const toRelativePath = (absolutePath: string): string =>
  path.relative(process.cwd(), absolutePath);
