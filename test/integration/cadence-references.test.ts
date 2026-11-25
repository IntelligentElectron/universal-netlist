/**
 * Two Cadence fixtures against references that are not our own output: the
 * netlist of the board BeagleBone AI was laid out from, and Capture's own
 * export of the digital convertor. A golden generated from the `.DSN` parser
 * only guards against change; these say whether the parser is right.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDsnFile } from "../../src/parsers/cadence/dsn/dsn-parser.js";
import { getPinNet, type ParsedNetlist } from "../../src/types.js";
import { fixturePath } from "../utils.js";

const PARSE_TIMEOUT = 60_000;

/** Every pin of a parsed netlist as `refdes.pin` with its net; `NC` is a pin on no net. */
const pinNets = (netlist: ParsedNetlist): Map<string, string> => {
  const nets = new Map<string, string>();
  for (const [refdes, component] of Object.entries(netlist.components)) {
    for (const [pin, entry] of Object.entries(component.pins)) {
      nets.set(`${refdes}.${pin}`, getPinNet(entry));
    }
  }
  return nets;
};

const BBAI = fixturePath("cadence", "beaglebone-ai", "BeagleBone-AI.dsn");

describe.skipIf(!existsSync(BBAI))(
  "BeagleBone AI against its board's netlist",
  { timeout: PARSE_TIMEOUT },
  () => {
    // The board's net table: `S!<net>!<refdes>!<pin>!<pin name>!!!`, an empty
    // net being a pin on no net (the fixture's README has its provenance).
    const board = new Map<string, string>();
    if (existsSync(BBAI)) {
      const table = readFileSync(
        fixturePath("cadence", "beaglebone-ai", "board-netlist.txt"),
        "utf8"
      );
      for (const line of table.split("\n")) {
        if (!line.startsWith("S!")) continue;
        const [, net, refdes, pin] = line.split("!");
        board.set(`${refdes}.${pin}`, net || "NC");
      }
    }
    const schematic = existsSync(BBAI) ? pinNets(parseDsnFile(BBAI)) : new Map<string, string>();

    it("has the board's pins: every pin of every part, and no other", () => {
      expect(board.size).toBe(3135);
      expect([...board.keys()].filter((pin) => !schematic.has(pin))).toEqual([]);
      expect([...schematic.keys()].filter((pin) => !board.has(pin))).toEqual([]);
    });

    // U4 is the AM5729: 29 sections numbered -1 to -29, the first 25 drawn
    // under lettered symbol names. Read by letter, 25 sections found no pin
    // map and their pins took the ordinals 1, 2, 3, ... (issue #327).
    it("reads all 760 balls of U4 by their ball names", () => {
      const balls = [...schematic.keys()].filter((pin) => pin.startsWith("U4."));

      expect(balls).toHaveLength(760);
      expect(balls.filter((pin) => !/^U4\.[A-Z]{1,2}\d{1,2}$/.test(pin))).toEqual([]);
    });

    it("puts every pin on the board's net, but for three rails the board joins", () => {
      const differing = [...board]
        .filter(([pin, net]) => schematic.get(pin) !== net)
        .map(([pin, net]) => `${pin}: board ${net}, schematic ${schematic.get(pin)}`)
        .sort();

      // The schematic names these rails apart and the board routes each pair
      // as one net; the schematic PDF prints the schematic's names.
      expect(differing).toEqual([
        "U4.AA13: board 1V8_PHY_SATA, schematic 1V8_PHY_USB",
        "U4.AA16: board 1V8_PHY_HDMI, schematic 1V8_PHY_PCIE",
        "U4.AA17: board 1V8_PHY_HDMI, schematic 1V8_PHY_PCIE",
        "U4.AB12: board 1V8_PHY_SATA, schematic 1V8_PHY_USB",
        "U4.N11: board 1V8_PLLA, schematic 1V8_PLLB",
        "U4.N12: board 1V8_PLLA, schematic 1V8_PLLB",
        "U4.P14: board 1V8_PLLA, schematic 1V8_PLLB",
        "U4.P15: board 1V8_PLLA, schematic 1V8_PLLB",
        "U4.P16: board 1V8_PLLA, schematic 1V8_PLLB",
        "U4.W12: board 1V8_PHY_SATA, schematic 1V8_PHY_USB",
        "U4.W14: board 1V8_PHY_HDMI, schematic 1V8_PHY_PCIE",
      ]);
    });
  }
);

const CONVERTOR = fixturePath("cadence", "digital-convertor", "DIGITAL_CONVERTOR.DSN");

describe.skipIf(!existsSync(CONVERTOR))(
  "the digital convertor against Capture's export",
  { timeout: PARSE_TIMEOUT },
  () => {
    const exported = (name: string): string =>
      existsSync(CONVERTOR)
        ? readFileSync(fixturePath("cadence", "digital-convertor", "allegro", name), "utf8")
        : "";

    // pstxnet.dat: `NET_NAME`, the quoted net on the next line, then one
    // `NODE_NAME<tab><refdes> <pin>` per pin of the net.
    const nodes = new Map<string, string>();
    let net = "";
    const lines = exported("pstxnet.dat,3").split(/\r?\n/);
    lines.forEach((line, i) => {
      if (line === "NET_NAME") net = lines[i + 1].replace(/^'|'$/g, "");
      const node = /^NODE_NAME\t(\S+) (\S+)$/.exec(line);
      if (node) nodes.set(`${node[1]}.${node[2]}`, net);
    });
    const schematic = existsSync(CONVERTOR)
      ? pinNets(parseDsnFile(CONVERTOR))
      : new Map<string, string>();

    // The Cache holds two parts named R, from two libraries, with pin maps
    // 1,2 and 2,1. The resistors were placed from the second; read from the
    // first, all nine had pins 1 and 2 swapped (issue #327).
    it("puts every node of the export on the export's net", () => {
      expect(nodes.size).toBe(42);
      expect(
        [...nodes]
          .filter(([pin, exportNet]) => schematic.get(pin) !== exportNet)
          .map(([pin, exportNet]) => `${pin}: export ${exportNet}, ours ${schematic.get(pin)}`)
      ).toEqual([]);
    });

    it("has no other connected pin but the supply pins the export lists as POWER_PINS", () => {
      // pstchip.dat: POWER_PINS='(VCC:14)' and '(GND:7)' on the 7414, U1.
      const powerPins = [...exported("pstchip.dat,3").matchAll(/POWER_PINS='\((\w+):(\w+)\)'/g)]
        .map(([, powerNet, pin]) => `U1.${pin} on ${powerNet}`)
        .sort();
      const extra = [...schematic]
        .filter(([pin, ours]) => !nodes.has(pin) && ours !== "NC")
        .map(([pin, ours]) => `${pin} on ${ours}`)
        .sort();

      expect(powerPins).toEqual(["U1.14 on VCC", "U1.7 on GND"]);
      expect(extra).toEqual(powerPins);
    });
  }
);
