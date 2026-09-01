# Command Line

The `universal-netlist` binary is an MCP server: an MCP client runs it with no command and speaks to it over stdio. Run by hand with no command, it prints how to set that up instead of serving. Everything else it can do is a command. Every command is accepted as a word (`universal-netlist update`) and as a flag (`universal-netlist --update`); the pages below use the word form.

```
Usage: universal-netlist [options] [command]

Options:
  -v, --version        Output the version number
  -h, --help           Display help for command
  --verbose            Show per-design field mismatch breakdowns (with coverage)

Commands:
  update|upgrade       Check for updates and install if available
  uninstall            Remove the binary and its PATH entries
  export-telemetry     Export telemetry data as a zip file
  export-json <design> [out.netlist.json]
                       Write a design's netlist as Universal Netlist JSON
  coverage [path]      Compare DSN parser output against DAT netlist exports
```

## export-json

```bash
universal-netlist export-json <design> [output.netlist.json]
```

Parses a design and writes its netlist as one `.netlist.json` file in the [Universal Netlist schema](schemas/universal-netlist.md). `<design>` is any file the server reads: a Cadence `.DSN`, an Altium `.PrjPcb`, a KiCad `.kicad_pro`, or a Universal Netlist `.netlist.json` itself. The document carries `universalNetlistSchemaVersion` (currently `1`), a verified SHA-256 content hash, and the UTC export time. Without an explicit output path the file is written as `<design>.netlist.json` in the working directory; an explicit output must also end in `.netlist.json`. Either way, the path written is printed on stdout.

The written file is itself a design: `list_designs` finds it and every tool reads it, so an export round-trips. That makes it a snapshot you can commit, diff between revisions, or hand to another tool, with no EDA installation on the receiving side.

```bash
universal-netlist export-json MyBoard.kicad_pro          # writes ./MyBoard.netlist.json
universal-netlist export-json MyBoard.DSN out/board.netlist.json
```

A design that does not load exits 1 and prints the parser's message, naming the first defect.

## update

```bash
universal-netlist update    # upgrade works too
```

Checks GitHub for a newer release and replaces the binary in place. The server also checks on startup. A binary installed by a package manager (Homebrew, npm, a distro package) is managed by that manager, and this command says so instead of touching the file; npm installs update with `npm update -g @intelligentelectron/universal-netlist`.

## uninstall

```bash
universal-netlist uninstall
```

Removes the binary and the PATH entries `install.sh` added to the shell profile. A package-managed install is removed by its package manager, and the command says so.

## export-telemetry

```bash
universal-netlist export-telemetry
```

Writes the locally recorded [telemetry](observability.md) as a zip file in the working directory. Telemetry is off by default; this exports only what `OTEL_*` configuration recorded.

## coverage

```bash
universal-netlist coverage [path] [verbose]
```

For every Cadence design under `path` (default: the working directory) that has both a `.DSN` schematic and exported `.dat` netlist files, parses both and writes a markdown report to the working directory comparing them. `verbose` adds per-design field mismatch breakdowns. This is a parser-development tool: the `.dat` files are the reference the `.DSN` parser is measured against.

The one ambiguity the word forms carry: a token right after `coverage` is read as its path unless it is itself a command word, so a directory literally named `verbose` is given as `./verbose`. The value after `export-json` is always a path.
