import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
  it("removes the block install.sh writes for the binary's directory, whatever it is called", () => {
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

    expect(removeFromPath("/opt/tools/bin").sort()).toEqual([fish, zshrc].sort());
    expect(readFileSync(zshrc, "utf-8")).toBe('alias ll="ls -l"\n');
    expect(readFileSync(fish, "utf-8")).toBe("set -x EDITOR vim\n");
  });

  it("recognises the binary's directory through a symlink or a repeated slash", () => {
    const real = join(home, "real", "bin");
    mkdirSync(real, { recursive: true });
    symlinkSync(join(home, "real"), join(home, "link"));
    const profile = join(home, ".profile");
    writeFileSync(
      profile,
      `# Universal Netlist MCP Server\nexport PATH="${home}/link//bin:$PATH"\n`
    );

    expect(removeFromPath(real)).toContain(profile);
    expect(readFileSync(profile, "utf-8")).toBe("\n");
  });

  it("leaves a comment followed by the user's own lines as it is", () => {
    const bashrc = join(home, ".bashrc");
    const content =
      '# Universal Netlist MCP Server\nexport PATH="$HOME/go/bin:$PATH"\nalias un=universal-netlist\n';
    writeFileSync(bashrc, content);

    expect(removeFromPath("/opt/tools/bin")).toEqual([]);
    expect(readFileSync(bashrc, "utf-8")).toBe(content);
  });
});
