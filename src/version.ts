/**
 * Version information for the Universal Netlist MCP Server.
 */

import { createRequire } from "node:module";

// BUILD_VERSION is injected at compile time via --define (for Bun binaries)
declare const BUILD_VERSION: string | undefined;

/** Current version of the server. */
export const VERSION = (() => {
  // Bun compiled binary: use injected version
  if (typeof BUILD_VERSION !== "undefined") {
    return BUILD_VERSION;
  }
  // Node.js/npm: read from package.json
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("../package.json") as { version: string };
    return pkg.version;
  } catch {
    return "0.0.0-dev";
  }
})();

/** GitHub repository in format owner/repo. */
export const GITHUB_REPO = "IntelligentElectron/universal-netlist";

/** Binary name for the compiled executable. */
export const BINARY_NAME = "universal-netlist";
