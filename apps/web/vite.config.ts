import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import istanbul from "vite-plugin-istanbul";
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
//
// Phase 48D: the `vite-plugin-istanbul` coverage instrumentation is
// gated on `VITE_COVERAGE === "true"`. When this env var is set, the
// production build is instrumented for Istanbul line+branch coverage,
// and `window.__coverage__` is exposed at runtime. The Playwright
// config (`playwright.config.ts`) sets the env var before invoking
// `vite build` and reads the coverage back via `page.evaluate` after
// each test, then merges it via `nyc report` for the lcov + html
// report. Setting `VITE_COVERAGE=false` (or omitting it entirely)
// produces an un-instrumented production build for non-CI workflows.
//
// Phase 58.5 (REVISED 2026-07-19): the CT lane now uses
// `vite-plugin-istanbul` directly via Playwright's `ctViteConfig.plugins`
// (see `playwright-ct.config.ts`). The CT's source-map alignment
// with the e2e production build is critical for the merge step —
// and `babel-plugin-istanbul` (via React's babel option) produced
// DIFFERENT source-map line offsets than the istanbul plugin's
// e2e instrumentation, breaking the merge. Removed the babel
// instrumentation. The CT now uses ONLY `vite-plugin-istanbul`
// (configured in `playwright-ct.config.ts` `ctViteConfig.plugins`).
//
// Phase 60: added `babel: { retainLines: true }` to the React
// plugin. This is the fix for
// https://github.com/vitejs/vite-plugin-react/issues/235 — babel
// re-arranges JSX across multiple lines (one statement per JSX
// child) by default, which makes the `__source` line numbers
// that `vite-plugin-istanbul` reads WRONG, so coverage
// attribution points to a different line than the source line
// the test actually executed. `retainLines: true` keeps each
// generated babel output on the same line as the source. PR
// #246 added this option to the React plugin; we set it in BOTH
// the prod build (here) and the CT dev server (see
// `playwright-ct.config.ts`) so source-map line numbers match
// across the two lanes. The "DEV ONLY" warning in the PR
// description refers to HMR debug ergonomics, not coverage —
// for coverage we want consistent line numbers in BOTH dev
// (CT) and prod (e2e).
export default defineConfig(() => {
  const isCoverage = process.env.VITE_COVERAGE === "true";
  return {
    plugins: [
      react({
        babel: {
          retainLines: true,
        },
      }),
      ...(isCoverage
        ? [
            istanbul({
              include: ["src/**/*"],
              exclude: [
                "node_modules",
                "**/__tests__/**",
                "**/__mocks__/**",
                "**/*.test.*",
                "**/*.spec.*",
                "**/*.d.ts",
                "e2e/**",
                "e2e-ct/**",
                "e2e/mocks/**",
              ],
              extension: [".ts", ".tsx"],
              requireEnv: true,
              forceBuildInstrument: true,
            }),
          ]
        : []),
    ],
    base: "/",
    build: {
      outDir: "dist",
      sourcemap: true,
      // Phase 48D: don't minify the instrumented build. Esbuild
      // strips the `__cov_*` calls (sees them as side-effect-free
      // function calls) which means `window.__coverage__` is never
      // populated at runtime. The coverage build is ~700KB
      // unminified vs ~300KB minified — acceptable for the e2e
      // pipeline. The non-coverage production build is unaffected
      // (minification is only disabled when VITE_COVERAGE=true).
      minify: process.env.VITE_COVERAGE !== "true",
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
      // Phase 58.5: enable sourcemap in the dev server so the CT
      // coverage data has correct line numbers (the cov_ functions
      // need accurate source-line attribution for the merge with
      // the e2e production build).
      sourcemap: true,
    },
    preview: {
      // Phase 48D: pin the preview port to 7913 — the same loopback
      // port the production web-client (`apps/bot/src/web-client`)
      // serves on, and the port the e2e tests in this package
      // connect to. Pinning prevents port drift between the local
      // `bun run preview` and the `bun run e2e` workflows.
      port: 7913,
      strictPort: true,
    },
    resolve: {
      alias: {
        "@mm-crypto-bot/core": resolve(
          __dirname,
          "../../packages/core/src/index.ts",
        ),
      },
    },
  };
});
