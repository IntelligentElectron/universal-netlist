import { describe, it, expect, vi, afterEach } from "vitest";
import { existsSync } from "node:fs";
import type { ParsedNetlist } from "../../types.js";
import { isErrorResult } from "../../types.js";
import * as parsersModule from "../../parsers/index.js";
import { runErc, type ErcResult } from "./run-erc.js";
import { fixturePath, hasFixtures } from "../../../test/utils.js";

const DESIGN = "/mock/design.dsn";

const mockNetlist = (netlist: ParsedNetlist): void => {
  vi.spyOn(parsersModule, "findHandler").mockReturnValue({
    name: "mock",
    extensions: [".dsn"],
    canHandle: () => true,
    discoverDesigns: vi.fn(),
    parse: vi.fn(),
  });
  vi.spyOn(parsersModule, "parseDesign").mockResolvedValue(netlist);
};

const erc = async (netlist: ParsedNetlist, opts?: Parameters<typeof runErc>[1]) => {
  mockNetlist(netlist);
  const result = await runErc(DESIGN, opts);
  expect(isErrorResult(result)).toBe(false);
  return result as ErcResult;
};

afterEach(() => vi.restoreAllMocks());

describe("runErc rules", () => {
  it("flags net.single_pin (R=1, T=0) with the endpoint as a length-1 array", async () => {
    const r = await erc({
      nets: { SIG: { R1: ["1"] }, VCC: { R1: ["2"], U1: ["1"] } },
      components: { R1: { pins: { "1": "SIG", "2": "VCC" } }, U1: { pins: { "1": "VCC" } } },
    });
    expect(r.errors?.["net.single_pin"]).toEqual({ SIG: ["R1.1"] });
  });

  it("flags net.testpoint_orphan (R=0, T>=1)", async () => {
    const r = await erc({
      nets: { TPNET: { TP1: ["1"], TP2: ["1"] }, OK: { U1: ["1"], U2: ["1"] } },
      components: {
        TP1: { pins: { "1": "TPNET" } },
        TP2: { pins: { "1": "TPNET" } },
        U1: { pins: { "1": "OK" } },
        U2: { pins: { "1": "OK" } },
      },
    });
    const orphan = r.errors?.["net.testpoint_orphan"] as Record<string, string[]>;
    expect([...orphan.TPNET].sort()).toEqual(["TP1.1", "TP2.1"]);
  });

  it("flags net.testpoint_stub (R=1, T>=1) and not single_pin", async () => {
    const r = await erc({
      nets: { STUB: { U1: ["5"], TP1: ["1"] } },
      components: { U1: { pins: { "5": "STUB" } }, TP1: { pins: { "1": "STUB" } } },
    });
    const stub = r.warnings?.["net.testpoint_stub"] as Record<string, string[]>;
    expect([...stub.STUB].sort()).toEqual(["TP1.1", "U1.5"]);
    expect(r.errors).toBeUndefined(); // mutual exclusion: a stub is never also single_pin
  });

  it("flags net.unnamed (auto-named, R>=2) as a bare net array", async () => {
    const r = await erc({
      nets: {
        "Net-(D1-A)": { U1: ["1"], U2: ["1"] },
        "unconnected-(J1-X)": { U3: ["1"], U4: ["1"] },
        NAMED: { U5: ["1"], U6: ["1"] },
      },
      components: Object.fromEntries(
        ["U1", "U2", "U3", "U4", "U5", "U6"].map((r) => [r, { pins: {} }])
      ),
    });
    const unnamed = r.warnings?.["net.unnamed"] as string[];
    expect([...unnamed].sort()).toEqual(["Net-(D1-A)", "unconnected-(J1-X)"]);
  });

  it("reports an auto-named single-pin net only under single_pin, not net.unnamed", async () => {
    const r = await erc({
      nets: { "Net-(R5-Pad2)": { R5: ["2"] } },
      components: { R5: { pins: { "2": "Net-(R5-Pad2)" } } },
    });
    expect(r.errors?.["net.single_pin"]).toEqual({ "Net-(R5-Pad2)": ["R5.2"] });
    expect(r.warnings).toBeUndefined();
  });

  it("skips the normalized NC net", async () => {
    const r = await erc({
      nets: { NC: { U1: ["1"], U2: ["1"] } },
      components: { U1: { pins: { "1": "NC" } }, U2: { pins: { "1": "NC" } } },
    });
    expect(r.errors).toBeUndefined();
    expect(r.warnings).toBeUndefined();
  });
});

describe("runErc DNS handling", () => {
  const dnsNetlist: ParsedNetlist = {
    nets: { SIG: { U1: ["1"], R1: ["1"] } },
    components: { U1: { pins: { "1": "SIG" } }, R1: { dns: true, pins: { "1": "SIG" } } },
  };

  it("excludes DNS pins from counts and reports skipped.dns", async () => {
    const r = await erc(structuredClone(dnsNetlist));
    expect(r.skipped).toEqual({ dns: 1 });
    expect(r.errors?.["net.single_pin"]).toEqual({ SIG: ["U1.1"] }); // single after R1 dropped
  });

  it("counts DNS pins when include_dns is true (no flag, no skipped)", async () => {
    const r = await erc(structuredClone(dnsNetlist), { includeDns: true });
    expect(r.skipped).toBeUndefined();
    expect(r.errors).toBeUndefined(); // SIG now has two functional pins
  });
});

describe("runErc rule selection", () => {
  const netlist: ParsedNetlist = {
    nets: { SIG: { R1: ["1"] } },
    components: { R1: { pins: { "1": "SIG" } } },
  };

  it("include_rules limits checked to the requested rules", async () => {
    const r = await erc(structuredClone(netlist), { includeRules: ["net.unnamed"] });
    expect(r.checked).toEqual(["net.unnamed"]);
    expect(r.errors).toBeUndefined(); // single_pin was not run
  });

  it("exclude_rules removes a rule from checked and output", async () => {
    const r = await erc(structuredClone(netlist), { excludeRules: ["net.single_pin"] });
    expect(r.checked).not.toContain("net.single_pin");
    expect(r.errors).toBeUndefined();
  });

  it("returns an error for an unknown rule id in include_rules or exclude_rules", async () => {
    mockNetlist(structuredClone(netlist));
    const inc = await runErc(DESIGN, { includeRules: ["net.singel_pin"] });
    expect(isErrorResult(inc)).toBe(true);
    expect((inc as { error: string }).error).toContain("net.singel_pin");

    const exc = await runErc(DESIGN, { excludeRules: ["net.bogus"] });
    expect(isErrorResult(exc)).toBe(true);
    expect((exc as { error: string }).error).toContain("net.bogus");
  });

  it("returns an error for an empty include_rules rather than silently checking nothing", async () => {
    mockNetlist(structuredClone(netlist));
    const r = await runErc(DESIGN, { includeRules: [] });
    expect(isErrorResult(r)).toBe(true);
    expect((r as { error: string }).error).toContain("empty");
  });

  it("an empty design still lists all rules in checked with no findings", async () => {
    const r = await erc({ nets: {}, components: {} });
    expect(r.checked).toEqual([
      "net.single_pin",
      "net.testpoint_orphan",
      "net.testpoint_stub",
      "net.unnamed",
    ]);
    expect(r.errors).toBeUndefined();
    expect(r.warnings).toBeUndefined();
    expect(r.skipped).toBeUndefined();
  });
});

// Integration against a real committed KiCad .net (no kicad-cli, no mocks). This design
// naturally exercises 3 of the 4 rules; net.testpoint_orphan has no fixture (clean designs
// don't leave nets with only test points), so it is covered by the mock tests above.
const RDIMM = fixturePath("kicad", "rdimm-ddr4-tester", "data-center-rdimm-ddr4-tester.kicad_pro");
const hasRdimm = hasFixtures && existsSync(RDIMM);

const nonEmptyMap = (v: unknown): Record<string, string[]> => {
  expect(v).toBeDefined();
  const map = v as Record<string, string[]>;
  expect(Object.keys(map).length).toBeGreaterThan(0);
  for (const endpoints of Object.values(map)) expect(Array.isArray(endpoints)).toBe(true);
  return map;
};

describe.skipIf(!hasRdimm)("runErc integration (rdimm-ddr4-tester)", () => {
  it("evaluates the rules against a real design and emits well-formed findings", async () => {
    const result = await runErc(RDIMM);
    expect(isErrorResult(result)).toBe(false);
    const r = result as ErcResult;

    expect(r.checked).toHaveLength(4);
    nonEmptyMap(r.errors?.["net.single_pin"]); // R=1 nets
    nonEmptyMap(r.warnings?.["net.testpoint_stub"]); // real TP-on-single-pin nets
    const unnamed = r.warnings?.["net.unnamed"] as string[];
    expect(Array.isArray(unnamed) && unnamed.length).toBeGreaterThan(0); // bare net[]
    expect(() => JSON.stringify(r)).not.toThrow();
  });
});
