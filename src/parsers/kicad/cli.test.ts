import { describe, it, expect, afterEach } from "vitest";
import { resolveKicadCli } from "./cli.js";

describe("resolveKicadCli", () => {
  const original = process.env.KICAD_CLI_PATH;
  afterEach(() => {
    if (original === undefined) delete process.env.KICAD_CLI_PATH;
    else process.env.KICAD_CLI_PATH = original;
  });

  it("returns null when KICAD_CLI_PATH is set but missing", async () => {
    process.env.KICAD_CLI_PATH = "/nonexistent/path/to/kicad-cli";
    expect(await resolveKicadCli()).toBeNull();
  });

  it("returns the override when KICAD_CLI_PATH points at an executable", async () => {
    // process.execPath (the node binary) is guaranteed to exist and be executable.
    process.env.KICAD_CLI_PATH = process.execPath;
    expect(await resolveKicadCli()).toBe(process.execPath);
  });

  it("falls back to a platform default or the bare PATH name when unset", async () => {
    delete process.env.KICAD_CLI_PATH;
    const resolved = await resolveKicadCli();
    // Either an existing platform-default binary path or the bare "kicad-cli".
    expect(typeof resolved).toBe("string");
    expect(resolved).not.toBe("");
  });
});
