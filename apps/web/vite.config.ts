import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

// Phase 47B: lightweight-charts is not yet used in src/ (it lands in Phase 48).
// The `manualChunks` config below is forward-looking — it splits the vendored
// bundle into its own chunk once Phase 48 imports it. We guard the path so
// that the build still passes in environments where the eggproject-design
// skill has not been symlinked into the repo (CI runners, fresh worktrees).
// The `existsSync` check is a no-op cost (single fs.stat on a 200KB file).
const lightweightChartsPath = resolve(
  __dirname,
  "../../skills/eggproject-design-trade-components/assets/vendor/lightweight-charts.standalone.production.js",
);

export default defineConfig({
  plugins: [react()],
  base: "/",
  build: {
    outDir: "dist",
    sourcemap: true,
    target: "es2022",
    rollupOptions: {
      output: {
        manualChunks: existsSync(lightweightChartsPath)
          ? { "lightweight-charts": [lightweightChartsPath] }
          : undefined,
      },
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  resolve: {
    alias: {
      "@mm-crypto-bot/core": resolve(__dirname, "../../packages/core/src/index.ts"),
    },
  },
});
