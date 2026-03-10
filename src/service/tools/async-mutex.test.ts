import { describe, expect, it } from "vitest";
import { createMutex } from "./async-mutex.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("createMutex", () => {
  it("serializes concurrent calls in FIFO order", async () => {
    const serialize = createMutex();
    const log: string[] = [];

    const task = (id: string, ms: number) =>
      serialize(async () => {
        log.push(`start-${id}`);
        await delay(ms);
        log.push(`end-${id}`);
      });

    await Promise.all([task("A", 30), task("B", 10), task("C", 10)]);

    expect(log).toEqual(["start-A", "end-A", "start-B", "end-B", "start-C", "end-C"]);
  });

  it("isolates errors — subsequent calls still execute", async () => {
    const serialize = createMutex();

    const failing = serialize(async () => {
      throw new Error("boom");
    });

    const passing = serialize(async () => "ok");

    await expect(failing).rejects.toThrow("boom");
    await expect(passing).resolves.toBe("ok");
  });

  it("returns distinct results to each caller", async () => {
    const serialize = createMutex();

    const results = await Promise.all([
      serialize(async () => {
        await delay(10);
        return 1;
      }),
      serialize(async () => {
        await delay(10);
        return 2;
      }),
      serialize(async () => {
        await delay(10);
        return 3;
      }),
    ]);

    expect(results).toEqual([1, 2, 3]);
  });
});
