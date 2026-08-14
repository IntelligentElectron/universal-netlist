import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // On network volumes (NFS/SMB) macOS drops `._name` AppleDouble sidecars beside
    // every file, including `*.test.ts`. They are binary metadata, not test files:
    // collecting them fails the run with an esbuild "Transform failed" error.
    exclude: [...configDefaults.exclude, "**/._*"],
    globalSetup: ["./test/global-setup.ts"],
  },
});
