# Parse cache

Parsing is most of a query's cost: about 1.7 s for the largest OrCAD fixture, against a few milliseconds for the query itself. The server keeps recent parses and answers a repeat query from one, until a file the design reads changes.

## What makes a parse reusable

A parse is stored with every file probe it made: the content hash of each file it read (the `.DSN`, every Altium `.SchDoc` and `.Harness`, every KiCad sheet and saved `.net`), each path it checked for, and each directory it listed. The next query for the same design, design variant and package version repeats those probes and reuses the parse only when every answer is the same. Editing a sheet, adding a saved `.net` export beside a KiCad project, or upgrading the package each makes the next query parse again.

Not stored:

- a parse that fails, so a missing `kicad-cli` or a half-written file is retried on the next query
- a password-protected OrCAD design, so its decrypted content never outlives the passwords that opened it, and never reaches the disk

A design's list of variants is cached the same way, so a query costs one listing.

## MCP server: in memory

The server keeps the 8 most recently used parses in memory. Set `UNIVERSAL_NETLIST_CACHE_ENTRIES` to keep more, or `0` to parse on every query.

## Command line: on disk

Each command-line call is a new process, so the memory cache does not outlive it. The disk cache keeps parses across calls. It is off unless one of these turns it on:

| Setting                                            | Effect                                                          |
| -------------------------------------------------- | --------------------------------------------------------------- |
| `--cache`                                          | On for this call, whatever the variables say                    |
| `UNIVERSAL_NETLIST_CACHE=1` (`true`, `yes`, `on`)  | On                                                              |
| `UNIVERSAL_NETLIST_CACHE=0` (`false`, `no`, `off`) | Off, unless `--cache` is given                                  |
| `UNIVERSAL_NETLIST_CACHE_DIR=<dir>`                | On, in that directory, unless `UNIVERSAL_NETLIST_CACHE` is off  |
| `UNIVERSAL_NETLIST_CACHE_MAX_MB=<n>`               | Size cap, default 256; the least recently used entries go first |

The directory is the first of these that can be written:

1. `UNIVERSAL_NETLIST_CACHE_DIR`. A directory named on purpose is used as it is or not at all: if it cannot be written, that call runs without a disk cache.
2. `$XDG_CACHE_HOME/universal-netlist`, when `XDG_CACHE_HOME` is an absolute path
3. `~/.cache/universal-netlist`, when there is a home directory
4. `universal-netlist` in the temp directory

A read-only root filesystem or a container user with no home directory falls through to a writable temp mount. In Docker, mount a volume and name it, so the cache survives the container and can be shared between containers:

```bash
docker run -v netlist-cache:/cache -e UNIVERSAL_NETLIST_CACHE_DIR=/cache ...
```

The disk cache never fails a query. A directory that cannot be written, an entry that is unreadable or corrupt, or one written by another version of the package is a miss: the query parses and answers as it would without a cache. An entry is written to a temporary file and renamed into place, so processes or containers sharing the directory never read part of one.

Entries are JSON in this package's own versioned format, not Universal Netlist JSON, because a query reports two things that schema does not carry: `alternate_part`, and the net label sources behind `net_name_warnings`. A development build reports the version `0.0.0-development` whatever its code; clear the directory after changing a parser.

## Library

`createNetlistService` keeps 8 parses in memory by default. The `cache` option changes that:

```ts
createNetlistService({ cache: { maxEntries: 32 } }); // more in memory
createNetlistService({ cache: { dir: "/var/cache/netlist", maxBytes: 1e9 } }); // memory and disk
createNetlistService({ cache: false }); // parse every query
```

A cached parse is shared by every query and is deep-frozen; results are built from it, never by changing it.
