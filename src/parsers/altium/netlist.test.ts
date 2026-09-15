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

  it("keeps a provisional net's plain name ahead of numbering a duplicate", () => {
    const renames = settleProvisionalNames(
      nets("SIG", `SIG${PROVISIONAL}1`, `SIG_2${PROVISIONAL}2`)
    );
    expect(renames.get(`SIG_2${PROVISIONAL}2`)).toBe("SIG_2");
    expect(renames.get(`SIG${PROVISIONAL}1`)).toBe("SIG_3");
  });

  it("numbers names that differ only in case by instance", () => {
    const renames = settleProvisionalNames(nets(`abc${PROVISIONAL}1`, `ABC${PROVISIONAL}2`));
    expect(renames.get(`abc${PROVISIONAL}1`)).toBe("abc");
    expect(renames.get(`ABC${PROVISIONAL}2`)).toBe("ABC_2");
  });
});
