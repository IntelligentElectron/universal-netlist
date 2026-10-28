# Password-protected OrCAD designs

An OrCAD `.DSN` saved with a password is read directly, like any other design. The server takes the
password from its own environment, never from a tool call: no tool call carries a password in or
out, and nothing the assistant types can supply one.

## Setting the password

Give the server one of two environment variables:

| Variable | Holds |
|---|---|
| `UNIVERSAL_NETLIST_DSN_PASSWORD` | one password |
| `UNIVERSAL_NETLIST_DSN_PASSWORD_FILE` | the path of a text file with one password per line |

Set both and the server tries the single password first, then each line of the file. A protected
design opens with whichever password decrypts it; the others are passed over, so one file can hold
the passwords of every design you work with. A protected design is parsed on every query: its
decrypted content is never kept in the [parse cache](parse-cache.md), in memory or on disk. Blank lines, and passwords that are not 1 to 255
printable ASCII characters, are skipped. Keep the file private to your account:

```bash
chmod 600 ~/.orcad-passwords
```

### Claude Code and the Claude desktop app

The plugin's server inherits Claude Code's environment, so export the variable in your shell
profile, then restart Claude Code or the Claude desktop app:

```bash
export UNIVERSAL_NETLIST_DSN_PASSWORD_FILE=$HOME/.orcad-passwords
```

### OpenAI Codex

Codex starts a plugin's server without your environment variables, so the plugin's server never
sees the password. Turn that server off in `~/.codex/config.toml`:

```toml
[plugins."universal-netlist@universal-netlist".mcp_servers.universal-netlist]
enabled = false
```

and register the server yourself with the variable:

```bash
codex mcp add universal-netlist --env UNIVERSAL_NETLIST_DSN_PASSWORD_FILE=$HOME/.orcad-passwords -- universal-netlist
```

### Any other MCP client

Add the variable to the server's `env` block in the client's configuration:

```json
{
  "mcpServers": {
    "universal-netlist": {
      "command": "universal-netlist",
      "env": {
        "UNIVERSAL_NETLIST_DSN_PASSWORD_FILE": "/Users/you/.orcad-passwords"
      }
    }
  }
}
```

Restart the client, or reconnect the server, after changing its environment.

## Exporting a protected design

`export_design` reads the same variables:

```bash
UNIVERSAL_NETLIST_DSN_PASSWORD_FILE=~/.orcad-passwords universal-netlist export_design Board.DSN
```

The `.netlist.json` it writes is not protected.

## When a design does not open

| Message | Meaning |
|---|---|
| `Password-protected OrCAD design: set UNIVERSAL_NETLIST_DSN_PASSWORD or UNIVERSAL_NETLIST_DSN_PASSWORD_FILE` | the server has no password; set a variable and restart the server |
| `No password in UNIVERSAL_NETLIST_DSN_PASSWORD or UNIVERSAL_NETLIST_DSN_PASSWORD_FILE opens this OrCAD design` | none of the passwords given decrypts the design; any it skipped, as not 1 to 255 printable ASCII characters, are listed after |
| `Cannot read UNIVERSAL_NETLIST_DSN_PASSWORD_FILE: ...` | the file is missing or unreadable |
| `Stream '...' is encrypted in a format other than SYENCRYPT01` | the design uses an encryption this reader does not cover |

`list_designs` lists a protected design and its variants without a password.

## Where the password goes

The server decrypts in memory and passes the passwords to nothing else: not to tool results, not to
telemetry, and not to the programs it starts, such as `kicad-cli`. They stay wherever you put them,
the client configuration or the password file, readable there by anything running as your account,
an assistant allowed to run shell commands included.
