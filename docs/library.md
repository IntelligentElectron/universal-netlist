# Library

The package is also a library. A host that has its own tool system (an app server, a serverless function, an agent framework) imports the tools and calls them in-process, with no MCP server to start and no stdio framing.

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

| Export | What it is |
|--------|------------|
| `TOOLS` | Every tool this build offers, in the order MCP clients list them |
| `findTool(name)` | The entry with that exact snake_case name, or `undefined` |
| `callTool(name, args)` | Parse `args` with the tool's schema, then run it |
| `ToolDefinition` | One entry: `name`, `title`, `description`, `annotations`, `inputSchema` (a zod strict object), `run` |

Each entry's `inputSchema` is a zod 4 strict object, so an argument it does not define is refused. `callTool` returns a refusal as an `{ error }` result naming the argument, the same shape every tool uses for its own failures; check for an `error` field before reading the rest. `run` takes arguments the schema has already parsed; call it directly only with the output of `inputSchema.parse`.

The registry imports neither the MCP SDK nor OpenTelemetry, so a host that uses only `./tools` loads neither.
