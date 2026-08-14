/**
 * The build channel defaults to the self-updating GitHub release build, so a
 * build that passes no `--define BUILD_CHANNEL` (running from source, or any
 * existing release) behaves exactly as it did before the flag existed.
 */

import { describe, it, expect } from "vitest";
import { CHANNEL, SELF_UPDATE_ENABLED } from "./build-flags.js";

describe("build flags", () => {
  it("defaults to the github channel when BUILD_CHANNEL is not injected", () => {
    expect(CHANNEL).toBe("github");
  });

  it("enables self-update on the github channel", () => {
    expect(SELF_UPDATE_ENABLED).toBe(true);
  });
});
