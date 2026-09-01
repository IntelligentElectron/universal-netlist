import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { handleExportJsonCommand } from "./commands.js";
import { parseUniversalNetlist } from "../parsers/universal/reader.js";

const TEST_DIR = path.dirname(new URL(import.meta.url).pathname);
const DEMO = path.resolve(TEST_DIR, "../../test/universal/demo-board.netlist.json");

describe("handleExportJsonCommand", () => {
  let dir: string;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("writes the netlist to the given output path and prints it", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "export-json-"));
    const out = path.join(dir, "board.netlist.json");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await handleExportJsonCommand(DEMO, out);

    expect(log).toHaveBeenCalledWith(out);
    const written = await readFile(out, "utf-8");
    const document = JSON.parse(written);
    expect(document.universalNetlistHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(new Date(document.universalNetlistExportedAt).toISOString()).toBe(
      document.universalNetlistExportedAt
    );
    // The export is itself a loadable Universal Netlist.
    const netlist = parseUniversalNetlist(written, "board.netlist.json");
    expect(netlist.components.U1.mpn).toBe("REG-3V3-SOT23");
    expect(netlist.components.D1.dns).toBe(true);
  });

  it("defaults the output to <design>.netlist.json in the working directory", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "export-json-"));
    const previous = process.cwd();
    process.chdir(dir);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await handleExportJsonCommand(DEMO);
    } finally {
      process.chdir(previous);
    }

    const expected = path.join(await realpath(dir), "demo-board.netlist.json");
    expect(log).toHaveBeenCalledWith(expected);
    expect(
      JSON.parse(await readFile(path.join(dir, "demo-board.netlist.json"), "utf-8")).components.U1
        .mpn
    ).toBe("REG-3V3-SOT23");
  });

  it("exits with the usage line when no design is given", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });

    await expect(handleExportJsonCommand()).rejects.toThrow("exit");
    expect(error).toHaveBeenCalledWith(
      "Usage: universal-netlist export-json <design> [output.netlist.json]"
    );
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("exits with the parser's message on a design that does not load", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "export-json-"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });

    const broken = path.resolve(
      TEST_DIR,
      "../../test/universal/broken/pin-on-other-net.netlist.json"
    );
    await expect(handleExportJsonCommand(broken, path.join(dir, "x.netlist.json"))).rejects.toThrow(
      "exit"
    );
    expect(error).toHaveBeenCalledWith(
      "pin-on-other-net.netlist.json: net 'VCC' lists C1.1, but C1.1 is on 'GND'"
    );
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("refuses an explicit output path without the canonical suffix", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "export-json-"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });

    await expect(handleExportJsonCommand(DEMO, path.join(dir, "board.json"))).rejects.toThrow(
      "exit"
    );
    expect(error).toHaveBeenCalledWith("Universal Netlist output paths must end in .netlist.json");
    expect(exit).toHaveBeenCalledWith(1);
  });
});

const realpath = async (p: string): Promise<string> => {
  const { realpath } = await import("node:fs/promises");
  return realpath(p);
};
