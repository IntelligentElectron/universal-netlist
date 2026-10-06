import { describe, expect, it } from "vitest";
import { NetNameIndex } from "./net-names.js";
import type { NetLabelSource } from "../types.js";

const LONG_A = "PTA0/JTAG_TCLK/SWD_CLK/EZP_CLK/UART0_CTS_B";
const LONG_B = "PTA0/JTAG_TCLK/SWD_CLK/EZP_CLK/FTM0_CH5";
const PREFIX = "PTA0/JTAG_TCLK/SWD_CLK/EZP_CLK/";
const PTA2 = "PTA2/JTAG_TDO/TRACE_SWO/EZP_D0/UART0_TX/FTM0_CH7";

const cadence = (names: string[], sources?: Record<string, NetLabelSource[]>) =>
  new NetNameIndex(names, { allegro: true, sources });

const alias = (text: string): NetLabelSource => ({
  kind: "net_alias",
  text,
  page: "PAGE1",
  x: 10,
  y: 20,
});

describe("NetNameIndex.resolve", () => {
  const index = cadence([
    "SIGNAL_A ",
    " SIGNAL_B",
    "SIGNAL_C",
    " SIGNAL_C",
    "TYPE C_USB_DP",
    PTA2,
    LONG_A,
    LONG_B,
  ]);

  it("returns an exact match as it is", () => {
    expect(index.resolve("SIGNAL_A ")).toEqual({ status: "exact", net: "SIGNAL_A " });
    expect(index.resolve("TYPE C_USB_DP")).toEqual({ status: "exact", net: "TYPE C_USB_DP" });
  });

  it("matches the trimmed name the netlister writes to the padded net", () => {
    expect(index.resolve("SIGNAL_A")).toEqual({ status: "whitespace", net: "SIGNAL_A " });
    expect(index.resolve("SIGNAL_B")).toEqual({ status: "whitespace", net: " SIGNAL_B" });
  });

  it("ignores whitespace on the name passed in", () => {
    expect(index.resolve(" SIGNAL_B ")).toEqual({ status: "whitespace", net: " SIGNAL_B" });
  });

  it("never moves an exact name onto a net that differs only by whitespace", () => {
    expect(index.resolve("SIGNAL_C")).toEqual({ status: "exact", net: "SIGNAL_C" });
    expect(index.resolve(" SIGNAL_C")).toEqual({ status: "exact", net: " SIGNAL_C" });
  });

  it("returns every net a name could mean when they differ only by whitespace", () => {
    expect(index.resolve("SIGNAL_C ")).toEqual({
      status: "ambiguous",
      reason: "whitespace",
      candidates: [" SIGNAL_C", "SIGNAL_C"],
    });
  });

  it("matches a 31-character name to the one long net it cuts", () => {
    expect(index.resolve("PTA2/JTAG_TDO/TRACE_SWO/EZP_D0/")).toEqual({
      status: "truncated",
      net: PTA2,
    });
  });

  it("returns every long net sharing a 31-character prefix", () => {
    expect(index.resolve(PREFIX)).toEqual({
      status: "ambiguous",
      reason: "truncated",
      candidates: [LONG_B, LONG_A],
    });
  });

  it("weighs a whitespace match against long nets sharing the 31 characters", () => {
    const padded = PREFIX + " ";
    expect(cadence([padded, LONG_A]).resolve(PREFIX)).toEqual({
      status: "ambiguous",
      reason: "whitespace_or_truncated",
      candidates: [LONG_A, padded].sort(),
    });
    expect(cadence([padded]).resolve(PREFIX)).toEqual({ status: "whitespace", net: padded });
  });

  it("matches a prefix of another length to nothing", () => {
    expect(index.resolve("PTA2/JTAG_TDO/TRACE_SWO/EZP_D0")).toEqual({ status: "missing" });
    expect(index.resolve("PTA2/JTAG_TDO/TRACE_SWO/EZP_D0/U")).toEqual({ status: "missing" });
  });

  it("reports a name it cannot place as missing", () => {
    expect(index.resolve("NOPE")).toEqual({ status: "missing" });
    expect(index.resolve("   ")).toEqual({ status: "missing" });
  });

  it("matches a padded block label by its name without the whitespace", () => {
    const blockNet = "SIG _U1";
    const block = cadence([blockNet, "SIG _U2"], {
      [blockNet]: [alias("SIG ")],
      "SIG _U2": [alias("SIG ")],
    });
    expect(block.resolve("SIG_U1")).toEqual({ status: "whitespace", net: blockNet });
  });
});

describe("NetNameIndex outside Cadence", () => {
  const index = new NetNameIndex(["SIGNAL_A ", PTA2]);

  it("does not apply the Allegro 31-character cut", () => {
    expect(index.resolve("PTA2/JTAG_TDO/TRACE_SWO/EZP_D0/")).toEqual({ status: "missing" });
  });

  it("still matches and warns on whitespace, without an Allegro name", () => {
    expect(index.resolve("SIGNAL_A")).toEqual({ status: "whitespace", net: "SIGNAL_A " });
    const warning = index.warningFor("SIGNAL_A ");
    expect(warning?.netlist_name).toBeUndefined();
    expect(warning?.message).not.toContain("Allegro");
  });
});

describe("NetNameIndex warnings", () => {
  it("gives a padded net its trimmed netlist name", () => {
    const index = cadence(["SIGNAL_A ", " SIGNAL_B", "  BOTH  "]);
    expect(index.warningFor("SIGNAL_A ")).toMatchObject({
      net: "SIGNAL_A ",
      netlist_name: "SIGNAL_A",
      problem: "trailing_whitespace",
    });
    expect(index.warningFor(" SIGNAL_B")).toMatchObject({
      netlist_name: "SIGNAL_B",
      problem: "leading_whitespace",
    });
    expect(index.warningFor("  BOTH  ")).toMatchObject({
      netlist_name: "BOTH",
      problem: "leading_and_trailing_whitespace",
    });
  });

  it("leaves names with only inner spaces alone", () => {
    // The Jetson fixtures export "TYPE C_UART_5V" unchanged.
    expect(cadence(["TYPE C_UART_5V"]).warningFor("TYPE C_UART_5V")).toBeUndefined();
  });

  it("gives no netlist name to a net that reads the same as another once trimmed", () => {
    const index = cadence(["SIGNAL_C", " SIGNAL_C", "SIGNAL_C "]);
    const warning = index.warningFor(" SIGNAL_C");
    expect(warning?.netlist_name).toBeUndefined();
    expect(warning?.same_name_after_trim).toEqual(["SIGNAL_C", "SIGNAL_C "]);
    expect(warning?.message).toContain("ORCAP-36005");
    // The bare name is a valid name, and only the padded nets carry a warning.
    expect(index.warningFor("SIGNAL_C")).toBeUndefined();
    expect(index.flaggedNets()).toEqual([" SIGNAL_C", "SIGNAL_C "]);
    expect(index.collidingNets()).toEqual([" SIGNAL_C", "SIGNAL_C", "SIGNAL_C "]);
  });

  it("flags a padded label inside a block, where the suffix follows the whitespace", () => {
    const index = cadence(["SIG _U1", "OK_U1"], { "SIG _U1": [alias("SIG ")] });
    const warning = index.warningFor("SIG _U1");
    expect(warning?.problem).toBe("whitespace_before_block_suffix");
    expect(warning?.netlist_name).toBeUndefined();
    expect(warning?.sources?.[0].text).toBe("SIG ");
    expect(index.flaggedNets()).toEqual(["SIG _U1"]);
  });

  it("finds a block net colliding with a net already named without the whitespace", () => {
    const index = cadence(["SIG _U1", "SIG_U1"], { "SIG _U1": [alias("SIG ")] });
    expect(index.collidingNets()).toEqual(["SIG _U1", "SIG_U1"]);
    expect(index.resolve("SIG_U1")).toEqual({ status: "exact", net: "SIG_U1" });
  });

  it("flags a name that is nothing but whitespace", () => {
    const warning = cadence([" "]).warningFor(" ");
    expect(warning?.problem).toBe("whitespace_only");
    expect(warning?.netlist_name).toBeUndefined();
  });

  it("treats the no-connect placeholder as no net", () => {
    const index = cadence(["NC", " NC"]);
    expect(index.collidingNets()).toEqual([]);
    expect(index.warningFor(" NC")?.netlist_name).toBe("NC");
    expect(index.resolve("NC")).toEqual({ status: "exact", net: "NC" });
  });

  it("attaches the objects that name the net", () => {
    const sources = { "SIGNAL_A ": [alias("SIGNAL_A ")] };
    expect(cadence(["SIGNAL_A "], sources).warningFor("SIGNAL_A ")?.sources).toEqual(
      sources["SIGNAL_A "]
    );
  });

  it("lists each net's warning once, in name order", () => {
    const index = cadence(["Z ", "A ", "OK"]);
    expect(index.warningsFor(["Z ", "OK", "A ", "Z "]).map((w) => w.net)).toEqual(["A ", "Z "]);
  });
});
