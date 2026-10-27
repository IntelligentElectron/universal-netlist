import { describe, expect, it } from "vitest";
import { fixturePath, hasFixtures } from "../../test/utils.js";
import { listNets } from "./index.js";

describe.skipIf(!hasFixtures)("positional wrappers", () => {
  const design = fixturePath("cadence", "multio", "MULTIO.DSN");

  it("reads an empty design variant as none, as they always have", async () => {
    const none = await listNets(design);
    expect(none).toMatchObject({ design_variant: "<Default>" });
    expect(await listNets(design, "")).toEqual(none);
  });
});
