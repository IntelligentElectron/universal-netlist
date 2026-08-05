import { describe, expect, it } from "vitest";
import { analyzeCoverage, formatCoverageReport } from "./dsn-vs-dat-coverage.js";
import type { ParsedNetlist } from "./types.js";

const netlist = (nets: Record<string, Record<string, string[]>>): ParsedNetlist => ({
  nets,
  components: {},
});

describe("connectivity comparison", () => {
  it("counts a net whose pin set is identical as exact", () => {
    const reference = netlist({ SIGNAL: { R1: ["1"], U1: ["A5"] } });
    const dsn = netlist({ SIGNAL: { U1: ["A5"], R1: ["1"] } });

    const result = analyzeCoverage("identical", dsn, reference);

    expect(result.connectivity.common).toBe(1);
    expect(result.connectivity.exact).toBe(1);
    expect(result.connectivity.differing).toBe(0);
    expect(result.connectivity.mismatches).toEqual([]);
  });

  it("flags a net that kept its name but lost a pin to another net", () => {
    const reference = netlist({
      SIGNAL: { R1: ["1"], U1: ["A5"] },
      SIGNAL_1V8: { U2: ["B7"] },
    });
    const dsn = netlist({
      SIGNAL: { R1: ["1"] },
      SIGNAL_1V8: { U2: ["B7"], U1: ["A5"] },
    });

    const result = analyzeCoverage("stolen-pin", dsn, reference);

    expect(result.netCoverage).toBe(1);
    expect(result.connectivity.exact).toBe(0);
    expect(result.connectivity.differing).toBe(2);
    expect(result.connectivity.mismatches).toContainEqual({
      net: "SIGNAL",
      referenceOnly: ["U1.A5"],
      dsnOnly: [],
    });
    expect(result.connectivity.mismatches).toContainEqual({
      net: "SIGNAL_1V8",
      referenceOnly: [],
      dsnOnly: ["U1.A5"],
    });
  });

  it("flags a transposed pin number on an otherwise correct net", () => {
    const reference = netlist({ DVI_DATA9: { RP3: ["13"] } });
    const dsn = netlist({ DVI_DATA9: { RP3: ["12"] } });

    const result = analyzeCoverage("transposed", dsn, reference);

    expect(result.connectivity.differing).toBe(1);
    expect(result.connectivity.mismatches[0]).toEqual({
      net: "DVI_DATA9",
      referenceOnly: ["RP3.13"],
      dsnOnly: ["RP3.12"],
    });
  });

  it("reports full agreement when name coverage and connectivity both hold", () => {
    const reference = netlist({ A: { R1: ["1"] }, B: { R2: ["2"] } });
    const dsn = netlist({ A: { R1: ["1"] }, B: { R2: ["2"] } });

    const result = analyzeCoverage("clean", dsn, reference);

    expect(result.connectivity.exact).toBe(2);
    expect(result.connectivity.differing).toBe(0);
  });

  it("only compares nets present in both netlists", () => {
    const reference = netlist({ A: { R1: ["1"] }, ONLY_IN_REF: { R9: ["9"] } });
    const dsn = netlist({ A: { R1: ["1"] }, ONLY_IN_DSN: { R8: ["8"] } });

    const result = analyzeCoverage("disjoint", dsn, reference);

    expect(result.connectivity.common).toBe(1);
    expect(result.connectivity.exact).toBe(1);
  });

  it("caps stored mismatch examples but keeps the full differing count", () => {
    const nets: Record<string, Record<string, string[]>> = {};
    const wrong: Record<string, Record<string, string[]>> = {};
    for (let i = 0; i < 30; i++) {
      nets[`NET${i}`] = { R1: ["1"] };
      wrong[`NET${i}`] = { R1: ["2"] };
    }

    const result = analyzeCoverage("many", netlist(wrong), netlist(nets));

    expect(result.connectivity.differing).toBe(30);
    expect(result.connectivity.mismatches).toHaveLength(20);
  });

  it("surfaces a Conn column and aggregate line in the report", () => {
    const reference = netlist({ A: { R1: ["1"] }, B: { R2: ["2"] } });
    const dsn = netlist({ A: { R1: ["1"] }, B: { R2: ["9"] } });

    const results = [
      analyzeCoverage("one", dsn, reference),
      analyzeCoverage("two", dsn, reference),
    ];
    const report = formatCoverageReport(results);

    expect(report).toContain("Conn");
    expect(report).toContain("Conn:    2/4");
    expect(report).toContain("2 nets with differing pin sets");
  });
});
