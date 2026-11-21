import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { serviceContextFromEnvironment } from "../service/context.js";
import { fileNameOf, renderPageCliTool } from "./render-page.js";

const MULTIO = join(import.meta.dirname, "../../test/fixtures/cadence/multio/MULTIO.DSN");

describe("render_page on the command line", () => {
  it("writes the PNG to --output and reports where", async () => {
    const output = join(mkdtempSync(join(tmpdir(), "render-")), "page.png");
    const result = (await renderPageCliTool.run(
      { design: MULTIO, page: "P1: PI", output },
      serviceContextFromEnvironment()
    )) as { output: string; image?: unknown };
    expect(result.output).toBe(output);
    expect(result.image).toBeUndefined();
    expect(existsSync(output)).toBe(true);
    expect(readFileSync(output).subarray(1, 4).toString("latin1")).toBe("PNG");
  }, 60_000);

  it("names the default file after the page, in characters a file system takes", () => {
    expect(fileNameOf("P2: I/O")).toBe("P2_I_O.png");
    expect(fileNameOf("  ")).toBe("page.png");
  });
});
