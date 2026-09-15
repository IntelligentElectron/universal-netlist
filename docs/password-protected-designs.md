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
the passwords of every design you work with. Blank lines, and passwords that are not 1 to 255
printable ASCII characters, are skipped. Keep the file private to your account:

```bash
chmod 600 ~/.orcad-passwords
```

### Claude Code and the Claude desktop app

Register the server with the variable. Claude Code in the Claude desktop app uses the servers
Claude Code registers, so this one command covers both:

```bash
claude mcp add --scope user universal-netlist -e UNIVERSAL_NETLIST_DSN_PASSWORD_FILE=$HOME/.orcad-passwords -- universal-netlist
```

If the server is already registered, remove it first with `claude mcp remove universal-netlist`.

### OpenAI Codex

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

`export-json` reads the same variables:

```bash
UNIVERSAL_NETLIST_DSN_PASSWORD_FILE=~/.orcad-passwords universal-netlist export-json Board.DSN
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
