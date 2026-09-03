# Plan: Decouple file I/O from parsers (cloud-storage readiness)

> Scope update: DAT parsing and `export_cadence_netlist` are dormant in MCP.
> This proposal must preserve that boundary. DAT helpers may remain local for
> CLI coverage and regression tests; they are not a cloud MCP input format.

## Context

Today every parser entry point eventually pulls bytes off the local disk via
`fs`/`fs/promises`. The user wants to deploy a Cloud Run / AWS variant of
`universal-netlist` that reads `.DSN` (Cadence) and `.SchDoc` /
`.PrjPcb` (Altium) files directly from cloud storage buckets (GCS/S3) without
forking the parsers. The actual binary/text parsing is already pure (operates
on `Buffer`/`string`), so the question is: are the I/O seams thin enough to
swap?

**Answer: yes, with one focused refactor.** This plan introduces a `Storage`
interface, ships only the local implementation, and routes every existing
file-system call through it. Cloud later becomes a single new file
(`GcsStorage` / `S3Storage`) and one line in a URI router. No parser logic
needs to change again.

Proposed scope, updated for the dormant MCP features:

- **Abstraction + GCS adapter + end-to-end test against a real bucket.**
  S3 adapter is deferred (user has GCP, not AWS).
- Cadence `.DSN` schematics and Altium `.SchDoc`/`.PrjPcb` designs must work
  in cloud. DAT input remains disabled for MCP. The retained `pstswp.exe`
  exporter is only available to local CLI coverage and stays out of scope.
- Cloud paths are addressed via URI scheme on existing path arguments
  (`gs://bucket/key`, `s3://bucket/key`). MCP tool signatures do not change.
- The MCP binary still runs locally on the agent's machine. It just makes
  outbound HTTPS to GCS when given a `gs://` URI. Cloud Run deployment is
  a separate future concern (same code, different host).
- E2E test uses your real GCP project, gated by an env var so CI without
  creds skips it. No service-account JSON files committed.

## Current I/O surface (verified by exploration)

Three categories of disk access exist today:

1. **Whole-file reads** — load a complete file into a `Buffer`/`string`,
   then parse purely.
   - `src/parsers/ole-reader/ole-reader.ts:50-58` — `OleReader` ctor calls
     `readFileSync(filePath)`. Used by both DSN and Altium pipelines.
   - `src/parsers/ole-reader/ole-reader.ts:452-455` — `readOleStream(filePath)`
     thin wrapper around `OleReader`.
   - `src/parsers/cadence/dat/pstxnet-parser.ts:13`,
     `pstxprt-parser.ts:32`, `pstchip-parser.ts:22` — each reads the file
     then delegates to a pure `parse*Content(string)` function. These retained
     DAT helpers are outside the proposed MCP storage work.
   - `src/parsers/altium/discovery.ts:52` — reads `.PrjPcb` config text.
   - `src/parsers/altium/discovery.ts:29-31` — `open()` + 8-byte read for
     OLE magic check (cheap to convert to a full read since these files
     are small and we always end up loading them anyway).
   - `src/parsers/cadence/discovery.ts:280` — reads `pstxprt.dat` to
     extract `ROOT_DRAWING` for retained DAT discovery only, outside MCP.

2. **Directory listings (recursive)** — for design discovery.
   - `src/parsers/cadence/discovery.ts:69` (`walkForCadenceFiles`).
   - `src/parsers/altium/discovery.ts:108` (recursive walker).

3. **Local-only side-effects** — out of scope for cloud.
   - `src/service/tools/cadence-export.ts` — shells out to `pstswp.exe`,
     creates output dirs and renames lock files for Windows CLI coverage.
     It remains unregistered in MCP on every platform.

No parser performs random-access seeks against a file handle. `BinaryReader`
seeks are in-memory `Buffer` offsets, so cloud blobs (one fetch → one Buffer)
work without changes.

## Design

### 1. New `Storage` abstraction

Create `src/storage/`:

- **`types.ts`** — interface and shared types:

  ```ts
  export interface DirEntry {
    name: string;            // basename
    path: string;            // full storage-native path/URI
    isDirectory: boolean;
    isFile: boolean;
  }

  export interface ListOptions {
    maxDepth?: number;       // matches DiscoverDesignsOptions semantics
  }

  export interface Storage {
    readFile(path: string): Promise<Buffer>;
    readTextFile(path: string, encoding?: BufferEncoding): Promise<string>;
    listDirectory(path: string, options?: ListOptions): Promise<DirEntry[]>;
    exists(path: string): Promise<boolean>;
  }
  ```

  `listDirectory` returns the full recursive tree (with depth control)
  rather than one level. The current Cadence/Altium walkers already do
  recursive traversal; centralizing recursion in `Storage` lets cloud
  implementations use bucket prefix listing efficiently (one paginated
  listObjects call vs. N recursive readdirs).

- **`local.ts`** — `LocalStorage` implements the interface using
  `fs/promises`. Behaviour must match today's discovery semantics exactly
  (EACCES is swallowed, separator normalization preserved).

- **`index.ts`** — URI router:

  ```ts
  export const getStorage = (pathOrUri: string): Storage => {
    if (pathOrUri.startsWith("gs://")) return gcsStorage;
    if (pathOrUri.startsWith("s3://"))
      throw new Error("S3 storage backend not registered");
    return localStorage;
  };
  ```

- **`local.test.ts`** — verify recursive walk, EACCES handling,
  read/exists semantics against a tmp dir of fixtures.

### 2. Refactor the I/O seams

Each refactor is mechanical and additive — keep existing public signatures
intact, add overloads/factories that take a `Storage`.

**`src/parsers/ole-reader/ole-reader.ts`**

- Change the constructor to take a `Buffer` directly (the existing pure
  build steps already operate on `this.buffer`). Make it `private`.
- Add static factories:

  ```ts
  static fromBuffer(buffer: Buffer): OleReader;
  static async from(path: string, storage?: Storage): Promise<OleReader>;
  ```

  `from` calls `(storage ?? getStorage(path)).readFile(path)` then
  `OleReader.fromBuffer(buf)`.
- Update `readOleStream` to async:

  ```ts
  export const readOleStream = async (
    filePath: string,
    streamName = "FileHeader",
    storage?: Storage,
  ): Promise<Buffer>;
  ```

  Drop `readFileSync` import. All call sites are already in `async`
  contexts.

**`src/parsers/cadence/dsn/dsn-parser.ts:19-20`**

Replace `new OleReader(dsnPath)` with `await OleReader.from(dsnPath)`.

**`src/parsers/altium/index.ts`** (line ~414, `parse(schdocPath)`)

Replace `readOleStream(schdocPath)` callsite with the async version.
Already in an `async` function.

**`src/parsers/cadence/dat/pstxnet-parser.ts`, `pstxprt-parser.ts`,
`pstchip-parser.ts`**

No changes required: these parsers remain local helpers for CLI coverage and
regression fixtures. Do not route them into the cloud MCP handler.

**`src/parsers/cadence/discovery.ts`**

- Use `storage.listDirectory(rootDir, { maxDepth })` for active DSN discovery.
- Preserve the existing local DAT matching and `extractRootDrawing` helpers
  for `discoverCadenceDesignsWithDat` and `findCadenceDatFiles`, used by CLI
  coverage and golden generation.
- Keep `.cpm` and standalone DAT designs out of MCP discovery.

**`src/parsers/altium/discovery.ts`**

- Replace `readdir` recursion with `storage.listDirectory(...)` (single
  source of truth for separator/EACCES handling).
- Replace `open()` + 8-byte magic read with `storage.readFile(path)`
  followed by an in-memory magic comparison. These files are small, and
  we already read them in full immediately afterwards — no perf
  regression.
- Replace project config `readFile` with `storage.readTextFile`.

**`src/service/load-netlist.ts`**

`resolvePath` currently calls `path.resolve(...)`. Update so URI strings
are passed through unchanged (`gs://...`, `s3://...`); only normalize when
the string is a local path. The existing local-resolution behaviour must
stay identical.

**Out of scope (do not touch)**

- `src/service/tools/cadence-export.ts` — Windows shell-out, never cloud.
- `src/types.ts` — `EDAProjectFormatHandler.parse(designPath: string)`
  signature is unchanged. Cloud URIs are valid string paths.
- All `parse*Content` pure functions, `BinaryReader`, `OleReader`'s
  internal parsing methods, MCP tool wiring.

### 3. Testability

- `LocalStorage` has its own unit tests (`src/storage/local.test.ts`).
- Existing parser/discovery tests continue running unchanged because
  `getStorage(localPath)` returns `LocalStorage`. No fixture path changes.
- Optional: a small `MemoryStorage` test helper (in
  `src/storage/memory.ts`) backed by a `Map<string, Buffer>` makes future
  cloud-adapter tests trivial. Add only if existing tests benefit; not
  required for this PR.

### 4. GCS adapter (in this PR)

New file: `src/storage/gcs.ts`. New runtime dep: `@google-cloud/storage`.
Registered in `getStorage`:

```ts
if (pathOrUri.startsWith("gs://")) return gcsStorage;
```

Implementation surface for `GcsStorage` (lazy-init the SDK client so users
who never use cloud don't pay the import cost):

```ts
import type { Storage as GcsClient } from "@google-cloud/storage";

let cachedClient: GcsClient | null = null;
const getClient = async (): Promise<GcsClient> => {
  if (!cachedClient) {
    const { Storage } = await import("@google-cloud/storage");
    cachedClient = new Storage();   // ADC: no args needed
  }
  return cachedClient;
};

const parseUri = (uri: string): { bucket: string; key: string } => {
  const m = uri.match(/^gs:\/\/([^/]+)\/?(.*)$/);
  if (!m) throw new Error(`Invalid GCS URI: ${uri}`);
  return { bucket: m[1], key: m[2] };
};

export const gcsStorage: Storage = {
  async readFile(uri) {
    const { bucket, key } = parseUri(uri);
    const [buf] = await (await getClient()).bucket(bucket).file(key).download();
    return buf;
  },
  async readTextFile(uri, encoding = "utf-8") {
    return (await this.readFile(uri)).toString(encoding);
  },
  async exists(uri) {
    const { bucket, key } = parseUri(uri);
    const [ok] = await (await getClient()).bucket(bucket).file(key).exists();
    return ok;
  },
  async listDirectory(uri, options) {
    const { bucket, key } = parseUri(uri);
    const prefix = key === "" ? "" : key.endsWith("/") ? key : key + "/";
    const [files] = await (await getClient()).bucket(bucket).getFiles({
      prefix,
      autoPaginate: true,
    });
    return files
      .map((f) => buildDirEntry(`gs://${bucket}/${f.name}`, prefix))
      .filter((e) => withinMaxDepth(e, prefix, options?.maxDepth));
  },
};
```

Key implementation notes:

- **Authentication is implicit.** No code touches credentials. ADC chain:
  `GOOGLE_APPLICATION_CREDENTIALS` env → `gcloud auth application-default
  login` creds → metadata server. Same code works on a laptop (user creds)
  and on Cloud Run (service-account creds).
- **No directories in object stores.** GCS lists flat keys; "depth" is
  derived from `/` count in the suffix after the prefix. The Cadence/Altium
  walkers use `listDirectory` for full recursive listings anyway, so this
  shape is a natural fit.
- **No `isDirectory: true` entries from GCS.** The walkers must not rely on
  directory entries — only file entries matter. Verify Cadence and Altium
  discovery code paths after the LocalStorage refactor by checking that
  they only consume `entry.isFile` items.
- **Path joining stays string-based** in discovery code. We never call
  `path.join` on URIs — instead, the walkers receive absolute paths/URIs
  back from `Storage.listDirectory` and use them as-is. The existing
  `normalizeSeparators` logic only applies when `getStorage` returns
  `LocalStorage`.

S3 (deferred): when needed, `src/storage/s3.ts` follows the exact same
pattern with `@aws-sdk/client-s3` (`GetObjectCommand`, `ListObjectsV2Command`).
Cost ~80 LOC. No parser changes.

## Critical files to modify

New:

- `src/storage/types.ts`
- `src/storage/local.ts`
- `src/storage/gcs.ts`
- `src/storage/index.ts`
- `src/storage/local.test.ts`
- `src/storage/gcs.e2e.test.ts`           (gated by env var, see verification)

Modified:

- `src/parsers/ole-reader/ole-reader.ts`
- `src/parsers/cadence/dsn/dsn-parser.ts`
- `src/parsers/altium/index.ts`
- `src/parsers/cadence/discovery.ts`
- `src/parsers/altium/discovery.ts`
- `src/service/load-netlist.ts` (only `resolvePath` URI passthrough)
- `src/paths.ts` (if `resolvePath` lives there — confirm during edit)

## Verification

End-to-end checks before considering done.

### Local (no creds needed)

1. `npm run type-check && npm run lint && npm test` — full suite green.
   Existing parser/discovery tests pass unchanged because `LocalStorage`
   is the default and matches today's behaviour.
2. `npm run dev` and exercise via MCP tools against existing fixtures:
   - `mcp__universal-netlist__list_designs` against the test fixtures
     directory must return identical results to `main`.
   - `mcp__universal-netlist__query_xnet_by_net_name` on a DSN fixture
     must produce byte-identical JSON to `main`.
   - DAT and `.cpm` inputs must remain rejected by MCP.
   - `mcp__universal-netlist__query_xnet_by_pin_name` on an Altium
     `.SchDoc` fixture must produce byte-identical JSON to `main`.
3. Confirm no remaining `import ... from "fs"` / `"fs/promises"` exists
   in active cloud parser paths. Retained local DAT and CLI export helpers
   continue to use local filesystem APIs.

### GCS end-to-end (real bucket)

This is the proof that the abstraction holds and IAM auth works.

**One-time setup (user runs):**

```bash
gcloud auth application-default login
gcloud config set project <your-project>
gsutil mb gs://val-netlist-e2e/
gsutil -m cp -r tests/fixtures/cadence-cis-sample \
  gs://val-netlist-e2e/cadence-cis-sample/
gsutil -m cp -r tests/fixtures/altium-sample \
  gs://val-netlist-e2e/altium-sample/
export NETLIST_GCS_E2E_BUCKET=val-netlist-e2e
```

**E2E test file: `src/storage/gcs.e2e.test.ts`**

Skips automatically if `NETLIST_GCS_E2E_BUCKET` is unset. For each of the
two format families (cadence-cis, altium) it runs the same query
twice — once against the local fixture path, once against the
`gs://${bucket}/...` URI — and `expect(localResult).toEqual(gcsResult)`.

```ts
const bucket = process.env.NETLIST_GCS_E2E_BUCKET;
const skip = !bucket ? describe.skip : describe;

skip("gcs e2e parity", () => {
  it("list_designs: local and gs:// match", async () => {
    const local = await discoverDesigns("tests/fixtures/cadence-cis-sample");
    const cloud = await discoverDesigns(`gs://${bucket}/cadence-cis-sample`);
    expect(stripPaths(cloud)).toEqual(stripPaths(local));
  });

  it("query_xnet_by_net_name: DSN local vs gs:// match", async () => { /* ... */ });
  it("DAT inputs remain rejected by MCP", async () => { /* ... */ });
  it("query_xnet_by_pin_name: Altium local vs gs:// match", async () => { /* ... */ });
});
```

`stripPaths` normalizes the `path` field across the two backends (one is a
filesystem path, the other a `gs://` URI) so deep-equal can succeed on
everything else. Every other field — names, formats, nets, pins,
components — must match exactly.

**Manual smoke from an agent:**

After the test passes, do one live MCP-tool call to confirm:

```jsonc
{ "tool": "mcp__universal-netlist__query_xnet_by_net_name",
  "arguments": {
    "design": "gs://val-netlist-e2e/cadence-cis-sample/<top>.dsn",
    "net": "<known-net>" } }
```

Output should match the local equivalent byte-for-byte.

**IAM negative test (manual, ~2 min):**

```bash
gcloud storage buckets remove-iam-policy-binding gs://val-netlist-e2e \
  --member="user:$(gcloud config get-value account)" \
  --role="roles/storage.objectViewer"
# Re-run the e2e test → must surface a clean "permission denied" error,
# not a crash. Restore the binding afterwards.
```

This proves the SDK's auth chain is what enforces access, and that errors
propagate cleanly through our abstraction.

## Practical examples: same agent, three backends

The point of the abstraction is that **the MCP tool call is identical
across backends — only the path string changes**.

### Example 1: discovering designs

**Local laptop** — exactly today's behaviour:

```jsonc
{
  "tool": "mcp__universal-netlist__list_designs",
  "arguments": { "path": "/Users/val/projects/board-rev-c" }
}
```

Internal dispatch:

```ts
getStorage("/Users/val/projects/board-rev-c") // → LocalStorage
// LocalStorage.listDirectory recursively walks via fs/promises.readdir
// LocalStorage.readFile pulls bytes via fs/promises.readFile
```

**Cloud Run + GCS** — supply a `gs://` URI:

```jsonc
{
  "tool": "mcp__universal-netlist__list_designs",
  "arguments": { "path": "gs://acme-eda-uploads/board-rev-c" }
}
```

Internal dispatch:

```ts
getStorage("gs://acme-eda-uploads/board-rev-c") // → GcsStorage
// bucket("acme-eda-uploads")
//   .getFiles({ prefix: "board-rev-c/", autoPaginate: true })
// → flatten to DirEntry[], filter by maxDepth, return.
//
// bucket("acme-eda-uploads").file("board-rev-c/top.dsn").download()
// → returns Buffer, identical shape to fs/promises.readFile
```

**Lambda / Fargate + S3** — same tool, `s3://` URI (future):

```jsonc
{
  "tool": "mcp__universal-netlist__list_designs",
  "arguments": { "path": "s3://acme-eda-uploads/board-rev-c" }
}
```

```ts
getStorage("s3://acme-eda-uploads/board-rev-c") // → S3Storage
// ListObjectsV2Command({ Bucket: "acme-eda-uploads",
//                        Prefix: "board-rev-c/" })
// → paginate, build DirEntry[] from Contents[].
//
// GetObjectCommand({ Bucket, Key: "board-rev-c/top.dsn" })
// → stream to Buffer.
```

The agent sees identical JSON in all three cases:

```jsonc
{
  "designs": [
    { "name": "top",
      "path": "<the original URI>/top.dsn" }
  ]
}
```

### Example 2: querying a net (the full read pipeline)

```
agent → MCP tool: query_xnet_by_net_name({ design: "<path>/top.dsn",
                                            net: "PCIE_RX0_P" })
                              │
                              ▼
                  loadNetlist(designPath)
                              │
                              ▼
              cadenceHandler.parse(designPath)
                              │
                              ▼
             OleReader.from(designPath, getStorage(designPath))
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
  LocalStorage           GcsStorage             S3Storage
  fs.readFile(path)      bucket.file(key)       GetObjectCommand
                         .download()
        │                     │                     │
        └─────────────────────┴─────────────────────┘
                              │
                              ▼
                       Buffer (whole file)
                              │
                              ▼
              OleReader.fromBuffer(buf)   ← pure, identical
                              │
                              ▼
               parsePage / parseCache / ...   ← pure, identical
                              │
                              ▼
                  ParsedNetlist → JSON to agent
```

Every box below "Buffer" is the **same code path** for all three backends.
That is the whole guarantee of this refactor.

### Example 3: mixed local + cloud in the same session

Because dispatch is per-call and based on the path string, an agent can
mix backends within a single conversation:

```jsonc
// Compare a local in-progress design to the canonical version in GCS
{ "tool": "mcp__universal-netlist__query_xnet_by_net_name",
  "arguments": { "design": "/Users/val/wip/top.dsn",  "net": "DDR4_CK_P" } }

{ "tool": "mcp__universal-netlist__query_xnet_by_net_name",
  "arguments": { "design": "gs://acme-eda-archive/board-rev-b/top.dsn",
                 "net": "DDR4_CK_P" } }
```

No server restart, no config flag. Each call routes through `getStorage`
independently.

### Authentication

- **GCS**: `@google-cloud/storage` picks up Application Default Credentials
  from the Cloud Run service account, or `gcloud auth application-default
  login` creds locally, or `GOOGLE_APPLICATION_CREDENTIALS` for service
  account JSON. `GcsStorage` constructor takes no creds — the SDK handles it.
- **S3** (future): `@aws-sdk/client-s3` picks up the IAM role on
  Lambda/ECS/EC2, or `AWS_*` env vars locally. Same story.
- **LocalStorage**: no auth, just filesystem permissions.

The `Storage` interface stays auth-agnostic. Each implementation owns its
own credential plumbing.

## Out of scope / explicit non-goals

- **S3 adapter** — deferred. User has GCP, not AWS. Skeleton documented
  above (~80 LOC follow-up PR).
- **Cloud Run deployment artefacts** — Dockerfile, service.yaml, IaC.
  This PR makes Cloud Run *possible*; actually deploying is a separate
  task.
- Changing MCP tool argument shapes — `designPath` stays a string.
- Refactoring `cadence-export.ts` for cloud — it remains a Windows CLI
  coverage helper, dormant in MCP. Cloud queries use `.DSN` / `.SchDoc`
  directly. DAT parsing remains outside the MCP surface.
- Streaming reads. Every parser already loads whole files; GCS
  `download()` returns a Buffer just fine. Streaming can be added later
  if a parser ever needs it.
- GCS e2e tests in CI — gated by env var, run on user's laptop only.
