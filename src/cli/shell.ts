/**
 * Shell rc file manipulation for PATH integration.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

/**
 * Get shell configuration file paths to check for PATH entries.
 * @returns Array of paths to shell rc files
 */
export const getShellRcFiles = (): string[] => {
  const home = os.homedir();
  return [
    path.join(home, ".zshrc"),
    path.join(home, ".bashrc"),
    path.join(home, ".bash_profile"),
    path.join(home, ".profile"),
    path.join(home, ".config", "fish", "config.fish"),
  ];
};

/** Whether two paths name one directory, through symlinks and repeated slashes. */
const sameDirectory = (a: string, b: string): boolean => {
  try {
    return fs.realpathSync(a) === fs.realpathSync(b);
  } catch {
    return path.resolve(a) === path.resolve(b);
  }
};

/**
 * Remove universal-netlist PATH entries from shell rc files: each "# Universal Netlist MCP
 * Server" comment with the PATH line install.sh writes after it. A comment followed by any
 * other line is left as it is.
 * @param binDir - The directory the PATH line adds
 * @returns Array of file paths that were modified
 */
export const removeFromPath = (binDir: string): string[] => {
  const modified: string[] = [];
  const isEntry = (line: string | undefined): boolean => {
    const added =
      line === undefined
        ? undefined
        : (/^\s*export PATH="([^"]*):\$PATH"\s*$/.exec(line)?.[1] ??
          /^\s*fish_add_path\s+(.+?)\s*$/.exec(line)?.[1]);
    return (
      added !== undefined && (added.includes("universal-netlist") || sameDirectory(added, binDir))
    );
  };

  for (const rcFile of getShellRcFiles()) {
    if (!fs.existsSync(rcFile)) continue;

    const content = fs.readFileSync(rcFile, "utf-8");
    const lines = content.split("\n");
    const filtered: string[] = [];
    let i = 0;
    let changed = false;

    while (i < lines.length) {
      const line = lines[i];
      if (line.trim() === "# Universal Netlist MCP Server" && isEntry(lines[i + 1])) {
        changed = true;
        i += 2;
        // Skip trailing empty line if present
        if (i < lines.length && lines[i].trim() === "") {
          i++;
        }
        continue;
      }
      filtered.push(line);
      i++;
    }

    if (changed) {
      // Remove trailing newlines
      while (filtered.length > 0 && filtered[filtered.length - 1] === "") {
        filtered.pop();
      }
      fs.writeFileSync(rcFile, filtered.join("\n") + "\n");
      modified.push(rcFile);
    }
  }

  return modified;
};
