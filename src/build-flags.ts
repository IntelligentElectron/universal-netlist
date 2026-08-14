/**
 * Build-time flags for the compiled binary.
 *
 * `BUILD_CHANNEL` is injected at compile time via `--define`, the same
 * mechanism `BUILD_VERSION` uses; see `scripts/build-binary.sh`.
 */

// Injected at compile time via --define (for Bun binaries).
declare const BUILD_CHANNEL: string | undefined;

/**
 * Who owns the installed binary.
 *
 * - `github`: installed by `install.sh` from a GitHub release. It owns its own
 *   file, so it self-updates and can uninstall itself. This is the default, and
 *   what every existing install is.
 * - `packaged`: installed by a package manager (Homebrew, nix, a distro
 *   package, a vendored copy). The file belongs to that package manager, is
 *   often root-owned or on a read-only prefix, and replacing it in place would
 *   desynchronize the manager's view of what is installed and break its
 *   file-integrity checks. Such a host may also have no outbound network at
 *   all, so a startup update check is a failed HTTP call every time.
 *
 * Build a packaged binary with the third argument of the build script:
 * `scripts/build-binary.sh bun-linux-x64 <outfile> packaged`.
 */
export const CHANNEL = typeof BUILD_CHANNEL !== "undefined" ? BUILD_CHANNEL : "github";

/** Whether this build may replace its own binary. */
export const SELF_UPDATE_ENABLED = CHANNEL === "github";
