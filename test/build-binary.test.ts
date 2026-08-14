/**
 * Argument handling in scripts/build-binary.sh.
 *
 * Every test here stops before a binary is produced, so they need no toolchain
 * and cost nothing. The rejection paths fail before Bun is invoked at all; the
 * version tests read the line the script prints before compiling, and hand it a
 * target Bun rejects so the compile itself is over in milliseconds. CI has no
 * Bun, which is why the assertions are all on what the script decided rather
 * than on an artifact.
 *
 * A channel the script does not know would compile a binary with self-update
 * silently off, indistinguishable downstream from a build that meant it. A
 * mis-resolved version is the same shape of defect: a binary reporting a
 * version nobody released.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { readFileSync } from "node:fs";

const TEST_DIR = path.dirname(new URL(import.meta.url).pathname);
const PROJECT_DIR = path.join(TEST_DIR, "..");
const SCRIPT = path.join(PROJECT_DIR, "scripts", "build-binary.sh");

/** A target Bun rejects, so the compile fails immediately instead of building. */
const BAD_TARGET = "bun-nonexistent-target";

const hasBun = spawnSync("bun", ["--version"]).status === 0;

/**
 * A PATH carrying Bun and the coreutils the script calls, and no Node.
 *
 * Reading the default version is the one step that ever wanted Node, so a
 * fallback exercised on the ambient PATH would pass on a machine that simply
 * has both installed. `null` where that PATH cannot be built: no Bun, or a Node
 * in the system directories the script needs anyway.
 */
const nodeFreePath = ((): string | null => {
  const bun = spawnSync("command", ["-v", "bun"], {
    encoding: "utf-8",
    shell: true,
  });
  if (bun.status !== 0) return null;

  const candidate = `${path.dirname(bun.stdout.trim())}:/usr/bin:/bin`;
  const node = spawnSync("command", ["-v", "node"], {
    encoding: "utf-8",
    shell: true,
    env: { PATH: candidate },
  });
  return node.status === 0 ? null : candidate;
})();

type Run = { status: number | null; stdout: string; stderr: string };

const runWithEnv = (env: NodeJS.ProcessEnv, ...args: string[]): Run => {
  const result = spawnSync("bash", [SCRIPT, ...args], {
    encoding: "utf-8",
    env: { ...process.env, ...env },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};

const run = (...args: string[]): Run => runWithEnv({}, ...args);

describe("build-binary.sh argument handling", () => {
  it("rejects a channel it does not know", () => {
    const { status, stderr } = run("host", "/dev/null", "packagd");

    expect(status).toBe(1);
    expect(stderr).toContain("Unknown channel: packagd");
  });

  it("rejects an empty channel rather than defaulting it", () => {
    const { status, stderr } = run("host", "/dev/null", "");

    expect(status).toBe(1);
    expect(stderr).toContain("Unknown channel");
  });

  it("prints usage when the target and outfile are missing", () => {
    const { status, stderr } = run();

    expect(status).toBe(1);
    expect(stderr).toContain("Usage:");
  });
});

describe("build-binary.sh version resolution", () => {
  /** The environment the script sees with no VERSION set, whatever the host has. */
  const withoutVersion = (): NodeJS.ProcessEnv => {
    const env = { ...process.env };
    delete env.VERSION;
    return env;
  };

  it("bakes in the version the caller supplies", () => {
    const { stdout } = runWithEnv({ VERSION: "1.5.2-3" }, BAD_TARGET, "/dev/null");

    expect(stdout).toContain("version=1.5.2-3");
  });

  it("takes a caller-supplied version without running any JS runtime", () => {
    // The point of the override: `PATH` holding neither Bun nor Node still
    // resolves a version. Only the compile below it needs a toolchain.
    const { stdout } = runWithEnv(
      { VERSION: "0.0.0-snapshot", PATH: "/usr/bin:/bin" },
      BAD_TARGET,
      "/dev/null"
    );

    expect(stdout).toContain("version=0.0.0-snapshot");
  });

  it.skipIf(!nodeFreePath)("falls back to package.json with Bun alone, no Node installed", () => {
    const { version } = JSON.parse(
      readFileSync(path.join(PROJECT_DIR, "package.json"), "utf-8")
    ) as { version: string };
    const result = spawnSync("bash", [SCRIPT, BAD_TARGET, "/dev/null"], {
      encoding: "utf-8",
      env: { ...withoutVersion(), PATH: nodeFreePath as string },
    });

    expect(result.stdout).toContain(`version=${version}`);
    expect(result.stderr).not.toContain("node: command not found");
  });

  // `--define` substitutes the version as raw source text, so a `"` closes the
  // string literal early and Bun compiles the truncated remainder without
  // complaint: `1.0.0", "X": "y` built clean and reported 1.0.0. A version the
  // caller never asked for, in a binary nothing downstream can tell apart from
  // a good one, which is the defect the channel check exists to stop.
  it.each([
    ["a quote, which truncated the version silently", '1.0.0", "X": "y'],
    ["a trailing backslash", "1.0.0\\"],
    ["a leading space", " 1.5.2"],
    ["a newline", "1.5.2\nevil"],
  ])("rejects a version carrying %s", (_label, version) => {
    const { status, stderr } = runWithEnv({ VERSION: version }, BAD_TARGET, "/dev/null");

    expect(status).toBe(1);
    expect(stderr).toContain("Invalid version:");
  });

  // The formats a downstream packager actually stamps. Rejecting one of these
  // would send them back to patching package.json, which is what #144 asked to
  // stop doing.
  it.each([
    ["plain semver", "1.5.2"],
    ["a packager revision", "1.5.2-3"],
    ["build metadata", "1.5.2+2026.08.14"],
    ["a Debian pre-release", "1.5.2~rc1"],
    ["a Debian epoch", "1:1.5.2"],
  ])("accepts %s", (_label, version) => {
    const { stdout } = runWithEnv({ VERSION: version }, BAD_TARGET, "/dev/null");

    expect(stdout).toContain(`version=${version}`);
  });

  it.skipIf(!hasBun)("falls back rather than baking an empty version", () => {
    // `VERSION=$SOME_UNSET_VAR` reaches the script as an empty string. A true
    // upstream version is the right answer there; `version=` is not one.
    const result = spawnSync("bash", [SCRIPT, BAD_TARGET, "/dev/null"], {
      encoding: "utf-8",
      env: { ...withoutVersion(), VERSION: "" },
    });

    expect(result.stdout).toMatch(/version=\S+, channel=github/);
  });
});
