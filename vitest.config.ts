import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["packages/**/*.test.ts", "extension/src/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      include: ["packages/core/src/**/*.ts"],
    },
  },
  resolve: {
    alias: {
      "@combo-x/core": path.resolve(__dirname, "packages/core/src/index.ts"),
    },
  },
});
