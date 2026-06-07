# Plans Index

Living docs for upcoming or in-flight work, plus reference audits. Each
entry lists status against the codebase as of the last review.

> **Last reviewed: 2026-06-07.** File and line references in the Proposed
> plans were refreshed for the post-0.1.0 layout (the monolithic
> `src/service.ts` was split into `src/service/` per-tool modules, and tool
> descriptions moved to `src/descriptions.ts`).

| Plan | Topic | Status |
|---|---|---|
| [cloud-storage-readiness.md](./cloud-storage-readiness.md) | Decouple file I/O from parsers; add `Storage` interface + GCS adapter so `gs://` URIs work alongside local paths | Proposed |
| [run_erc.md](./run_erc.md) | New `run_erc` MCP tool for net-level electrical rule checks (single_pin, testpoint_only, unnamed, testpoint_stub) | Proposed |
| [xnet-depth-limit.md](./xnet-depth-limit.md) | Add `max_depth` parameter to `query_xnet_*` tools, plus `max_depth_reached` and `frontier_nets` response metadata | Proposed |
| [power-net-stop-pattern.md](./power-net-stop-pattern.md) | Switch `POWER_NET_PATTERN` / `STOP_NET_PATTERN` keywords (VCC/VDD/VBAT/VBUS/VSYS) from anchored prefix to substring matching so prefixed rails like `CC1310_VDD` stop traversal | Proposed |
| [relative_path.md](./relative_path.md) | Auto-discovery + ID-based design access: `list_designs` returns relative-path IDs that all other tools accept instead of absolute paths | Proposed |
| [altium-visual-data.md](./altium-visual-data.md) | Extract non-electrical visual/drawing data (lines, polylines, junctions, sheet metadata, etc.) from `.SchDoc` for future schematic rendering | Proposed |
| [dsn-parser-audit.md](./dsn-parser-audit.md) | Audit comparing our DSN TypeScript parser against the C++ `OpenOrCadParser` reference. Documents semantic extensions, gaps, and risks | Reference |

## Conventions

- One file per plan, named with kebab-case where practical.
- Each plan should open with a `## Context` section explaining *why* the
  change is needed before describing *what* to build.
- Plans stay in this folder until landed. After implementation, either
  delete the file (if the plan is fully captured by the code + commit
  history) or move to `docs/` if the writeup has long-term reference value
  (the DSN audit is an example of the latter).
