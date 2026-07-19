/**
 * playwright/index.ts — the Playwright CT harness.
 *
 * The CT runner mounts individual components via @playwright/experimental-ct-react.
 * This file is the entry point for the CT's own HTML page.
 *
 * For coverage to be collected, the mounted component must run
 * inside the same JS context as the istanbul-instrumented production
 * code. The CT mounts the component directly, so it doesn't
 * share the production page's JS context — meaning the istanbul
 * save hooks in the production code never fire.
 *
 * The CT coverage is collected via the `installCtCoverageHooks`
 * helper which reads `window.__coverage__` from the CT page.
 * If the page doesn't have the istanbul instrumentation, the
 * accumulator stays empty — which is a known limitation we
 * accept for now and document in phase58-scope.md.
 */
import "../src/main.tsx";
