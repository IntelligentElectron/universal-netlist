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

/**
 * Remove universal-netlist PATH entries from shell rc files.
 * Looks for "# Universal Netlist MCP Server" comment blocks and removes them.
 * @returns Array of file paths that were modified
 */
export const removeFromPath = (): string[] => {
  const modified: string[] = [];

  for (const rcFile of getShellRcFiles()) {
    if (!fs.existsSync(rcFile)) continue;

    const content = fs.readFileSync(rcFile, "utf-8");
    const lines = content.split("\n");
    const filtered: string[] = [];
    let i = 0;
    let changed = false;

    while (i < lines.length) {
      const line = lines[i];
      // Skip "# Universal Netlist MCP Server" comment and the following export/fish_add_path line
      if (line.trim() === "# Universal Netlist MCP Server") {
        changed = true;
        i++; // Skip comment
        // Skip the next line if it's the PATH export
        if (i < lines.length && lines[i].includes("universal-netlist")) {
          i++;
        }
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
