import { describe, it, expect } from "vitest";
import { COMMANDS, normalizeCliArgs } from "./args.js";

describe("normalizeCliArgs", () => {
  it("turns every command word into its flag", () => {
    for (const command of COMMANDS) {
      expect(normalizeCliArgs([command])).toEqual([`--${command}`]);
    }
  });

  it("reads upgrade as update, as a word and as a flag", () => {
    expect(normalizeCliArgs(["upgrade"])).toEqual(["--update"]);
    expect(normalizeCliArgs(["--upgrade"])).toEqual(["--update"]);
  });

  it("leaves the flag form and short flags alone", () => {
    expect(normalizeCliArgs(["--update"])).toEqual(["--update"]);
    expect(normalizeCliArgs(["-v"])).toEqual(["-v"]);
    expect(normalizeCliArgs(["-h"])).toEqual(["-h"]);
  });

  it("leaves words that are not commands alone", () => {
    expect(normalizeCliArgs(["serve", "--foo", "bar"])).toEqual(["serve", "--foo", "bar"]);
    expect(normalizeCliArgs([])).toEqual([]);
  });

  it("keeps the path after export-json as a path, whatever it is called", () => {
    expect(normalizeCliArgs(["export-json", "board.kicad_pro"])).toEqual([
      "--export-json",
      "board.kicad_pro",
    ]);
    expect(normalizeCliArgs(["export-json", "update"])).toEqual(["--export-json", "update"]);
    expect(normalizeCliArgs(["--export-json", "help"])).toEqual(["--export-json", "help"]);
  });

  it("reads the flag after a command's value as a command", () => {
    expect(normalizeCliArgs(["export-json", "board.DSN", "--help"])).toEqual([
      "--export-json",
      "board.DSN",
      "--help",
    ]);
  });

  it("reads coverage and verbose as plain words", () => {
    expect(normalizeCliArgs(["coverage", "verbose"])).toEqual(["coverage", "verbose"]);
  });
});
