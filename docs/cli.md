# Command Line

The `universal-netlist` binary is an MCP server: an MCP client runs it with no command and speaks to it over stdio. Run by hand with no command, it prints how to set that up instead of serving. Everything else it can do is a command, and every MCP tool is one too; see [Query tools](#query-tools). One tool, [`export_design`](#export_design), is offered by the command line only. Every command is accepted as a word (`universal-netlist update`) and as a flag (`universal-netlist --update`); the pages below use the word form.

```
Usage: universal-netlist [options] [command]

Options:
  -v, --version        Output the version number
  -h, --help           Display help for command

Commands:
  update|upgrade       Check for updates and install if available
  uninstall            Remove the binary and its PATH entries
  export-telemetry     Export telemetry data as a zip file
  <tool> [design] --flag value ...
                       Run a tool and print its JSON result: any MCP tool, or
                       export_design (command line only)
```

## Query tools

```bash
universal-netlist <tool> [design] --flag value ...
universal-netlist <tool> --help
```

Every MCP tool is a command under its own name, for a shell or an agent without MCP: `list_designs`, `search_nets`, `query_xnet_by_net_name` and the rest (`universal-netlist --help` lists them). [`export_design`](#export_design) is a tool of the command line only, and takes its flags the same way. Each call is stateless and self-contained: it names the design, and prints one result.

The flags are the tool's arguments, built from the same schema the MCP server registers, so the names, defaults and checks are the same:

| Argument kind | Written as |
|---------------|------------|
| text or number | `--net_name SPI_CLK` or `--net_name=SPI_CLK`. A value starting with a dash needs `=`: `--net_name=-12V` |
| boolean | `--include_dns` alone is true; `--include_dns false` or `--include_dns=false` |
| list | the flag repeated: `--skip_types C --skip_types L` |
| `design` | `--design board.DSN`, or the first argument: `universal-netlist search_nets board.DSN --pattern '^V'` |

The result is the tool's JSON on stdout: indented on a terminal, one compact line otherwise.

| Exit | Meaning |
|------|---------|
| 0 | The result answers the query |
| 1 | The result has an `error` field |
| 2 | A usage error: an unknown, repeated or missing flag, or a value of the wrong kind. The message and the tool's usage line go to stderr, and the tool does not run |

`--help` (or `-h`) anywhere after the tool's name prints its description and every flag instead. A first word that is neither a command nor a tool exits 2 with the list of tools; it never starts the server. Query commands never update the binary.

Each call is a new process, so its parse ends with it. `--cache`, `UNIVERSAL_NETLIST_CACHE=1` or `UNIVERSAL_NETLIST_CACHE_DIR=<dir>` keep parses on disk between calls; see [Parse cache](parse-cache.md#command-line-on-disk). The settings the server reads from the environment (`KICAD_CLI_PATH`, `KICAD_CLI_TIMEOUT`, the OrCAD password variables) apply here too.

The rules are golden decision tables: [flag parsing](decision-tables/query-cli/flag.rules.md), [the positional design](decision-tables/query-cli/positional.rules.md) and [exit codes](decision-tables/query-cli/exit.rules.md).

## export_design

```bash
universal-netlist export_design <design> [--output <path>] [--design_variant <name>]
universal-netlist export_design --help
```

Writes one build of a design as a `.netlist.json` file in the [Universal Netlist schema](schemas/universal-netlist.md), for a program that post-processes the whole netlist: a script, a diff between revisions or builds, another tool. To answer a question about a design, use the query tools; they read the design directly and return only what was asked. `export_design` is a tool of the command line only: the MCP server does not offer it.

It is a tool like the query tools, so it parses its flags, prints its help and result, and exits by the same rules (see [Query tools](#query-tools)):

| Flag | Meaning |
|------|---------|
| `--design` | Any file the server reads: a Cadence `.DSN`, an Altium `.PrjPcb`, a KiCad `.kicad_pro`, or a Universal Netlist `.netlist.json` itself. May be the first argument instead |
| `--output` | Where to write. It must end in `.netlist.json`. Default: `<design name>.netlist.json` in the working directory |
| `--design_variant` | The build to export, by the rule every query applies: required when the design defines named variants, which are the only builds it records, and one of the names `list_designs` reports. `<Default>` is refused on such a design. Optional for a design without variants, whose base build is exported |

Each part's `dns` flag is its Do Not Stuff state in the exported build, and the variant's substitutions replace the base part's fields. The file records the variant in `metadata.designVariant`; a base build records none. The document also carries `universalNetlistSchemaVersion` (currently `3`), a UTC generation time, a verified SHA-256 over `nets` and `components` together, and native or vendor provenance. Re-exporting a Universal Netlist preserves its origin and its variant.

The result names the design, the build written and the absolute path written:

```json
{"design":"/work/MyBoard.DSN","design_variant":"Fab-A","output":"/work/out/board.netlist.json"}
```

The written file is itself a design: `list_designs` finds it, and every tool reads it. A file that records a variant lists that one name under `design_variants`, and queries of it name it with `design_variant`, as queries of its source do.

```bash
universal-netlist export_design MyBoard.kicad_pro                   # writes ./MyBoard.netlist.json
universal-netlist export_design MyBoard.DSN --design_variant Fab-A --output out/board.netlist.json
```

A design that does not load, or a missing or unknown variant, exits 1 with the reason in the result's `error`, and nothing is written. An unknown flag, a second path or an output path without `.netlist.json` exits 2. A password-protected OrCAD design reads its password from the environment; see [Password-protected OrCAD designs](password-protected-designs.md).

Through v1.13.2 this was the `export-json` command, which took the output as a second path and ignored `--design_variant`. `export-json` now exits 2 with a message naming `export_design`.

## update

```bash
universal-netlist update    # upgrade works too
```

Checks GitHub for a newer release and replaces the binary in place. The server also checks on startup. A binary installed by a package manager (Homebrew, a distro package) is managed by that manager, and this command says so instead of touching the file. A copy running under Node.js or Bun, as an npm install does, reports whether a newer release exists and updates with `npm update -g @intelligentelectron/universal-netlist`.

## uninstall

```bash
universal-netlist uninstall
```

Removes the binary, its update backups, and the PATH entries `install.sh` added to the shell profile. In the installer's `universal-netlist/bin/` layout it also removes the local telemetry log and `.mcpb` file beside `bin/`, then `bin/` and the install directory once each is empty; a binary anywhere else, such as `/usr/local/bin`, takes nothing else with it. What it cannot remove, such as the running `.exe` on Windows, it lists for removal by hand, and the Windows user PATH entry `install.ps1` added stays. A package-managed install is removed by its package manager, and a copy running under Node.js or Bun points at `npm uninstall -g @intelligentelectron/universal-netlist`; either way the command says so.

## export-telemetry

```bash
universal-netlist export-telemetry
```

Writes the server's [local usage log](observability.md#local-usage-log) as a zip file in the working directory, using `zip` on macOS and Linux and `tar` on Windows. The server records that log each time it starts and on every tool call, whatever the OpenTelemetry settings.
