import path from "node:path";
import { findHandler } from "../../parsers/index.js";
import { DEFAULT_VARIANT } from "../../parsers/variants.js";
import { resolvePath } from "../../paths.js";
import type { ErrorResult, ListVariantsResult } from "../../types.js";

/** List the base design and every named assembly variant a design records. */
export const listVariants = async (
  design: string
): Promise<ListVariantsResult | ErrorResult> => {
  const normalizedPath = resolvePath(design);
  const handler = findHandler(normalizedPath);
  if (!handler) {
    const ext = path.extname(normalizedPath);
    return { error: `Unsupported design file format '${ext}'. Use list_designs() first.` };
  }

  try {
    const variants = (await handler.listVariants?.(normalizedPath)) ?? [];
    return {
      variants: [
        {
          name: DEFAULT_VARIANT,
          description: "Unmodified/core design",
          is_default: true,
        },
        ...variants,
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error occurred";
    return { error: message };
  }
};
