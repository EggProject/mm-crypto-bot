import path from "node:path";

import { defineConfig } from "vitest/config";

import { loadScopeManifest, REPOSITORY_ROOT } from "../../scripts/coverage-tools/bot-runtime-scope.ts";

const manifest = loadScopeManifest();
const appPrefix = "apps/bot/";
const relativeToApp = (file: string): string => {
  if (!file.startsWith(appPrefix)) throw new Error(`bot Vitest path is outside apps/bot: ${file}`);
  return file.slice(appPrefix.length);
};

export default defineConfig({
  root: path.resolve(REPOSITORY_ROOT, "apps/bot"),
  cacheDir: path.resolve(REPOSITORY_ROOT, "apps/bot/coverage/unit/.vitest-cache"),
  resolve: {
    alias: [
      { find: "bun:test", replacement: path.resolve(REPOSITORY_ROOT, "apps/bot/test/bun-test-vitest.ts") },
      {
        find: "@exchange-testing/mockFeed.js",
        replacement: path.resolve(REPOSITORY_ROOT, "packages/exchange/src/testing/mock-feed.ts"),
      },
      {
        find: /^@exchange-testing\/(.*)$/,
        replacement: `${path.resolve(REPOSITORY_ROOT, "packages/exchange/src/testing")}/$1`,
      },
      {
        find: "@logging-testing",
        replacement: path.resolve(REPOSITORY_ROOT, "packages/logging/test-support/index.ts"),
      },
    ],
  },
  test: {
    environment: "node",
    // Several Bun-authored suites temporarily replace process-wide streams,
    // signals and the global Bun compatibility object. Keep files serial so
    // those process-global fixtures cannot race in Vitest workers.
    fileParallelism: false,
    pool: "forks",
    maxWorkers: 1,
    reporters: ["dot"],
    setupFiles: [path.resolve(REPOSITORY_ROOT, "apps/bot/test/vitest.setup.ts")],
    include: manifest.unitTestFiles.map((file) => relativeToApp(file)),
    coverage: {
      provider: "v8",
      enabled: true,
      include: manifest.runtimeFiles.map((file) => relativeToApp(file)),
      reportsDirectory: path.resolve(REPOSITORY_ROOT, "apps/bot/coverage/unit"),
      reporter: ["text-summary", "json-summary", "json", "lcov", "html"],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
});
