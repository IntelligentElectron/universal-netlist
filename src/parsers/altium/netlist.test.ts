import { describe, it, expect } from "vitest";
import {
  LOCAL,
  PROVISIONAL,
  canonicalNetName,
  restoreLocalNames,
  settleProvisionalNames,
} from "./netlist.js";

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

describe("restoreLocalNames", () => {
  it("gives sheet-local names back their plain spelling, provisional marks kept", () => {
    const renames = restoreLocalNames({
      [`SCK${LOCAL}1`]: {},
      [`SCK${LOCAL}2`]: {},
      [`EN${PROVISIONAL}top${LOCAL}3`]: {},
      MSCK: {},
    });
    expect(renames).toEqual(
      new Map([
        [`SCK${LOCAL}1`, "SCK"],
        [`SCK${LOCAL}2`, "SCK"],
        [`EN${PROVISIONAL}top${LOCAL}3`, `EN${PROVISIONAL}top`],
      ])
    );
  });
});

describe("canonicalNetName", () => {
  it("keeps the lowest designator and pin among pin names, not the first by character", () => {
    const pin = (): boolean => true;
    expect(canonicalNetName(["NetU13_1", "NetU1_11"], () => 5, pin)).toBe("NetU1_11");
    expect(canonicalNetName(["NetR116_1", "NetR11_1"], () => 5, pin)).toBe("NetR11_1");
  });
});
