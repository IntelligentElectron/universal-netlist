# Xnet Depth Limit

## Context

The xnet traversal (`traverseCircuitFromNet`) uses BFS with no depth bound. It terminates only when it hits stop nets (power/ground), skip_types, DNS filtering, or exhaustion. On designs with broad power rails that don't match the stop-net regex (e.g., `CC1310_VDD`, `USB_VBUS`), the traversal can fan out excessively.

Instead of expanding the stop-net regex (fragile, false-positive-prone), add a `max_depth` parameter that caps the number of series-passive hops. This gives the calling agent deterministic control over traversal scope.

## Depth Semantics

Depth = number of series-passive component hops from the starting net.

- `max_depth=0`: No traversal. Return only components directly connected to the starting net.
- `max_depth=1`: Traverse through one series passive. Shows components on the starting net and the next net segment.
- `max_depth=5` (default): Up to 5 hops.

Ground nets (GND, AGND, DGND, etc.) are still rejected at the service layer regardless of depth. Power/ground stop-net behavior during traversal still applies within the depth limit.

## Response Metadata

Three fields, no redundancy:

- `max_depth: number` - the configured depth limit (input parameter, default 5)
- `max_depth_reached: number` - the deepest passive hop actually taken during traversal; always present, purely informational about circuit topology
- `frontier_nets?: Array<{ net: string; depth: number }>` - nets at the depth boundary that were not traversed further; only present when non-empty; this is the authoritative truncation signal

Note: `max_depth_reached === max_depth` does NOT imply truncation. The traversal may naturally end at exactly the limit (e.g., hit an active component or stop net on the last hop). Only a non-empty `frontier_nets` means the depth limit actually cut a branch short.

## Implementation

### File 1: `src/circuit-traversal.ts`

**`TraversalOptions`** (line 170): Add `maxDepth?: number` field.

**`TraversalResult`** (line 164): Add `max_depth_reached: number` and `frontier_nets: Array<{ net: string; depth: number }>`.

**`traverseCircuitFromNet`** (line 258):

1. Read `maxDepth` from options, default to `5`.
2. Change BFS queue from `string[]` to `Array<{ net: string; depth: number }>`. Seed with `{ net: startNet, depth: 0 }`.
3. Track `maxDepthReached = 0`, updated as each net is dequeued.
4. When processing a passive and enqueueing the other-side net, compute `nextDepth = currentDepth + 1`.
5. If `nextDepth > maxDepth`, do NOT enqueue. Instead, record `{ net, depth: nextDepth }` in a `frontierNets` collector.
6. At `maxDepth=0`: the starting net is processed (all components on it are collected), but no passives are followed through. Passives on the starting net appear in results as leaf components (their other-side pins/nets are visible but not traversed).
7. Return `max_depth_reached` and `frontier_nets` in the result.

### File 2: `src/types.ts`

**`AggregatedCircuitResult`** (line 144): Add:
- `max_depth: number`
- `max_depth_reached: number`
- `frontier_nets?: Array<{ net: string; depth: number }>` (omit when empty)

### File 3: `src/service/tools/query-xnet.ts`

**`queryXnetByNetName`** (line 25): Add `maxDepth: number` parameter. Pass to `traverseCircuitFromNet` via options. Forward `max_depth_reached`, `frontier_nets`, `max_depth` into the `AggregatedCircuitResult`.

**`queryXnetByPinName`** (line 83): Same changes.

### File 4: `src/server.ts`

**Both tool schemas** (`query_xnet_by_net_name` at lines 228-249 and `query_xnet_by_pin_name` at lines 254-272): Add input parameter:
```
max_depth: z.number().int().min(0).optional()
  .describe("Max series-passive hops to traverse (0 = direct connections only, default 5)")
```

Pass `max_depth` through to the service function calls.

Update the tool descriptions in `src/descriptions.ts`
(`QUERY_XNET_BY_NET_NAME_DESCRIPTION` line 103, `QUERY_XNET_BY_PIN_NAME_DESCRIPTION`
line 107) to mention depth limiting and the response metadata
(`max_depth_reached`, `frontier_nets`). (Descriptions were moved out of
`src/server.ts` into `src/descriptions.ts` in v0.1.0.)

### File 5: `src/circuit-traversal.test.ts`

Add tests within the `traverseCircuitFromNet` describe block:

**depth limit behavior:**
- `max_depth=0` returns only components on the starting net, no passive follow-through
- `max_depth=1` follows through one passive, stops at the next
- `max_depth=2` follows through two passives in a chain
- Default (no maxDepth) uses 5

**max_depth_reached:**
- Reports actual depth when traversal completes within the limit
- Reports max_depth when traversal is truncated
- Reports 0 when `max_depth=0`

**frontier_nets:**
- Populated with correct net names and depths when depth limit is hit
- Empty/absent when traversal completes naturally
- Multiple frontier nets when traversal fans out at the boundary
- Not populated when traversal stops due to stop nets at the boundary (stop net is not a frontier)

**interaction with other options:**
- Depth limit + skip_types: both apply independently
- Depth limit + stop nets: stop nets still stop within the depth limit
- Depth limit + DNS filtering: both apply

## Verification

```bash
npm run type-check && npm run lint && npm test
```

Manual MCP testing on a real design:
- `query_xnet_by_net_name` with `max_depth=0`: returns only direct connections
- `query_xnet_by_net_name` with `max_depth=1`: returns one hop
- `query_xnet_by_net_name` with default depth: behaves like current behavior but capped at 5
- Verify `frontier_nets` appears only when traversal is truncated
- Verify `max_depth_reached` reflects actual circuit depth in all cases
