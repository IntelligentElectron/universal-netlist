/**
 * After a self-update, `reexec` runs the new binary as a child and exits with
 * its code. Regression: it used to throw right after spawning, so the caller's
 * error handler killed the parent (exit 1, "Server error") while the child ran
 * on, and an MCP client lost its server on the first start after an update.
 */
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const child = new EventEmitter();
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: vi.fn(() => child),
}));

const { reexec } = await import("./updater.js");

afterEach(() => vi.restoreAllMocks());

describe("reexec", () => {
  it("waits for the new binary and exits with its code, without throwing", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    let settled = false;
    void reexec().then(
      () => (settled = true),
      () => (settled = true)
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    expect(exit).not.toHaveBeenCalled();

    child.emit("exit", 3);
    expect(exit).toHaveBeenCalledWith(3);
  });
});
