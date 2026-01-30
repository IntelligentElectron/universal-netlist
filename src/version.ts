/**
 * Version information for the Universal Netlist MCP Server.
 */

// BUILD_VERSION is injected at compile time via --define
declare const BUILD_VERSION: string | undefined;

/** Current version of the server. */
export const VERSION =
  typeof BUILD_VERSION !== "undefined" ? BUILD_VERSION : "0.0.0-dev";

/** GitHub repository in format owner/repo. */
export const GITHUB_REPO = "IntelligentElectron/universal-netlist";

/** Binary name for the compiled executable. */
export const BINARY_NAME = "universal-netlist";
