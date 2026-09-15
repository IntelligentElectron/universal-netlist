import { describe, it, expect } from "vitest";
import { PROVISIONAL, settleProvisionalNames } from "./netlist.js";

describe("settleProvisionalNames", () => {
  const nets = (...names: string[]) => Object.fromEntries(names.map((name) => [name, {}]));

  it("numbers a name past one another net holds, whatever its case", () => {
    const renames = settleProvisionalNames(nets("VREF_A1", `vref_A1${PROVISIONAL}top/1@1`));
    expect(renames.get(`vref_A1${PROVISIONAL}top/1@1`)).toBe("vref_A1_2");
  });

  it("numbers provisional names in instance order, counting numbers by value", () => {
    const renames = settleProvisionalNames(
      nets("SIG", `SIG${PROVISIONAL}10`, `SIG${PROVISIONAL}2`)
    );
    expect(renames.get(`SIG${PROVISIONAL}2`)).toBe("SIG_2");
    expect(renames.get(`SIG${PROVISIONAL}10`)).toBe("SIG_3");
  });
});
