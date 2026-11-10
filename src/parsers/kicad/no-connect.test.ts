/**
 * Intentionally open KiCad pins read as unconnected, so run_erc does not
 * report them as one-pin nets.
 *
 * cm5-minima (test/fixtures/kicad) has every kind of lone pin, and its .net is
 * KiCad's own export:
 * - CN1.3 sits on a no-connect flag (`+no_connect`, `unconnected-(CN1-Pad3)`);
 * - Module301.91 sits on a no-connect flag under the label BT_nDis
 *   (`input+no_connect`, `/CM5/BT_nDis`);
 * - J701.M2 is a pin of electrical type no_connect (`unconnected-(J701-GND2242-PadM2)`);
 * - Module301.99 is alone on `/CM5/GLOBAL_EN` with no flag (`input`), a
 *   one-pin net KiCad's ERC also reports.
 * The sweep below holds every KiCad fixture to the same rule.
 */
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { FIXTURES, fixturePath, hasFixtures } from "../../../test/utils.js";
import { isTestpoint } from "../../circuit-traversal.js";
import { getPinNet } from "../../types.js";
import { nodeFileReader, readText } from "../context.js";
import { resolveKicadArtifacts } from "./discovery.js";
import { childByTag, childrenByTag, childString, parseSexpr, type SExpr } from "./sexpr.js";
import { createNetlistService } from "../../service/index.js";
import { parseKicadNetlist } from "./netlist-parser.js";
import { readKicadSchematicNetlist } from "./schematic/index.js";

const DIR = fixturePath("kicad", "cm5-minima");
const PROJECT = path.join(DIR, "CM5_MINIMA_3.kicad_pro");

const saved = async () =>
  parseKicadNetlist(await readText(nodeFileReader, path.join(DIR, "CM5_MINIMA_3.net")));
const raw = () =>
  readKicadSchematicNetlist(path.join(DIR, "CM5_MINIMA_3.kicad_sch"), nodeFileReader, PROJECT);

// The same design with no saved export, so the service reads the schematics itself.
const schematicOnly = hasFixtures ? mkdtempSync(path.join(tmpdir(), "un-no-connect-")) : "";
if (hasFixtures) {
  cpSync(DIR, schematicOnly, { recursive: true, filter: (source) => !source.endsWith(".net") });
}
afterAll(() => {
  if (schematicOnly) rmSync(schematicOnly, { recursive: true, force: true });
});

describe.skipIf(!hasFixtures)("KiCad no-connect pins (cm5-minima)", () => {
  it.each([
    ["the saved .net", saved],
    ["the raw schematic reader", raw],
  ])("reads open pins as unconnected from %s", async (_source, read) => {
    const netlist = await read();
    const net = (refdes: string, pin: string) => getPinNet(netlist.components[refdes].pins[pin]);
    expect(net("CN1", "3")).toBe("");
    expect(net("Module301", "91")).toBe("");
    expect(net("J701", "M2")).toBe("");
    expect(net("Module301", "99")).toBe("/CM5/GLOBAL_EN");
    for (const name of [
      "unconnected-(CN1-Pad3)",
      "/CM5/BT_nDis",
      "unconnected-(J701-GND2242-PadM2)",
    ]) {
      expect(Object.hasOwn(netlist.nets, name)).toBe(false);
    }
    expect(netlist.nets["/CM5/GLOBAL_EN"]).toEqual({ Module301: ["99"] });
  });

  it.each([
    ["with its saved .net", PROJECT],
    ["from its schematics alone", path.join(schematicOnly, "CM5_MINIMA_3.kicad_pro")],
  ])("run_erc reports only the unflagged open pin, %s", async (_source, design) => {
    const service = createNetlistService();
    const erc = await service.runErc({ design, include_rules: ["net.single_pin"] });
    expect(erc).toMatchObject({
      errors: { "net.single_pin": { "/CM5/GLOBAL_EN": ["Module301.99"] } },
    });
    expect(
      Object.keys((erc as { errors: Record<string, object> }).errors["net.single_pin"])
    ).toEqual(["/CM5/GLOBAL_EN"]);
    expect(await service.queryComponent({ design, refdes: "Module301" })).toMatchObject({
      pins: {
        "91": { name: "BT_nDisable", net: "NC" },
        "99": { name: "PMIC_ENABLE", net: "/CM5/GLOBAL_EN" },
      },
    });
    expect(await service.queryComponent({ design, refdes: "J701" })).toMatchObject({
      pins: { M2: { name: "GND2242", net: "NC" } },
    });
  });
});

/**
 * Every lone pin of a saved KiCad export, as `REFDES.PIN`: `open` when a
 * no-connect flag sits on it or its type is no_connect, `bare` when neither.
 */
const lonePins = (content: string): { open: string[]; bare: string[] } => {
  const root = parseSexpr(content).find((n): n is SExpr[] => Array.isArray(n) && n[0] === "export");
  const found = { open: [] as string[], bare: [] as string[] };
  for (const net of childrenByTag(childByTag(root!, "nets")!, "net")) {
    const nodes = childrenByTag(net, "node");
    const pin = nodes.length === 1 ? childString(nodes[0], "pin") : undefined;
    if (!pin) continue;
    const type = childString(nodes[0], "pintype") ?? "";
    const endpoint = `${childString(nodes[0], "ref")}.${pin}`;
    if (type === "no_connect" || type.endsWith("+no_connect")) found.open.push(endpoint);
    else found.bare.push(endpoint);
  }
  return found;
};

/** Every KiCad fixture project: its directory and its `.kicad_pro`. */
const fixtureProjects = (): [string, string][] => {
  if (!hasFixtures) return [];
  const root = path.join(FIXTURES, "kicad");
  return readdirSync(root)
    .sort()
    .flatMap((design) =>
      readdirSync(path.join(root, design))
        .filter((name) => name.endsWith(".kicad_pro"))
        .map((name): [string, string] => [design, path.join(root, design, name)])
    );
};

describe.skipIf(!hasFixtures)("KiCad fixtures: no-connect pins and run_erc", () => {
  it.each(fixtureProjects())(
    "%s: net.single_pin reports every bare open pin and no flagged one",
    async (_design, project) => {
      const { netlistExport } = await resolveKicadArtifacts(project);
      const { open, bare } = lonePins(await readText(nodeFileReader, netlistExport!));
      const service = createNetlistService();
      const listing = (await service.listDesigns({ path: path.dirname(project) })) as {
        designs: { design_variants: { name: string }[] }[];
      };
      const design_variant = listing.designs[0].design_variants[0].name;
      const erc = (await service.runErc({
        design: project,
        design_variant,
        include_dns: true,
        include_rules: ["net.single_pin"],
      })) as { errors?: { "net.single_pin"?: Record<string, string[]> } };
      const reported = Object.values(erc.errors?.["net.single_pin"] ?? {}).flat();
      expect(reported.filter((endpoint) => open.includes(endpoint))).toEqual([]);
      for (const endpoint of bare.filter((e) => !isTestpoint(e.split(".")[0]))) {
        expect(reported).toContain(endpoint);
      }
    }
  );

  it("cover flagged, no_connect-type and bare lone pins", async () => {
    let open = 0;
    let bare = 0;
    for (const [, project] of fixtureProjects()) {
      const { netlistExport } = await resolveKicadArtifacts(project);
      const pins = lonePins(await readText(nodeFileReader, netlistExport!));
      open += pins.open.length;
      bare += pins.bare.length;
    }
    expect(open).toBeGreaterThan(700);
    expect(bare).toBeGreaterThan(0);
  });
});
