# Library

The package is also a library. A host that has its own tool system (an app server, a serverless function, an agent framework) imports the tools and calls them in-process, with no MCP server to start and no stdio framing.

## Netlist service

`createNetlistService` from `@intelligentelectron/universal-netlist/service` returns every tool as a method. Each method takes one object whose fields are the tool's own argument names, applies the tool's defaults, and resolves to the tool's result. A failure resolves to an `{ error }` result; the promise does not reject.

```ts
import { createNetlistService } from "@intelligentelectron/universal-netlist/service";

const netlist = createNetlistService({ root: "/srv/designs" });

const designs = await netlist.listDesigns({ path: "." });
const power = await netlist.searchNets({ design: "board/board.DSN", pattern: "^VCC" });
const xnet = await netlist.queryXnetByNetName({
  design: "board/board.DSN",
  net_name: "SPI_CLK",
  skip_types: ["C", "L"],
});
if ("error" in xnet) throw new Error(xnet.error);

// Or dispatch by the tool's snake_case name, as an MCP client does.
const same = await netlist.call("query_xnet_by_net_name", {
  design: "board/board.DSN",
  net_name: "SPI_CLK",
});
```

| Option                 | Default                                           | What it does                                                         |
| ---------------------- | ------------------------------------------------- | -------------------------------------------------------------------- |
| `files`                | the local disk                                    | The `FileReader` every parser reads design files through             |
| `root`                 | the working directory at call time                | The directory relative `design` and `path` arguments resolve against |
| `secrets.dsnPasswords` | none                                              | Passwords to try, in order, on a password-protected OrCAD `.DSN`     |
| `kicadCli`             | on with the local disk, off with a custom `files` | `{ path, timeoutMs }` for `kicad-cli`, or `false` to never run it    |

The service reads nothing from the environment. The MCP server and the CLI read `KICAD_CLI_PATH`, `KICAD_CLI_TIMEOUT`, `UNIVERSAL_NETLIST_DSN_PASSWORD` and `UNIVERSAL_NETLIST_DSN_PASSWORD_FILE`; a host passes the same settings as these options.

### Reading files from somewhere else

A `FileReader` serves design files from any store: cloud storage, an archive, an upload held in memory. Paths are absolute, in the host's own form.

```ts
import type { FileReader } from "@intelligentelectron/universal-netlist/service";

const files: FileReader = {
  // The whole file. A missing file fails with an error whose `code` is "ENOENT".
  readFile: async (path) => new Uint8Array(await bucket.download(path)),
  exists: async (path) => bucket.exists(path),
  // Optional: list_designs needs it to walk a directory; every other tool works without it.
  listDir: async (path) =>
    (await bucket.list(path)).map((item) => ({
      name: item.name,
      isFile: () => !item.prefix,
      isDirectory: () => item.prefix,
    })),
  // Optional: the first bytes of a file, so discovery need not read a whole document.
  readPrefix: async (path, length) =>
    new Uint8Array(await bucket.download(path, { end: length - 1 })),
};

const netlist = createNetlistService({ files });
```

A design reads every file it is made of through the reader: an Altium project its `.SchDoc` and `.Harness` files, a KiCad project its schematic sheets and saved `.net` export. `kicad-cli` reads the local disk itself, so it is off for a custom reader; a KiCad design served that way needs its `.net` export beside the project, unless you turn `kicadCli` on because the reader's paths are local files too.

### Positional functions

The functions `./service` has always exported (`listComponents(design, type, includeDns, designVariant)` and the rest) still work. They read the local disk with the environment's settings, as before, and apply the same defaults as the tools, because each one calls its tool.

## Tool registry

`@intelligentelectron/universal-netlist/tools` exports the registry the MCP server is built from. Every tool the server offers is one entry, so a host sees the same names, descriptions, argument schemas and defaults an MCP client does.

```ts
import { TOOLS, callTool, findTool } from "@intelligentelectron/universal-netlist/tools";

// Offer the tools to a model: name, title, description, annotations, zod schema.
for (const tool of TOOLS) {
  console.log(tool.name, tool.annotations.readOnlyHint, tool.inputSchema);
}

// Call one on raw arguments. The schema parses them first and applies defaults.
const result = await callTool("search_nets", { design: "board.DSN", pattern: "^VCC" });
```

| Export                 | What it is                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| `TOOLS`                | Every tool this build offers, in the order MCP clients list them                                     |
| `findTool(name)`       | The entry with that exact snake_case name, or `undefined`                                            |
| `callTool(name, args)` | Parse `args` with the tool's schema, then run it                                                     |
| `ToolDefinition`       | One entry: `name`, `title`, `description`, `annotations`, `inputSchema` (a zod strict object), `run` |

Each entry's `inputSchema` is a zod 4 strict object, so an argument it does not define is refused. `callTool` returns a refusal as an `{ error }` result naming the argument, the same shape every tool uses for its own failures; check for an `error` field before reading the rest. `run` takes arguments the schema has already parsed; call it directly only with the output of `inputSchema.parse`.

The registry imports neither the MCP SDK nor OpenTelemetry, so a host that uses only `./tools` loads neither.
