import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  base: "/",
  build: {
    outDir: "dist",
    sourcemap: true,
    target: "es2022",
    rollupOptions: {
      output: {
        manualChunks: {
          // The vendored lightweight-charts is large; split it into its own
          // chunk so the initial paint only loads the app shell.
          "lightweight-charts": [
            resolve(__dirname, "../../skills/eggproject-design-trade-components/assets/vendor/lightweight-charts.standalone.production.js"),
          ],
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
