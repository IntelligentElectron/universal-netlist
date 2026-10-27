import { describe, expect, it, vi } from "vitest";

vi.mock("../service/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../service/index.js")>()),
  listNets: async () => {
    throw new Error("parser blew up");
  },
}));

const { callTool } = await import("./index.js");

describe("callTool", () => {
  it("reports an exception a tool throws as an error result instead of rejecting", async () => {
    await expect(callTool("list_nets", { design: "board.DSN" })).resolves.toEqual({
      error: "parser blew up",
    });
  });
});
