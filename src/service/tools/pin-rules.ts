/**
 * Pin electrical-type ERC, as the golden tables in docs/decision-tables/pin-erc
 * define it: `net` judges the mix of pin types on one net, `pin` judges a supply
 * input by where it sits. `undefined` is a pin with no type, whose direction is
 * unknown.
 */
import type { PinType } from "../../types.js";

export interface NetCell {
  push_pull: "none" | "one" | "many";
  rail: "none" | "power" | "power_out" | "many_power_out";
  other: "none" | "open" | "bus" | "other";
  sinks: "none" | "some";
}

export type NetOutcome = "conflict error" | "contention warning" | "undriven error" | "clean";

/** Reduce a net's pin types (test points and DNS parts already left out) to its table cell. */
export const classifyNet = (types: readonly (PinType | undefined)[]): NetCell => {
  const count = (...of: (PinType | undefined)[]) => types.filter((t) => of.includes(t)).length;
  const outputs = count("output");
  const powerOuts = count("power_out");
  return {
    push_pull: outputs === 0 ? "none" : outputs === 1 ? "one" : "many",
    rail:
      powerOuts > 1
        ? "many_power_out"
        : powerOuts === 1
          ? "power_out"
          : count("power") > 0
            ? "power"
            : "none",
    other:
      count("open_collector", "open_emitter") > 0
        ? "open"
        : count("bidirectional", "tristate") > 0
          ? "bus"
          : count("passive", "unspecified", "free", undefined) > 0
            ? "other"
            : "none",
    sinks: count("input", "power_in") > 0 ? "some" : "none",
  };
};

export const netOutcome = ({ push_pull, rail, other, sinks }: NetCell): NetOutcome => {
  const driven = push_pull !== "none" || rail !== "none";
  if (push_pull === "many") return "conflict error";
  if (push_pull === "one" && other === "open") return "conflict error";
  if (push_pull === "one" && (rail === "power_out" || rail === "many_power_out")) {
    return "conflict error";
  }
  if (rail === "many_power_out") return "conflict error";
  if (rail === "power_out" && other === "open") return "conflict error";
  // An undirected power pin may be a supply input or output of either polarity,
  // so what it meets is only a possible fight.
  if (rail === "power" && (push_pull === "one" || other === "open")) return "contention warning";
  if (driven && other === "bus") return "contention warning";
  if (sinks === "some" && !driven && other === "none") return "undriven error";
  return "clean";
};

/** The pins a conflict or contention finding names: everything that drives, undirected power pins aside. */
export const DRIVING_TYPES: ReadonlySet<PinType | undefined> = new Set<PinType>([
  "output",
  "power_out",
  "open_collector",
  "open_emitter",
  "bidirectional",
  "tristate",
]);

export const SINK_TYPES: ReadonlySet<PinType | undefined> = new Set<PinType>(["input", "power_in"]);

export type PinPlacement = "nc" | "alone" | "shared";

/**
 * A supply input on the NC net, or alone on its net, leaves its part unpowered:
 * an error for `power_in`, a warning for an undirected `power` pin, which may
 * instead be an unused supply output.
 */
export const unconnectedSupply = (
  type: PinType | undefined,
  placement: PinPlacement
): "error" | "warning" | undefined =>
  placement === "shared"
    ? undefined
    : type === "power_in"
      ? "error"
      : type === "power"
        ? "warning"
        : undefined;
