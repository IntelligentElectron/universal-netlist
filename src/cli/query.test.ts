/**
 * The query command line through the real entry point, in a child process,
 * as an agent in a sandbox runs it.
 */
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { fixturePath, hasFixtures } from "../../test/utils.js";
import { CACHE_DIR_ENV, CACHE_ENV } from "../service/disk-cache.js";

const ENTRY = path.resolve(__dirname, "../index.ts");
const scratch = mkdtempSync(path.join(tmpdir(), "query-cli-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const cli = (args: string[], env: NodeJS.ProcessEnv = {}) => {
  const result = spawnSync(process.execPath, ["--import", "tsx", ENTRY, ...args], {
    encoding: "utf-8",
    input: "",
    env: {
      ...process.env,
      [CACHE_ENV]: "",
      [CACHE_DIR_ENV]: "",
      NODE_NO_WARNINGS: "1",
      ...env,
    },
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
};

describe("query command line", () => {
  it("lists every tool in --help", () => {
    const { code, stdout } = cli(["--help"]);
    expect(code).toBe(0);
    expect(stdout).toContain("query_xnet_by_net_name");
    expect(stdout).toContain("<tool> --help");
  });

  it("refuses a word that is no command or tool, instead of starting the server", () => {
    const { code, stderr } = cli(["serch_nets", "board.DSN"]);
    expect(code).toBe(2);
    expect(stderr).toContain("'serch_nets' is not a command or a tool");
    expect(stderr).toContain("search_nets");
  });

  it("prints a tool's help from the registry", () => {
    const { code, stdout } = cli(["query_xnet_by_net_name", "--help"]);
    expect(code).toBe(0);
    expect(stdout).toContain("Usage: universal-netlist query_xnet_by_net_name <design> --net_name");
    expect(stdout).toContain("--skip_types");
  });

  it("names a missing required flag on stderr, with the usage line, and exits 2", () => {
    const { code, stdout, stderr } = cli(["query_component", "--refdes", "U1"]);
    expect(code).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toContain("--design: required");
    expect(stderr).toContain("usage: universal-netlist query_component");
  });
});

describe.skipIf(!hasFixtures)("query command line on a design", () => {
  const design = fixturePath("cadence", "multio", "MULTIO.DSN");

  it("prints compact JSON for a pipe and exits 0", () => {
    const { code, stdout } = cli(["search_nets", design, "--pattern", "^GPIO"]);
    expect(code).toBe(0);
    expect(stdout.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(stdout)).toEqual({
      design_variant: "<Default>",
      results: { MULTIO: ["GPIO0/2", "GPIO1/3", "GPIO14"] },
    });
  });

  it("reads a command word as a value, not a command", () => {
    const { code, stdout } = cli(["search_nets", design, "--pattern", "help"]);
    expect(JSON.parse(stdout)).toHaveProperty("design_variant");
    expect(code).toBe(0);
  });

  it("exits 1 on a result with an error field", () => {
    const { code, stdout } = cli(["query_xnet_by_net_name", design, "--net_name=NOPE"]);
    expect(code).toBe(1);
    expect(JSON.parse(stdout).error).toContain("Net 'NOPE' not found");
  });

  it("ends quietly when the reader closes the pipe first, as `| head` does", async () => {
    const child = spawn(process.execPath, ["--import", "tsx", ENTRY, "list_nets", design], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });
    child.stdout.destroy();
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const code = await new Promise((resolve) => child.on("close", resolve));
    expect(stderr).toBe("");
    expect(code).toBe(0);
  });

  it("keeps parses on disk with --cache, in the directory named", () => {
    const dir = path.join(scratch, "cache");
    const first = cli(["list_nets", design, "--cache"], {
      XDG_CACHE_HOME: "",
      [CACHE_DIR_ENV]: dir,
    });
    expect(first.code).toBe(0);
    expect(readdirSync(dir).filter((name) => name.endsWith(".json")).length).toBeGreaterThan(0);
    const second = cli(["list_nets", design], { [CACHE_DIR_ENV]: dir });
    expect(second.stdout).toBe(first.stdout);
  });

  it("answers from a corrupt cache entry by parsing", () => {
    const dir = path.join(scratch, "corrupt");
    cli(["list_nets", design], { [CACHE_DIR_ENV]: dir });
    for (const name of readdirSync(dir)) writeFileSync(path.join(dir, name), "{ not json");
    const { code, stdout } = cli(["list_nets", design], { [CACHE_DIR_ENV]: dir });
    expect(code).toBe(0);
    expect(JSON.parse(stdout).nets).toContain("GPIO14");
  });

  it.skipIf(process.platform === "win32")(
    "answers when the cache directory cannot be written",
    () => {
      const locked = path.join(scratch, "locked");
      mkdirSync(locked);
      chmodSync(locked, 0o500);
      try {
        const { code, stdout, stderr } = cli(["list_nets", design], {
          [CACHE_DIR_ENV]: path.join(locked, "cache"),
        });
        expect(code).toBe(0);
        expect(stderr).toBe("");
        expect(JSON.parse(stdout).nets).toContain("GPIO14");
      } finally {
        chmodSync(locked, 0o700);
      }
    }
  );
});
