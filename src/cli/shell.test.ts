import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "shell-home-"));
vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:os")>()),
  homedir: () => home,
}));

const { removeFromPath } = await import("./shell.js");

afterAll(() => rmSync(home, { recursive: true, force: true }));

describe("removeFromPath", () => {
  it("removes the block install.sh writes, whatever the install directory is called", () => {
    const zshrc = join(home, ".zshrc");
    const fish = join(home, ".config", "fish", "config.fish");
    mkdirSync(join(home, ".config", "fish"), { recursive: true });
    writeFileSync(
      zshrc,
      'alias ll="ls -l"\n\n# Universal Netlist MCP Server\nexport PATH="/opt/tools/bin:$PATH"\n'
    );
    writeFileSync(
      fish,
      "set -x EDITOR vim\n\n# Universal Netlist MCP Server\nfish_add_path /opt/tools/bin\n"
    );

    expect(removeFromPath().sort()).toEqual([fish, zshrc].sort());
    expect(readFileSync(zshrc, "utf-8")).toBe('alias ll="ls -l"\n');
    expect(readFileSync(fish, "utf-8")).toBe("set -x EDITOR vim\n");
  });

  it("keeps a line after the comment that is not a PATH entry", () => {
    const bashrc = join(home, ".bashrc");
    writeFileSync(bashrc, "# Universal Netlist MCP Server\nalias un=universal-netlist\n");

    removeFromPath();

    expect(readFileSync(bashrc, "utf-8")).toBe("alias un=universal-netlist\n");
  });
});
