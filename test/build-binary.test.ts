/**
 * Argument handling in scripts/build-binary.sh.
 *
 * Only the rejection paths are exercised: they fail before Bun is invoked, so
 * these tests need no toolchain and cost nothing. A channel the script does not
 * know would otherwise compile a binary with self-update silently off, which is
 * indistinguishable downstream from a build that meant it.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";

const TEST_DIR = path.dirname(new URL(import.meta.url).pathname);
const SCRIPT = path.join(TEST_DIR, "..", "scripts", "build-binary.sh");

const run = (...args: string[]): { status: number | null; stderr: string } => {
  const result = spawnSync("bash", [SCRIPT, ...args], { encoding: "utf-8" });
  return { status: result.status, stderr: result.stderr };
};

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
