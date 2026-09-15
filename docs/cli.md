# Command Line

The `universal-netlist` binary is an MCP server: an MCP client runs it with no command and speaks to it over stdio. Run by hand with no command, it prints how to set that up instead of serving. Everything else it can do is a command. Every command is accepted as a word (`universal-netlist update`) and as a flag (`universal-netlist --update`); the pages below use the word form.

```
Usage: universal-netlist [options] [command]

Options:
  -v, --version        Output the version number
  -h, --help           Display help for command

Commands:
  update|upgrade       Check for updates and install if available
  uninstall            Remove the binary and its PATH entries
  export-telemetry     Export telemetry data as a zip file
  export-json <design> [out.netlist.json]
                       Write a design's netlist as Universal Netlist JSON
```

## export-json

```bash
universal-netlist export-json <design> [output.netlist.json]
```

Parses a design and writes its netlist as one `.netlist.json` file in the [Universal Netlist schema](schemas/universal-netlist.md). `<design>` is any file the server reads: a Cadence `.DSN`, an Altium `.PrjPcb`, a KiCad `.kicad_pro`, or a Universal Netlist `.netlist.json` itself. The document carries `universalNetlistSchemaVersion` (currently `1`) and nested metadata with a UTC generation time, a verified SHA-256 over `nets` and `components` together, and either native or vendor provenance. Re-exporting a Universal Netlist preserves its origin. Without an explicit output path the file is written as `<design>.netlist.json` in the working directory; an explicit output must also end in `.netlist.json`. Either way, the path written is printed on stdout.

The written file is itself a design: `list_designs` finds it and every tool reads it, so an export round-trips. That makes it a snapshot you can commit, diff between revisions, or hand to another tool, with no EDA installation on the receiving side.

```bash
universal-netlist export-json MyBoard.kicad_pro          # writes ./MyBoard.netlist.json
universal-netlist export-json MyBoard.DSN out/board.netlist.json
```

A design that does not load exits 1 and prints the parser's message, naming the first defect. A password-protected OrCAD design reads its password from the environment; see [Password-protected OrCAD designs](password-protected-designs.md).

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

Writes the server's [local usage log](observability.md#local-usage-log) as a zip file in the working directory. The server records that log each time it starts and on every tool call, whatever the OpenTelemetry settings.
