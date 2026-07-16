import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Phase 48A: lightweight-charts is now imported from the npm package
// (see apps/web/package.json). The eggproject-design skill also
// vendors a UMD copy of the same library, but we use the npm ESM
// build (proper .d.ts, Vite-friendly). This manualChunks function
// splits the npm ESM module into its own cache-friendly chunk
// WITHOUT also creating an empty chunk for the (un-imported) UMD
// vendored file — which is what the previous `existsSync`-gated
// config did, and the empty chunk caused Vite to print a
// "Generated an empty chunk" warning.
export default defineConfig({
  plugins: [react()],
  base: "/",
  build: {
    outDir: "dist",
    sourcemap: true,
    target: "es2022",
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes("node_modules/lightweight-charts/")) {
            return "lightweight-charts";
          }
        },
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
