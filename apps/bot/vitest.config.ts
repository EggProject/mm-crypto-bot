import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

import { loadScopeManifest, REPOSITORY_ROOT } from "../../scripts/coverage-tools/bot-runtime-scope.ts";

const manifest = loadScopeManifest();
const appPrefix = "apps/bot/";
const relativeToApp = (file: string): string => {
  if (!file.startsWith(appPrefix)) throw new Error(`bot Vitest path is outside apps/bot: ${file}`);
  return file.slice(appPrefix.length);
};

export default defineConfig({
  root: resolve(REPOSITORY_ROOT, "apps/bot"),
  cacheDir: resolve(REPOSITORY_ROOT, "apps/bot/coverage/unit/.vitest-cache"),
  resolve: {
    alias: [
      { find: "bun:test", replacement: resolve(REPOSITORY_ROOT, "apps/bot/test/bun-test-vitest.ts") },
      {
        find: /^@exchange-testing\/(.*)$/,
        replacement: `${resolve(REPOSITORY_ROOT, "packages/exchange/src/__testing__")}/$1`,
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
    setupFiles: [resolve(REPOSITORY_ROOT, "apps/bot/test/vitest.setup.ts")],
    include: manifest.unitTestFiles.map(relativeToApp),
    coverage: {
      provider: "v8",
      enabled: true,
      include: manifest.runtimeFiles.map(relativeToApp),
      reportsDirectory: resolve(REPOSITORY_ROOT, "apps/bot/coverage/unit"),
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
