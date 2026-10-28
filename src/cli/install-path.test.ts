/**
 * install.sh's PATH step, run in bash against a throwaway home: it writes the
 * binary's folder to the shell's rc file and to the login profile that apps
 * started outside a terminal (the Claude desktop app) read, once each.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const INSTALL_SH = path.resolve(__dirname, "../../install.sh");
const scratch = mkdtempSync(path.join(tmpdir(), "install-path-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

// Every function of install.sh, without the call to main at its end.
const functions = path.join(scratch, "functions.sh");
writeFileSync(functions, readFileSync(INSTALL_SH, "utf-8").replace(/^main "\$@"\s*$/m, ""));

let homes = 0;
/** Run add_to_path for `shell` in a new home holding `files`; returns the home. */
const addToPath = (shell: string, files: string[] = [], env: NodeJS.ProcessEnv = {}) => {
  const home = path.join(scratch, `home-${homes++}`);
  mkdirSync(home);
  for (const file of files) {
    mkdirSync(path.dirname(path.join(home, file)), { recursive: true });
    writeFileSync(path.join(home, file), "");
  }
  run(home, shell, env);
  return home;
};
const run = (home: string, shell: string, env: NodeJS.ProcessEnv = {}) => {
  const result = spawnSync("bash", ["-c", `source "${functions}"; add_to_path "$HOME/app"`], {
    encoding: "utf-8",
    env: { PATH: process.env.PATH, HOME: home, SHELL: `/bin/${shell}`, ...env },
  });
  expect(result.status, result.stderr).toBe(0);
};
/** How many PATH entries each named file in `home` holds. */
const entries = (home: string, files: string[]) =>
  Object.fromEntries(
    files.map((file) => {
      const full = path.join(home, file);
      const content = existsSync(full) ? readFileSync(full, "utf-8") : "";
      return [file, content.split("# Universal Netlist MCP Server").length - 1];
    })
  );

describe.skipIf(process.platform === "win32")("install.sh add_to_path", () => {
  it("writes zsh's rc file and its login profile", () => {
    const home = addToPath("zsh");
    expect(entries(home, [".zshrc", ".zprofile"])).toEqual({ ".zshrc": 1, ".zprofile": 1 });
    expect(readFileSync(path.join(home, ".zprofile"), "utf-8")).toContain(
      `export PATH="${home}/app/bin:$PATH"`
    );
  });

  it("writes zsh's files under ZDOTDIR when it is set", () => {
    const zdotdir = path.join(scratch, "zdotdir");
    const home = addToPath("zsh", [], { ZDOTDIR: zdotdir });
    expect(entries(zdotdir, [".zshrc", ".zprofile"])).toEqual({ ".zshrc": 1, ".zprofile": 1 });
    expect(entries(home, [".zshrc", ".zprofile"])).toEqual({ ".zshrc": 0, ".zprofile": 0 });
  });

  it("adds to the bash login file bash reads, without creating one that hides another", () => {
    expect(
      entries(addToPath("bash", [".bashrc"]), [".bashrc", ".bash_profile", ".profile"])
    ).toEqual({ ".bashrc": 1, ".bash_profile": 0, ".profile": 1 });
    expect(
      entries(addToPath("bash", [".bashrc", ".bash_profile", ".profile"]), [
        ".bashrc",
        ".bash_profile",
        ".profile",
      ])
    ).toEqual({ ".bashrc": 1, ".bash_profile": 1, ".profile": 0 });
  });

  it("writes once when the rc file is also the login profile", () => {
    const home = addToPath("bash", [".bash_profile"]);
    expect(entries(home, [".bash_profile", ".bashrc", ".profile"])).toEqual({
      ".bash_profile": 1,
      ".bashrc": 0,
      ".profile": 0,
    });
  });

  it("adds only what is missing when run again, as on an install from before the login profile", () => {
    const home = addToPath("zsh");
    rmSync(path.join(home, ".zprofile"));
    writeFileSync(path.join(home, ".zprofile"), "alias un=universal-netlist\n");
    run(home, "zsh");
    expect(entries(home, [".zshrc", ".zprofile"])).toEqual({ ".zshrc": 1, ".zprofile": 1 });
  });

  it("leaves fish to its one config file", () => {
    const home = addToPath("fish", [".config/fish/config.fish"]);
    expect(readFileSync(path.join(home, ".config/fish/config.fish"), "utf-8")).toContain(
      `fish_add_path ${home}/app/bin`
    );
    expect(existsSync(path.join(home, ".profile"))).toBe(false);
  });
});
