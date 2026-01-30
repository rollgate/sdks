import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@rollgate/sdk-browser": path.resolve(
        __dirname,
        "../sdk-browser/dist/index.js",
      ),
    },
  },
  test: {
    globals: true,
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
    setupFiles: ["./src/setupTests.ts"],
  },
});
