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
    expect(normalizeCliArgs(["export-json", "board.kicad_pro"])).toEqual(["--export-json", "board.kicad_pro"]);
    expect(normalizeCliArgs(["export-json", "update"])).toEqual(["--export-json", "update"]);
    expect(normalizeCliArgs(["--export-json", "coverage"])).toEqual(["--export-json", "coverage"]);
  });

  it("keeps the optional path after coverage, and reads a command word there as a command", () => {
    expect(normalizeCliArgs(["coverage", "designs"])).toEqual(["--coverage", "designs"]);
    expect(normalizeCliArgs(["coverage", "designs", "verbose"])).toEqual(["--coverage", "designs", "--verbose"]);
    expect(normalizeCliArgs(["coverage", "verbose"])).toEqual(["--coverage", "--verbose"]);
    expect(normalizeCliArgs(["--coverage", "--verbose"])).toEqual(["--coverage", "--verbose"]);
    expect(normalizeCliArgs(["coverage", "./update"])).toEqual(["--coverage", "./update"]);
  });

  it("mixes both forms in one call", () => {
    expect(normalizeCliArgs(["--coverage", "fixtures", "verbose"])).toEqual(["--coverage", "fixtures", "--verbose"]);
  });
});
