import { describe, expect, it } from "vitest";
import { NetNameIndex } from "./net-names.js";

const LONG_A = "PTA0/JTAG_TCLK/SWD_CLK/EZP_CLK/UART0_CTS_B";
const LONG_B = "PTA0/JTAG_TCLK/SWD_CLK/EZP_CLK/FTM0_CH5";
const PREFIX = "PTA0/JTAG_TCLK/SWD_CLK/EZP_CLK/";

describe("NetNameIndex.resolve", () => {
  const index = new NetNameIndex([
    "SIGNAL_A ",
    " SIGNAL_B",
    "SIGNAL_C",
    " SIGNAL_C",
    "TYPE C_USB_DP",
    "PTA2/JTAG_TDO/TRACE_SWO/EZP_D0/UART0_TX/FTM0_CH7",
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
      net: "PTA2/JTAG_TDO/TRACE_SWO/EZP_D0/UART0_TX/FTM0_CH7",
    });
  });

  it("returns every long net sharing a 31-character prefix", () => {
    expect(index.resolve(PREFIX)).toEqual({
      status: "ambiguous",
      reason: "truncated",
      candidates: [LONG_B, LONG_A],
    });
  });

  it("matches a prefix of another length to nothing", () => {
    expect(index.resolve("PTA2/JTAG_TDO/TRACE_SWO/EZP_D0")).toEqual({ status: "missing" });
    expect(index.resolve("PTA2/JTAG_TDO/TRACE_SWO/EZP_D0/U")).toEqual({ status: "missing" });
  });

  it("reports a name it cannot place as missing", () => {
    expect(index.resolve("NOPE")).toEqual({ status: "missing" });
    expect(index.resolve("   ")).toEqual({ status: "missing" });
  });
});

describe("NetNameIndex warnings", () => {
  it("gives a padded net its trimmed netlist name", () => {
    const index = new NetNameIndex(["SIGNAL_A ", " SIGNAL_B", "  BOTH  "]);
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
    expect(new NetNameIndex(["TYPE C_UART_5V"]).warningFor("TYPE C_UART_5V")).toBeUndefined();
  });

  it("gives no netlist name to a net that reads the same as another once trimmed", () => {
    const index = new NetNameIndex(["SIGNAL_C", " SIGNAL_C", "SIGNAL_C "]);
    const warning = index.warningFor(" SIGNAL_C");
    expect(warning?.netlist_name).toBeUndefined();
    expect(warning?.same_name_after_trim).toEqual(["SIGNAL_C", "SIGNAL_C "]);
    expect(warning?.message).toContain("ORCAP-36005");
    // The bare name is a valid name, and only the padded nets carry a warning.
    expect(index.warningFor("SIGNAL_C")).toBeUndefined();
    expect(index.collisions()).toEqual(
      new Map([["SIGNAL_C", [" SIGNAL_C", "SIGNAL_C", "SIGNAL_C "]]])
    );
  });

  it("flags a name that is nothing but whitespace", () => {
    const warning = new NetNameIndex([" "]).warningFor(" ");
    expect(warning?.problem).toBe("whitespace_only");
    expect(warning?.netlist_name).toBeUndefined();
  });

  it("attaches the objects that name the net", () => {
    const sources = { "SIGNAL_A ": [{ kind: "net_alias" as const, page: "PAGE1", x: 10, y: 20 }] };
    const index = new NetNameIndex(["SIGNAL_A "], sources);
    expect(index.warningFor("SIGNAL_A ")?.sources).toEqual(sources["SIGNAL_A "]);
  });

  it("lists each net's warning once, in name order", () => {
    const index = new NetNameIndex(["Z ", "A ", "OK"]);
    expect(index.warningsFor(["Z ", "OK", "A ", "Z "]).map((w) => w.net)).toEqual(["A ", "Z "]);
  });
});
