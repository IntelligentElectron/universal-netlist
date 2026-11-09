/**
 * Intentionally open KiCad pins read as unconnected, so run_erc does not
 * report them as one-pin nets.
 *
 * test/kicad/no-connect is a small hand-drawn design, and its .net is the
 * export of kicad-cli 10.0.8:
 * - R1.1 sits on a no-connect flag (`passive+no_connect`, `unconnected-(R1-Pad1)`);
 * - U1.1 sits on a no-connect flag and carries the label SPARE_A
 *   (`passive+no_connect`, `/SPARE_A`);
 * - U1.3 is a pin of electrical type no_connect (`no_connect`);
 * - R2.1 is left open with no flag (`passive`), a mistake KiCad's ERC also reports;
 * - R1.2, R2.2 and U1.2 share the net /SIG.
 */
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { FIXTURES, hasFixtures } from "../../../test/utils.js";
import { isTestpoint } from "../../circuit-traversal.js";
import { nodeFileReader, readText } from "../context.js";
import { resolveKicadArtifacts } from "./discovery.js";
import { childByTag, childrenByTag, childString, parseSexpr, type SExpr } from "./sexpr.js";
import { createNetlistService } from "../../service/index.js";
import { netlistDifferences } from "../../../test/helpers/netlist-compare.js";
import { parseKicadNetlist } from "./netlist-parser.js";
import { readKicadSchematicNetlist } from "./schematic/index.js";

const DIR = path.resolve(__dirname, "../../../test/kicad/no-connect");
const PROJECT = path.join(DIR, "no-connect.kicad_pro");

const saved = async () =>
  parseKicadNetlist(await readText(nodeFileReader, path.join(DIR, "no-connect.net")));
const raw = () =>
  readKicadSchematicNetlist(path.join(DIR, "no-connect.kicad_sch"), nodeFileReader, PROJECT);

// The same design with no saved export, so the service reads the schematic itself.
const schematicOnly = mkdtempSync(path.join(tmpdir(), "un-no-connect-"));
for (const file of ["no-connect.kicad_pro", "no-connect.kicad_sch"]) {
  copyFileSync(path.join(DIR, file), path.join(schematicOnly, file));
}
afterAll(() => rmSync(schematicOnly, { recursive: true, force: true }));

describe("KiCad no-connect pins", () => {
  it.each([
    ["the saved .net", saved],
    ["the raw schematic reader", raw],
  ])("reads open pins as unconnected from %s", async (_source, read) => {
    const netlist = await read();
    expect(netlist.components.R1.pins).toEqual({ "1": "", "2": "/SIG" });
    expect(netlist.components.R2.pins).toEqual({ "1": "unconnected-(R2-Pad1)", "2": "/SIG" });
    expect(netlist.components.U1.pins).toEqual({
      "1": { name: "A", net: "" },
      "2": { name: "B", net: "/SIG" },
      "3": { name: "NC", net: "" },
    });
    expect(netlist.nets).toEqual({
      "/SIG": { R1: ["2"], R2: ["2"], U1: ["2"] },
      "unconnected-(R2-Pad1)": { R2: ["1"] },
    });
  });

  it("reads the schematic as kicad-cli exports it", async () => {
    expect(netlistDifferences(await saved(), await raw())).toEqual([]);
  });

  it.each([
    ["with its saved .net", PROJECT],
    ["from its schematic alone", path.join(schematicOnly, "no-connect.kicad_pro")],
  ])("run_erc reports only the unflagged open pin, %s", async (_source, design) => {
    const service = createNetlistService();
    const erc = await service.runErc({ design, include_rules: ["net.single_pin"] });
    expect(erc).toMatchObject({
      errors: { "net.single_pin": { "unconnected-(R2-Pad1)": ["R2.1"] } },
    });
    expect(await service.queryComponent({ design, refdes: "U1" })).toMatchObject({
      pins: {
        "1": { name: "A", net: "NC" },
        "2": { name: "B", net: "/SIG" },
        "3": { name: "NC", net: "NC" },
      },
    });
    expect(await service.listNets({ design })).toMatchObject({
      nets: ["/SIG", "unconnected-(R2-Pad1)"],
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
