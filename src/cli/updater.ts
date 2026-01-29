/**
 * Auto-updater for universal-netlist server.
 *
 * Checks GitHub Releases for newer versions and self-updates on startup.
 * Can be disabled via UNIVERSAL_NETLIST_MCP_NO_UPDATE=1 environment variable.
 */

import {
  createWriteStream,
  chmodSync,
  renameSync,
  unlinkSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { spawn } from "node:child_process";
import { VERSION, GITHUB_REPO, BINARY_NAME } from "../version.js";

/** GitHub release information. */
interface GitHubRelease {
  tag_name: string;
  assets: Array<{
    name: string;
    browser_download_url: string;
  }>;
}

/** Result of an update check. */
export interface UpdateCheckResult {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string | null;
  downloadUrl: string | null;
  error?: string;
}

/** Result of an update operation. */
export interface UpdateResult {
  success: boolean;
  previousVersion: string;
  newVersion: string | null;
  error?: string;
}

/**
 * Get the platform-specific binary name.
 */
const getPlatformBinaryName = (): string => {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === "darwin") {
    return arch === "arm64"
      ? `${BINARY_NAME}-darwin-arm64`
      : `${BINARY_NAME}-darwin-x64`;
  } else if (platform === "linux") {
    return arch === "arm64"
      ? `${BINARY_NAME}-linux-arm64`
      : `${BINARY_NAME}-linux-x64`;
  } else if (platform === "win32") {
    return `${BINARY_NAME}-windows-x64.exe`;
  }

  throw new Error(`Unsupported platform: ${platform}-${arch}`);
};

/**
 * Parse a version string into comparable parts.
 */
const parseVersion = (version: string): number[] => {
  const cleaned = version.replace(/^v/, "");
  return cleaned.split(".").map((part) => parseInt(part, 10) || 0);
};

/**
 * Compare two version strings. Returns:
 * - Negative if a < b
 * - Zero if a === b
 * - Positive if a > b
 */
const compareVersions = (a: string, b: string): number => {
  const partsA = parseVersion(a);
  const partsB = parseVersion(b);
  const maxLen = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < maxLen; i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;
    if (numA !== numB) {
      return numA - numB;
    }
  }
  return 0;
};

/**
 * Fetch the latest release from GitHub.
 */
const fetchLatestRelease = async (): Promise<GitHubRelease> => {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": `${BINARY_NAME}/${VERSION}`,
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("No releases found");
    }
    throw new Error(
      `GitHub API error: ${response.status} ${response.statusText}`,
    );
  }

  return response.json() as Promise<GitHubRelease>;
};

/**
 * Check if an update is available.
 */
export const checkForUpdate = async (): Promise<UpdateCheckResult> => {
  try {
    const release = await fetchLatestRelease();
    const latestVersion = release.tag_name.replace(/^v/, "");
    const updateAvailable = compareVersions(latestVersion, VERSION) > 0;

    let downloadUrl: string | null = null;
    if (updateAvailable) {
      const binaryName = getPlatformBinaryName();
      const asset = release.assets.find((a) => a.name === binaryName);
      if (asset) {
        downloadUrl = asset.browser_download_url;
      }
    }

    return {
      updateAvailable,
      currentVersion: VERSION,
      latestVersion,
      downloadUrl,
    };
  } catch (error) {
    return {
      updateAvailable: false,
      currentVersion: VERSION,
      latestVersion: null,
      downloadUrl: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

/**
 * Download a file from a URL to a local path.
 */
const downloadFile = async (url: string, destPath: string): Promise<void> => {
  const response = await fetch(url, {
    headers: {
      "User-Agent": `${BINARY_NAME}/${VERSION}`,
    },
  });

  if (!response.ok) {
    throw new Error(
      `Download failed: ${response.status} ${response.statusText}`,
    );
  }

  const fileStream = createWriteStream(destPath);

  return new Promise((resolve, reject) => {
    if (!response.body) {
      reject(new Error("No response body"));
      return;
    }

    const reader = response.body.getReader();

    const pump = async (): Promise<void> => {
      const { done, value } = await reader.read();
      if (done) {
        fileStream.end();
        return;
      }
      fileStream.write(Buffer.from(value));
      return pump();
    };

    fileStream.on("finish", resolve);
    fileStream.on("error", reject);

    pump().catch(reject);
  });
};

/**
 * Get the path to the current executable.
 */
const getCurrentExecutablePath = (): string => {
  // For Bun-compiled binaries, process.execPath points to the binary itself
  // For Node.js, process.argv[1] is the script path
  if (process.execPath.includes("node") || process.execPath.includes("bun")) {
    // Running via node/bun interpreter - use argv[1]
    return process.argv[1];
  }
  // Compiled binary - use execPath
  return process.execPath;
};

/**
 * Generate a unique backup path with timestamp to avoid conflicts with locked files.
 * On Windows, previous backup files may still be locked by the old process.
 */
const getBackupPath = (currentPath: string): string => {
  return `${currentPath}.backup.${Date.now()}`;
};

/**
 * Clean up old backup files from previous updates (best effort).
 * On Windows, backup files may remain if the old process was still running.
 * This is non-fatal - if files are locked, they'll be cleaned up next time.
 */
const cleanupOldBackups = (currentPath: string): void => {
  const dir = dirname(currentPath);
  const base = basename(currentPath);
  try {
    const files = readdirSync(dir);
    for (const file of files) {
      if (file.startsWith(`${base}.backup.`)) {
        try {
          unlinkSync(join(dir, file));
        } catch {
          // Ignore - file may still be locked
        }
      }
    }
  } catch {
    // Ignore directory read errors
  }
};

/**
 * Perform the update by downloading and replacing the current binary.
 */
export const performUpdate = async (
  downloadUrl: string,
  newVersion: string,
): Promise<UpdateResult> => {
  const currentPath = getCurrentExecutablePath();
  const tempPath = join(tmpdir(), `${BINARY_NAME}-update-${Date.now()}`);
  // Use timestamped backup to avoid conflicts with locked files from previous updates
  const backupPath = getBackupPath(currentPath);

  // Clean up old backups from previous updates (best effort, non-fatal)
  cleanupOldBackups(currentPath);

  try {
    // Download new binary to temp location
    await downloadFile(downloadUrl, tempPath);

    // Make executable
    if (process.platform !== "win32") {
      chmodSync(tempPath, 0o755);
    }

    // Backup current binary
    if (existsSync(currentPath)) {
      renameSync(currentPath, backupPath);
    }

    // Move new binary into place
    renameSync(tempPath, currentPath);

    // Remove backup (non-fatal on Windows due to file locking)
    if (existsSync(backupPath)) {
      try {
        unlinkSync(backupPath);
      } catch {
        // On Windows, the old executable may still be locked.
        // This is fine - it will be cleaned up on next update.
      }
    }

    return {
      success: true,
      previousVersion: VERSION,
      newVersion,
    };
  } catch (error) {
    // Attempt to restore backup
    if (existsSync(backupPath) && !existsSync(currentPath)) {
      try {
        renameSync(backupPath, currentPath);
      } catch {
        // Ignore restore errors
      }
    }

    // Clean up temp file
    if (existsSync(tempPath)) {
      try {
        unlinkSync(tempPath);
      } catch {
        // Ignore cleanup errors
      }
    }

    return {
      success: false,
      previousVersion: VERSION,
      newVersion: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

/**
 * Re-execute the current process with the same arguments.
 */
export const reexec = (): never => {
  const execPath = getCurrentExecutablePath();
  const args = process.argv.slice(2);

  // Spawn the new process
  const child = spawn(execPath, args, {
    stdio: "inherit",
    detached: false,
  });

  // Exit this process when child exits
  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });

  child.on("error", (err) => {
    console.error("Failed to restart:", err.message);
    process.exit(1);
  });

  // This line is reached but we've set up handlers to exit
  // TypeScript needs the never return type satisfied
  throw new Error("Process should have been replaced");
};

/**
 * Check for updates and apply if available.
 * This is the main entry point for auto-updates on startup.
 *
 * @returns true if an update was applied and process should restart
 */
export const autoUpdate = async (): Promise<boolean> => {
  // Check if updates are disabled
  if (process.env.UNIVERSAL_NETLIST_MCP_NO_UPDATE === "1") {
    return false;
  }

  const check = await checkForUpdate();

  if (check.error) {
    // Silently continue if update check fails
    return false;
  }

  if (!check.updateAvailable || !check.downloadUrl || !check.latestVersion) {
    return false;
  }

  // Log update to stderr (MCP uses stdio, so stdout is reserved)
  console.error(
    `[universal-netlist] Updating from ${VERSION} to ${check.latestVersion}...`,
  );

  const result = await performUpdate(check.downloadUrl, check.latestVersion);

  if (!result.success) {
    console.error(`[universal-netlist] Update failed: ${result.error}`);
    return false;
  }

  console.error(`[universal-netlist] Update complete. Restarting...`);
  return true;
};
