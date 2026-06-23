# Bounding XNET Output (depth limit + output-size cap)

## Context

The xnet traversal (`traverseCircuitFromNet`) uses BFS with no bound on the
result. It terminates only when it hits stop nets (power/ground), `skip_types`,
DNS filtering, or exhaustion. That leaves the output unbounded along **two
independent axes**, and either can overflow the MCP's max output token limit:

- **Depth (hops outward through series passives).** On designs with broad power
  rails that don't match the stop-net regex (e.g. `CC1310_VDD`, `USB_VBUS`), the
  traversal fans out hop after hop.
- **Breadth (components on a single net).** A net with hundreds of *directly*
  connected pins floods the result at depth 0–1. The June 2026 stress test hit
  this: `query_xnet_by_net_name` on `VCC` (369 components, ~95 KB) and on
  unrecognized ground rails (e.g. `GNDREF`, 238 components, ~90 KB) both exceeded
  the token limit and errored out.

> The *ground-name guard gap* that let `GNDREF`/`/GND` reach traversal at all was
> fixed separately (v1.1.1: `GND\w*` + sheet-path stripping in
> `src/circuit-traversal.ts`). That stops the **ground** floods, but a
> legitimately huge **non-ground** net (a real power rail, a wide bus) still
> overflows. So output bounding is still needed independent of net
> classification.

Two complementary mechanisms are proposed below. They address different axes and
should both land; this doc records both so the trade-off is explicit.

---

## Approach A — `max_depth` parameter (agent-controlled scope)

Add a `max_depth` parameter that caps the number of series-passive hops. This
gives the calling agent deterministic control over traversal scope, without
expanding the stop-net regex (fragile, false-positive-prone).

### Depth semantics

Depth = number of series-passive component hops from the starting net.

- `max_depth=0`: No traversal. Return only components directly connected to the
  starting net.
- `max_depth=1`: Traverse through one series passive. Shows components on the
  starting net and the next net segment.
- `max_depth=5` (default): Up to 5 hops.

Ground nets (GND, AGND, DGND, etc.) are still rejected at the service layer
regardless of depth. Power/ground stop-net behavior during traversal still
applies within the depth limit.

### Response metadata

Three fields, no redundancy:

- `max_depth: number` — the configured depth limit (input parameter, default 5)
- `max_depth_reached: number` — the deepest passive hop actually taken during
  traversal; always present, purely informational about circuit topology
- `frontier_nets?: Array<{ net: string; depth: number }>` — nets at the depth
  boundary that were not traversed further; only present when non-empty; this is
  the authoritative truncation signal

Note: `max_depth_reached === max_depth` does NOT imply truncation. The traversal
may naturally end at exactly the limit (e.g. hit an active component or stop net
on the last hop). Only a non-empty `frontier_nets` means the depth limit actually
cut a branch short.

### Implementation

**File 1: `src/circuit-traversal.ts`**

- **`TraversalOptions`**: add `maxDepth?: number`.
- **`TraversalResult`**: add `max_depth_reached: number` and
  `frontier_nets: Array<{ net: string; depth: number }>`.
- **`traverseCircuitFromNet`**:
  1. Read `maxDepth` from options, default `5`.
  2. Change the BFS queue from `string[]` to
     `Array<{ net: string; depth: number }>`; seed with `{ net: startNet, depth: 0 }`.
  3. Track `maxDepthReached`, updated as each net is dequeued.
  4. When enqueueing an other-side net through a passive, `nextDepth = currentDepth + 1`.
  5. If `nextDepth > maxDepth`, do NOT enqueue; record `{ net, depth: nextDepth }`
     in a `frontierNets` collector.
  6. At `maxDepth=0`: the starting net is processed (its components collected) but
     no passives are followed; passives on the starting net appear as leaf
     components.
  7. Return `max_depth_reached` and `frontier_nets`.

**File 2: `src/types.ts`** — `AggregatedCircuitResult`: add `max_depth`,
`max_depth_reached`, and `frontier_nets?` (omit when empty).

**File 3: `src/service/tools/query-xnet.ts`** — `queryXnetByNetName` and
`queryXnetByPinName`: add a `maxDepth` parameter, pass via options, forward the
new fields into the result.

**File 4: `src/server.ts`** — both tool schemas: add
`max_depth: z.number().int().min(0).optional().describe("Max series-passive hops to traverse (0 = direct connections only, default 5)")`,
and pass through. Update the descriptions in `src/descriptions.ts`
(`QUERY_XNET_BY_NET_NAME_DESCRIPTION`, `QUERY_XNET_BY_PIN_NAME_DESCRIPTION`) to
mention depth limiting and the response metadata.

**File 5: `src/circuit-traversal.test.ts`** — add to the `traverseCircuitFromNet`
block: depth-limit behavior (0/1/2/default), `max_depth_reached` (within limit,
truncated, and 0), `frontier_nets` (populated on truncation, absent on natural
completion, multiple on fan-out, not populated when a stop net sits at the
boundary), and interactions with `skip_types` / stop nets / DNS filtering.

---

## Approach B — automatic output-size cap (hard safety net)

Guarantee that *no* xnet call can exceed the output token limit, regardless of
classification correctness, depth, or net size. Where Approach A bounds *hops*,
this bounds the *serialized result*, catching the breadth case (a single net with
hundreds of directly-connected components) that depth limiting cannot.

Today the harness backstops an oversized result by spilling it to a file and
returning an **error** — a poor experience for a calling agent. Approach B makes
the tool itself return a coherent, bounded, actionable result instead.

### Design — byte-budget-driven graceful degradation

Applied in `src/service/tools/query-xnet.ts` to both xnet tools just before
returning:

1. **Run the full traversal** as usual — the counts (`total_components`,
   `unique_configurations`, `visited_nets`) are cheap and stay accurate.
2. **Measure** `JSON.stringify(result)` against a budget set safely under the MCP
   max output (a constant, env-overridable like `KICAD_CLI_PATH` / `OTEL_*`,
   e.g. `UNIVERSAL_NETLIST_XNET_MAX_BYTES`).
3. **If over budget, degrade in tiers** — keep the cheap high-value fields, shed
   the bulky per-pin detail:
   - *Tier 1:* keep `starting_point`, `total_components`, `unique_configurations`,
     `visited_nets`, `circuit_hash`; replace the detailed `components_by_mpn`
     (which carries per-pin `connections`) with a **count-only grouping**
     (mpn/value/count/refdes, no `connections`) if that fits.
   - *Tier 2:* if still too big, drop to summary only (counts + `visited_nets`).
   - Always set `truncated: true` and a `note` with remediation: *"XNET has N
     components — likely a power/ground rail; narrow with `skip_types`, lower
     `max_depth`, or query a more specific net/pin."*
4. **Small nets are untouched** — byte-identical output to today.

### Why a byte budget (not a component count)

The real constraint is output size, and a few components with huge pin lists can
be as large as many small ones. A component-count cap is a fine coarse pre-check,
but measuring serialized length is what actually closes the bug.

### Implementation

**File 1: `src/service/tools/query-xnet.ts`** — add a `capResult(result)` helper
implementing the tiered degradation; call it at the end of both
`queryXnetByNetName` and `queryXnetByPinName`.

**File 2: `src/types.ts`** — `AggregatedCircuitResult`: add `truncated?: boolean`
and `note?: string` (omit when not truncated). Confirm the `connections` field of
the grouped-component type is optional so the count-only form type-checks.

**File 3: config** — define `XNET_MAX_BYTES` (default safely under the MCP limit)
with an env override; co-locate with existing config constants.

**File 4: `src/descriptions.ts`** — note in both xnet tool descriptions that
oversized results are truncated with a `truncated` flag + `note`.

**File 5: `src/service/tools/query-xnet.test.ts`** — mock `parseDesign` with a
synthetic net carrying N directly-connected components: assert (i) the serialized
result stays under budget, (ii) `truncated: true` and the `note` are present,
(iii) counts remain accurate; plus a small-net case asserting no truncation and
unchanged output shape.

---

## Evaluation

| | A — `max_depth` | B — output-size cap |
|---|---|---|
| Bounds | Traversal **depth** (passive hops) | Serialized **output size** (bytes) |
| Control | Agent-driven, opt-in parameter | Automatic, always on |
| Guarantees output < limit? | **No** — a wide net at depth 0–1 still overflows | **Yes** — by construction |
| Helps with | Deep fan-out through series chains; scoping a query | Broad rails / buses; any oversized result |
| Cost to caller | Must choose/iterate `max_depth` | None (transparent; flagged when it fires) |
| Risk | Default may truncate legitimate deep traces (mitigated by `frontier_nets`) | Loses per-pin detail on giant nets (counts + remediation retained) |

**Recommendation: implement both.** They are orthogonal. B is the correctness
guarantee — it is the only thing that makes an xnet call *unconditionally* safe
against the token limit, and it requires no agent cooperation. A is scope control
that produces smaller, more relevant results and gives the agent a knob
(`max_depth`) plus topology signal (`frontier_nets`). Neither subsumes the other:
A alone leaves the breadth case (the 369-component `VCC` rail) overflowing; B
alone always returns *something* but can't express "I only want 1 hop."

Suggested order: **B first** (closes the open stress-test bug class and removes
the harness file-spill error path), then **A** (scope ergonomics). If shipped
together, fold into one minor release.

---

## Verification

```bash
npm run type-check && npm run lint && npm test
```

Manual MCP testing on a real design:

- **A:** `query_xnet_by_net_name` with `max_depth=0` returns only direct
  connections; `max_depth=1` returns one hop; default behaves as today, capped at
  5; `frontier_nets` appears only when a branch is cut short; `max_depth_reached`
  reflects actual circuit depth.
- **B:** query a broad rail (e.g. a `VCC`/`VDD` net with hundreds of components)
  and confirm the tool returns a bounded result with `truncated: true` + `note`
  instead of triggering the harness oversized-output file spill; confirm a small
  net is returned in full, unchanged.
