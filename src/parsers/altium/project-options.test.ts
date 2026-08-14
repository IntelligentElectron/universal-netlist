import { describe, it, expect } from "vitest";
import {
  parseProjectOptions,
  resolveNetIdentifierScope,
  netLabelsAreGlobal,
  powerPortsAreGlobal,
  DEFAULT_CHANNEL_FORMAT,
} from "./project-options.js";

const design = (...lines: string[]): string => ["[Design]", ...lines].join("\n");

describe("parseProjectOptions", () => {
  it("reads a scope the project names outright", () => {
    expect(parseProjectOptions(design("HierarchyMode=3")).scope).toBe("global");
    expect(parseProjectOptions(design("HierarchyMode=2")).scope).toBe("hierarchical");
    // `4` is read as Hierarchical: the solarcar-bms board numbers that
    // project's sheet-local labels but leaves GND and CHASSIS bare, so its
    // power ports are global and it cannot be Strict Hierarchical.
    expect(parseProjectOptions(design("HierarchyMode=4")).scope).toBe("hierarchical");
  });

  it("leaves the scope open on Automatic, which is the Altium default", () => {
    expect(parseProjectOptions(design("HierarchyMode=0")).scope).toBeUndefined();
  });

  it("reads a mode no design has demonstrated as Automatic rather than guessing", () => {
    // Automatic resolves the scope from the design's own shape, which is
    // evidence; a guessed constant would be wrong everywhere at once.
    expect(parseProjectOptions(design("HierarchyMode=1")).scope).toBeUndefined();
    expect(parseProjectOptions(design("HierarchyMode=97")).scope).toBeUndefined();
  });

  it("leaves the scope open when the project records no mode at all", () => {
    expect(parseProjectOptions("").scope).toBeUndefined();
  });

  it("reads the netlisting flags", () => {
    const options = parseProjectOptions(
      design(
        "AppendSheetNumberToLocalNets=1",
        "AllowPortNetNames=1",
        "AllowSheetEntryNetNames=0",
        "PowerPortNamesTakePriority=1"
      )
    );
    expect(options.appendSheetNumberToLocalNets).toBe(true);
    expect(options.allowPortNetNames).toBe(true);
    expect(options.allowSheetEntryNetNames).toBe(false);
    expect(options.powerPortNamesTakePriority).toBe(true);
  });

  it("falls back to Altium's own defaults for absent flags", () => {
    const options = parseProjectOptions("");
    expect(options.appendSheetNumberToLocalNets).toBe(false);
    expect(options.allowPortNetNames).toBe(false);
    expect(options.allowSheetEntryNetNames).toBe(true);
    expect(options.powerPortNamesTakePriority).toBe(false);
    expect(options.channelFormat).toBe(DEFAULT_CHANNEL_FORMAT);
  });

  it("reads the channel designator format", () => {
    expect(
      parseProjectOptions(design("ChannelDesignatorFormatString=$Component$ChannelAlpha"))
        .channelFormat
    ).toBe("$Component$ChannelAlpha");
  });

  it("reads keys case-insensitively and ignores surrounding space", () => {
    const options = parseProjectOptions(design("  hierarchymode = 3  "));
    expect(options.scope).toBe("global");
  });
});

describe("resolveNetIdentifierScope", () => {
  const automatic = parseProjectOptions(design("HierarchyMode=0"));

  it("keeps a scope the project names, whatever the design draws", () => {
    const global = parseProjectOptions(design("HierarchyMode=3"));
    expect(resolveNetIdentifierScope(global, { hasSheetEntries: true, hasPorts: true })).toBe(
      "global"
    );
  });

  it("reads sheet entries as a hierarchy", () => {
    expect(resolveNetIdentifierScope(automatic, { hasSheetEntries: true, hasPorts: true })).toBe(
      "hierarchical"
    );
  });

  it("reads ports without sheet entries as a flat design", () => {
    expect(resolveNetIdentifierScope(automatic, { hasSheetEntries: false, hasPorts: true })).toBe(
      "flat"
    );
  });

  it("reads a design with neither as global, since only labels can be joining it", () => {
    expect(resolveNetIdentifierScope(automatic, { hasSheetEntries: false, hasPorts: false })).toBe(
      "global"
    );
  });
});

describe("how far each identifier reaches", () => {
  it("carries net labels between sheets only under Global", () => {
    expect(netLabelsAreGlobal("global")).toBe(true);
    expect(netLabelsAreGlobal("flat")).toBe(false);
    expect(netLabelsAreGlobal("hierarchical")).toBe(false);
    expect(netLabelsAreGlobal("strict-hierarchical")).toBe(false);
  });

  it("keeps power ports global everywhere but Strict Hierarchical", () => {
    expect(powerPortsAreGlobal("global")).toBe(true);
    expect(powerPortsAreGlobal("flat")).toBe(true);
    expect(powerPortsAreGlobal("hierarchical")).toBe(true);
    expect(powerPortsAreGlobal("strict-hierarchical")).toBe(false);
  });
});
