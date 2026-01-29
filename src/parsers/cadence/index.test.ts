/**
 * Tests for Cadence handler
 *
 * Tests the Cadence-specific pin mapping and post-processing logic.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  buildCadencePinMap,
  parseCadence,
  cadenceHandler,
  type ChipPart,
} from "./index.js";
import type { ComponentDetails, NetConnections } from "../../types.js";
import fs from "fs/promises";
import os from "os";
import path from "path";

describe("buildCadencePinMap", () => {
  it("should skip garbage Cadence instance paths", () => {
    const nets: NetConnections = {
      VCC: {
        U1: "1",
        "@BEAGLEBONEBLK_C.BEAGLEBONEBLACK(SCH_1):INS21415196@LAN8710": "2",
      },
    };
    const components: ComponentDetails = {
      U1: { pins: {} },
    };

    buildCadencePinMap(nets, components, [], new Map());

    // Valid refdes should have pin added
    expect(components["U1"].pins["1"]).toBeDefined();
    // Garbage instance path should NOT be added to components
    expect(
      components["@BEAGLEBONEBLK_C.BEAGLEBONEBLACK(SCH_1):INS21415196@LAN8710"],
    ).toBeUndefined();
  });

  it("should create entries for valid refdes not in components map", () => {
    const nets: NetConnections = {
      VCC: {
        U1: "1",
        U2: "1", // Not in pstxprt components, but valid refdes
      },
    };
    const components: ComponentDetails = {
      U1: { pins: {}, mpn: "TPS62088" },
    };

    buildCadencePinMap(nets, components, [], new Map());

    // Valid refdes in components should have pin added
    expect(components["U1"].pins["1"]).toBeDefined();
    // U2 should be created (valid refdes) but without MPN/description
    expect(components["U2"]).toBeDefined();
    expect(components["U2"].pins["1"]).toBeDefined();
    expect(components["U2"].mpn).toBeUndefined();
  });

  it("should process valid refdes that exist in components", () => {
    const nets: NetConnections = {
      VCC: { U1: "1", R1: "1" },
      GND: { U1: "2", R1: "2" },
    };
    const components: ComponentDetails = {
      U1: { pins: {}, mpn: "TPS62088" },
      R1: { pins: {}, mpn: "10K" },
    };

    buildCadencePinMap(nets, components, [], new Map());

    // Both components should have their pins populated
    expect(components["U1"].pins["1"]).toBeDefined();
    expect(components["U1"].pins["2"]).toBeDefined();
    expect(components["R1"].pins["1"]).toBeDefined();
    expect(components["R1"].pins["2"]).toBeDefined();
  });

  it("should handle multiple pins on same net", () => {
    const nets: NetConnections = {
      VCC: { U1: ["1", "3", "5"] },
    };
    const components: ComponentDetails = {
      U1: { pins: {} },
    };

    buildCadencePinMap(nets, components, [], new Map());

    expect(components["U1"].pins["1"]).toBeDefined();
    expect(components["U1"].pins["3"]).toBeDefined();
    expect(components["U1"].pins["5"]).toBeDefined();
  });

  it("should map pin names from pstchip data", () => {
    const nets: NetConnections = {
      VCC: { U1: "1" },
      GND: { U1: "2" },
    };
    const components: ComponentDetails = {
      U1: { pins: {} },
    };
    const chips: ChipPart[] = [
      {
        part_name: "IC_PACKAGE",
        pins: { VIN: "1", GND: "2" },
        body_properties: {},
      },
    ];
    const partNames = new Map([["U1", "IC_PACKAGE"]]);

    buildCadencePinMap(nets, components, chips, partNames);

    // Pin 1 should have name VIN from pstchip
    const pin1 = components["U1"].pins["1"];
    expect(pin1).toEqual({ name: "VIN", net: "VCC" });

    // Pin 2 should have name GND from pstchip
    const pin2 = components["U1"].pins["2"];
    expect(pin2).toEqual({ name: "GND", net: "GND" });
  });

  it("should extract VALUE from pstchip body_properties", () => {
    const nets: NetConnections = {
      VCC: { C1: "1" },
      GND: { C1: "2" },
    };
    const components: ComponentDetails = {
      C1: { pins: {}, mpn: "CAP_0805" },
    };
    const chips: ChipPart[] = [
      {
        part_name: "CAP_0805",
        pins: { "1": "1", "2": "2" },
        body_properties: { VALUE: "10uF" },
      },
    ];
    const partNames = new Map([["C1", "CAP_0805"]]);

    buildCadencePinMap(nets, components, chips, partNames);

    expect(components["C1"].value).toBe("10uF");
  });

  it("should not overwrite existing value", () => {
    const nets: NetConnections = {
      VCC: { C1: "1" },
    };
    const components: ComponentDetails = {
      C1: { pins: {}, value: "existing_value" },
    };
    const chips: ChipPart[] = [
      {
        part_name: "CAP_0805",
        pins: {},
        body_properties: { VALUE: "new_value" },
      },
    ];
    const partNames = new Map([["C1", "CAP_0805"]]);

    buildCadencePinMap(nets, components, chips, partNames);

    expect(components["C1"].value).toBe("existing_value");
  });

  it("should use simple string for pins without name mapping", () => {
    const nets: NetConnections = {
      VCC: { U1: "1" },
    };
    const components: ComponentDetails = {
      U1: { pins: {} },
    };

    // No chips or partNames, so no pin name mapping
    buildCadencePinMap(nets, components, [], new Map());

    // Pin should be a simple string (net name) since no name mapping
    expect(components["U1"].pins["1"]).toBe("VCC");
  });
});

describe("parseCadence", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cadence-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should return CadenceRawNetlist with partNames for internal use", async () => {
    // Create minimal pstxnet.dat (Cadence format)
    const pstxnetContent = `
NET_NAME
'VCC'
NODE_NAME U1 1
NODE_NAME R1 1

NET_NAME
'GND'
NODE_NAME U1 2
NODE_NAME R1 2
`;
    await fs.writeFile(path.join(tempDir, "pstxnet.dat"), pstxnetContent);

    // Create minimal pstxprt.dat (Cadence format)
    const pstxprtContent = `
PART_NAME
U1 'IC_CHIP':
DESCR='Test IC';

PART_NAME
R1 'RES_0402':
DESCR='Test Resistor';
`;
    await fs.writeFile(path.join(tempDir, "pstxprt.dat"), pstxprtContent);

    const result = await parseCadence({
      pstxnetPath: path.join(tempDir, "pstxnet.dat"),
      pstxprtPath: path.join(tempDir, "pstxprt.dat"),
    });

    // Verify result has partNames (internal type)
    expect(result.partNames).toBeDefined();
    expect(result.partNames).toBeInstanceOf(Map);
    expect(result.partNames.get("U1")).toBe("IC_CHIP");
    expect(result.partNames.get("R1")).toBe("RES_0402");
  });
});

describe("cadenceHandler", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cadence-handler-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should return ParsedNetlist without partNames", async () => {
    // Create design directory structure
    const designDir = path.join(tempDir, "TestDesign");
    const workDir = path.join(designDir, "worklib", "design", "physical");
    await fs.mkdir(workDir, { recursive: true });

    // Create .dsn file to be discovered
    await fs.writeFile(path.join(designDir, "test.dsn"), "");

    // Create minimal pstxnet.dat (Cadence format)
    const pstxnetContent = `
NET_NAME
'VCC'
NODE_NAME U1 1

NET_NAME
'GND'
NODE_NAME U1 2
`;
    await fs.writeFile(path.join(workDir, "pstxnet.dat"), pstxnetContent);

    // Create minimal pstxprt.dat (Cadence format)
    const pstxprtContent = `
PART_NAME
U1 'IC_CHIP':
DESCR='Test IC';
`;
    await fs.writeFile(path.join(workDir, "pstxprt.dat"), pstxprtContent);

    // Create minimal pstchip.dat (Cadence format)
    const pstchipContent = `
primitive 'IC_CHIP'
pin
'VIN':
PIN_NUMBER='(1)';
end_pin;
pin
'GND':
PIN_NUMBER='(2)';
end_pin;
body
VALUE='TestValue';
`;
    await fs.writeFile(path.join(workDir, "pstchip.dat"), pstchipContent);

    // Parse using the handler
    const result = await cadenceHandler.parse(path.join(designDir, "test.dsn"));

    // Verify result does NOT have internal properties (clean ParsedNetlist)
    expect("partNames" in result).toBe(false);
    expect("chips" in result).toBe(false);

    // Verify the netlist is still valid
    expect(result.nets).toBeDefined();
    expect(result.components).toBeDefined();

    // Verify components have their values from pstchip post-processing
    expect(result.components["U1"]).toBeDefined();
    expect(result.components["U1"].value).toBe("TestValue");

    // Verify pins have names from pstchip mapping
    expect(result.components["U1"].pins["1"]).toEqual({
      name: "VIN",
      net: "VCC",
    });
    expect(result.components["U1"].pins["2"]).toEqual({
      name: "GND",
      net: "GND",
    });
  });
});
