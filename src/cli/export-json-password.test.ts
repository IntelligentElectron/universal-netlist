import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";
const mocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), parse: vi.fn() }));
vi.mock("node:fs", async (original) => ({
  ...(await original<typeof import("node:fs")>()),
  readFileSync: mocks.read,
  writeFileSync: mocks.write,
}));
vi.mock("../parsers/index.js", async (original) => ({
  ...(await original<typeof import("../parsers/index.js")>()),
  parseDesign: mocks.parse,
}));
import { handleExportJsonCommand } from "./commands.js";
const originalTty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
beforeEach(() => {
  vi.clearAllMocks();
  mocks.parse.mockRejectedValue(new Error("parser sentinel"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation(() => {
    throw new Error("exit");
  });

  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: false });
});
afterEach(() => {
  vi.restoreAllMocks();
  if (originalTty) Object.defineProperty(process.stdin, "isTTY", originalTty);
  else Reflect.deleteProperty(process.stdin, "isTTY");
});
describe("export-json password input", () => {
  it("passes stdin password without trimming meaningful spaces", async () => {
    mocks.read.mockReturnValue(" synthetic password \r\n");
    await expect(handleExportJsonCommand("board.DSN", undefined, true)).rejects.toThrow("exit");
    expect(mocks.read).toHaveBeenCalledWith(0, "utf-8");
    expect(mocks.parse).toHaveBeenCalledWith(resolve("board.DSN"), {
      password: " synthetic password ",
    });
    expect(mocks.write).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith("parser sentinel");
  });
  it("does not read stdin unless explicitly requested", async () => {
    await expect(handleExportJsonCommand("board.DSN")).rejects.toThrow("exit");
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.parse).toHaveBeenCalledWith(resolve("board.DSN"), undefined);
  });
  it.each(["board.kicad_pro", "board.netlist.json", "board.PrjPcb", "board.olb", "board.txt"])(
    "rejects password input for %s",
    async (source) => {
      await expect(handleExportJsonCommand(source, undefined, true)).rejects.toThrow("exit");
      expect(mocks.read).not.toHaveBeenCalled();
      expect(mocks.parse).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith(
        "--password-stdin is only supported for OrCAD .DSN files"
      );
    }
  );
  it("refuses an unmasked terminal prompt", async () => {
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
    await expect(handleExportJsonCommand("board.DSN", undefined, true)).rejects.toThrow("exit");
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.parse).not.toHaveBeenCalled();
  });
});
