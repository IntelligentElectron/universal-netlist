/**
 * render_page on the command line: the MCP tool's arguments plus --output,
 * writing the PNG to a file instead of returning it inline.
 */

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { RENDER_PAGE_DESCRIPTION } from "../descriptions.js";
import { renderPage } from "../service/tools/render-page.js";
import { defineTool, READ_ONLY, RENDER_PAGE_ARGUMENTS } from "../tools/index.js";
import { resolvePath } from "../paths.js";

/** A file name from a page name: the characters a file system takes, with `_` for the rest. */
const fileNameOf = (page: string): string =>
  `${
    page
      .trim()
      .replace(/[^\w.-]+/g, "_")
      .replace(/^_+|_+$/g, "") || "page"
  }.png`;

export const renderPageCliTool = defineTool({
  name: "render_page",
  title: "Render page",
  description: `${RENDER_PAGE_DESCRIPTION} On the command line the PNG is written to --output.`,
  annotations: READ_ONLY,
  inputSchema: z.strictObject({
    ...RENDER_PAGE_ARGUMENTS,
    output: z
      .string()
      .optional()
      .describe("PNG path to write. Default: <page>.png in the working directory"),
  }),
  run: async ({ design, page, focus, output }, context) => {
    const result = await renderPage(design, page, focus, context);
    if ("error" in result) return result;
    const { image, ...rest } = result;
    const file = path.resolve(output ? resolvePath(output, context.root) : fileNameOf(result.page));
    await writeFile(file, Buffer.from(image.data, "base64"));
    return { ...rest, output: file };
  },
});
