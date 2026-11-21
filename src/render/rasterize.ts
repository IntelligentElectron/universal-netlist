/**
 * SVG to PNG, with resvg compiled to WebAssembly and one embedded font.
 *
 * WebAssembly cannot reach system fonts, so the text face ships with the package:
 * Liberation Sans, which has Arial's metrics (Capture's default face), so labels
 * keep their width. The Bun-compiled binary embeds the WASM and the font as files;
 * under Node both are read from the installed package.
 */

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { initWasm, Resvg } from "@resvg/resvg-wasm";

const WASM = "@resvg/resvg-wasm/index_bg.wasm";
const FONT_URL = new URL("../../assets/fonts/LiberationSans-Regular.ttf", import.meta.url);

const readBytes = async (file: string | URL): Promise<Uint8Array> =>
  new Uint8Array(await readFile(file));

/** The WASM module and the font, loaded once. */
let ready: Promise<Uint8Array> | undefined;
const load = (): Promise<Uint8Array> =>
  (ready ??= (async () => {
    if (process.versions.bun) {
      // `with { type: "file" }` makes `bun build --compile` embed the file and return its path.
      const [{ default: wasm }, { default: font }] = await Promise.all([
        import("@resvg/resvg-wasm/index_bg.wasm", { with: { type: "file" } }),
        import("../../assets/fonts/LiberationSans-Regular.ttf", { with: { type: "file" } }),
      ]);
      await initWasm(await readBytes(wasm));
      return readBytes(font);
    }
    await initWasm(await readBytes(createRequire(import.meta.url).resolve(WASM)));
    return readBytes(FONT_URL);
  })());

/** Rasterize `svg` to a PNG `width` pixels wide. */
export async function rasterizeSvg(
  svg: string,
  width: number
): Promise<{ data: Uint8Array; width: number; height: number }> {
  const font = await load();
  const image = new Resvg(svg, {
    fitTo: { mode: "width", value: Math.round(width) },
    font: { fontBuffers: [font], loadSystemFonts: false, defaultFontFamily: "Liberation Sans" },
  }).render();
  return { data: image.asPng(), width: image.width, height: image.height };
}
