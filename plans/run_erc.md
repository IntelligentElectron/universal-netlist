Universal Netlist MCP Server: run_erc (v1) Plan

Goal
Add a new `run_erc` MCP tool that runs deterministic ERC checks on the universal netlist JSON and returns concise, LLM-friendly results.

Scope (v1)
- Net-level ERC only (no consistency/inverse checks between `nets` and `components`)
- Severity model: only `error` and `warning` (no `info`)
- Runtime output: high-level summary metadata + grouped findings
- Keep payload lean; avoid noisy/duplicated fields

v1 Rules (Final)
- `net.single_pin` -> `error`
- `net.testpoint_only` -> `error`
- `net.unnamed` -> `warning`
- `net.testpoint_stub` -> `warning`

Input Arguments (v1)
- `design` (required)
- `include_dns` (optional, default `false`)
- `include_rules` (optional)
- `exclude_rules` (optional)
- `max_findings` (optional, default `100`)
- `max_findings_per_rule` (optional, default `25`)

Output Principles (v1)
- Keep the high-level metadata simple and counter-based:
  - `design`
  - `summary.total_findings`
  - `summary.by_severity` (`error`, `warning`)
  - `summary.by_rule`
  - `summary.scanned` (`nets`, `components`, `pins`)
  - `summary.limits` (`max_findings`, `max_findings_per_rule`)
- No rule catalog.
- No `info` output.
- No cursor/paging in v1 unless we later prove truncation is a real problem.

Data Structures Workstream
- We still need to design most rule payload shapes.
- Only `net.single_pin` is finalized for now.
- Other rule payload schemas are intentionally TBD and will be finalized after first implementation/output review.

Zod Schema (Finalized for `net.single_pin`)
```ts
import { z } from "zod";

export const NetSinglePinFindingSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{10,12}$/i), // deterministic truncated hash
  net: z.string().min(1),
  endpoint: z.string().regex(/^[A-Za-z0-9_]+\.[A-Za-z0-9_]+$/), // REFDES.PIN
});

export const NetSinglePinGroupSchema = z.object({
  severity: z.literal("error"),
  findings: z.array(NetSinglePinFindingSchema),
});
```

Hash ID Strategy
- Deterministic hash-based IDs (not sequential IDs).
- Canonical input for this rule: `net.single_pin|<net>|<endpoint>`.
- Truncate hash to 10-12 hex chars (default to 12 unless changed later).

Implementation Steps
1. Server Wiring
   - Register `run_erc` in `src/server.ts` with v1 input schema.
2. Service Entrypoint
   - Add `runErc(...)` in `src/service.ts`.
3. ERC Engine Skeleton
   - Build shared scan context from parsed netlist.
   - Add rule runner framework (filtering via include/exclude lists).
4. Implement v1 Rules
   - Implement four net rules listed above.
5. Summary + Limits
   - Compute summary counters and enforce max limits.
6. Documentation
   - Add `docs/tools/run_erc.md`.
   - Update `docs/README.md` tool list.
   - Update `manifest.json` tools list.
7. Tests
   - Unit tests for each rule trigger.
   - Unit tests for deterministic hash IDs.
   - Unit tests for summary counters.
   - Unit tests for include/exclude filtering and limits.

Acceptance Criteria
- `run_erc` works on existing universal netlist designs.
- Output contains only `error`/`warning` severities.
- Rule counts and severity counts are correct.
- `net.single_pin` output matches finalized schema above.
- Result stays concise under configured caps.
