# Command Line

The `universal-netlist` binary is an MCP server: an MCP client runs it with no command and speaks to it over stdio. Run by hand with no command, it prints how to set that up instead of serving. Everything else it can do is a command. Every command is accepted as a word (`universal-netlist update`) and as a flag (`universal-netlist --update`); the pages below use the word form.

```
Usage: universal-netlist [options] [command]

Options:
  -v, --version        Output the version number
  -h, --help           Display help for command
  --verbose            Show per-design field mismatch breakdowns (with coverage)
  --password-stdin     Read an OrCAD DSN password from piped input (export-json)

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

Parses a design and writes its netlist as one `.netlist.json` file in the [Universal Netlist schema](schemas/universal-netlist.md). `<design>` is any file the server reads: a Cadence `.DSN`, an Altium `.PrjPcb`, a KiCad `.kicad_pro`, or a Universal Netlist `.netlist.json` itself. The document carries `universalNetlistSchemaVersion` (currently `1`) and nested metadata with a UTC generation time, a verified SHA-256 over `nets` and `components` together, and either native or vendor provenance. Re-exporting a Universal Netlist preserves its origin. Without an explicit output path the file is written as `<design>.netlist.json` in the working directory; an explicit output must also end in `.netlist.json`. Either way, the path written is printed on stdout.

The written file is itself a design: `list_designs` finds it and every tool reads it, so an export round-trips. That makes it a snapshot you can commit, diff between revisions, or hand to another tool, with no EDA installation on the receiving side.

```bash
universal-netlist export-json MyBoard.kicad_pro          # writes ./MyBoard.netlist.json
universal-netlist export-json MyBoard.DSN out/board.netlist.json
```

A design that does not load exits 1 and prints the parser's message, naming the first defect.

### Password-protected OrCAD DSN files

`export-json` accepts `--password-stdin` for OrCAD `.DSN` files using
`FILE_FMT_SYENCRYPT01`. Supply the password through a pipe; one final LF or CRLF
is removed, while spaces are preserved. The password is not a command-line
argument. On Windows, using PowerShell 7:

```powershell
Read-Host -MaskInput 'DSN password' | universal-netlist export-json Board.DSN board.netlist.json --password-stdin
```

On Linux, using Bash:

```bash
IFS= read -r -s -p 'DSN password: ' password
printf '\n'
printf '%s\n' "$password" |
  universal-netlist export-json Board.DSN board.netlist.json --password-stdin
unset password
```

The reader decrypts streams in memory and leaves the source DSN unchanged. It
requires no Cadence installation or native cryptography library. The resulting
netlist JSON is unprotected. Missing or incorrect passwords fail before export.
This currently supports 1–255 printable ASCII password characters and
SYENCRYPT01 only; other password encodings and encryption formats are rejected.
The Library header validates the password, but does not authenticate the whole
file against corruption or tampering. MCP queries also accept a per-call
`password` argument, as described below.

Programmatic callers of `parseDesign` or `parseDsnFile` can supply
`{ password: "..." }` in `ParseDesignOptions` alongside existing options.


## Password-protected designs through MCP

Every design-query tool accepts an optional `password` argument for protected
OrCAD `.DSN` files. For example, a `list_nets` call can use these arguments:

```json
{
  "design": "/home/user/designs/Board.DSN",
  "design_variant": "<Default>",
  "password": "your-dsn-password"
}
```

Supply the password on each call to listing, searching, component/XNET querying,
or ERC tools that take a `design` argument. Passwords are not retained between
calls. Other formats reject a supplied password. The same SYENCRYPT01 and
printable-ASCII limits apply as in the CLI.

`list_designs` needs no password: OrCAD variant names come from the unencrypted
container directory. Choose the desired `design_variant` when querying; a
password does not bypass variant selection. `--password-stdin` is only for CLI
export, since stdin carries protocol messages in MCP mode.

The server redacts the `password` argument in local telemetry and OpenTelemetry
argument capture, and does not include it in query results. The MCP client still
receives the password as a tool argument and may retain it in its conversation
history or logs.


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

For every Cadence design under `path` (default: the working directory) that has both a `.DSN` schematic and exported `.dat` netlist files, parses both and writes a markdown report to the working directory comparing them. `verbose` adds per-design field mismatch breakdowns. This is a parser-development tool: the `.dat` files are the reference the `.DSN` parser is measured against. DAT parsing and the Cadence exporter remain available to this CLI workflow while dormant in MCP. On Windows, coverage can generate missing reference exports through the retained Cadence exporter.

The one ambiguity the word forms carry: a token right after `coverage` is read as its path unless it is itself a command word, so a directory literally named `verbose` is given as `./verbose`. The value after `export-json` is always a path.
