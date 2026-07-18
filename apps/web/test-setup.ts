/**
 * apps/web/test-setup.ts
 *
 * Phase 55-1: bun:test preload for React Testing Library + happy-dom.
 *
 * This file is loaded before every test via `bun test --preload ./test-setup.ts`.
 * It sets up:
 *   1. The happy-dom polyfill (window, document, navigator, etc.) so
 *      React + lightweight-charts can mount in a Node environment.
 *   2. A global afterEach hook that calls `@testing-library/react`'s
 *      `cleanup()` so each test gets a fresh DOM.
 *
 * The preload is per-test-file (bun runs each `.test.ts(x)` in a
 * fresh module context), so the imports are local — they don't
 * need to be hoisted to a global `setup-globals.d.ts` shim.
 *
 * Why happy-dom, not jsdom:
 *   - happy-dom is ~3× faster to bootstrap than jsdom (Bun's docs
 *     recommend it for the same reason).
 *   - The React 19 + lightweight-charts components we test don't
 *     rely on jsdom-specific behavior (e.g. `requestAnimationFrame`
 *     fallbacks, `structuredClone` polyfills). happy-dom covers the
 *     surface we need.
 *   - happy-dom's license is MIT and it has no transitive native
 *     deps, so the install footprint is small.
 */

import { Window } from "happy-dom";

// ---------------------------------------------------------------------------
// 1. Polyfill global DOM with happy-dom
// ---------------------------------------------------------------------------

const happyWindow = new Window({ url: "http://localhost" });

// Spread the DOM globals onto `globalThis` so React + RTL can find
// them. We do this in an explicit list (rather than `Object.assign`)
// to avoid leaking non-DOM symbols (e.g. happy-dom's `Symbol.dispose`)
// into the test environment.
const DOM_GLOBALS = [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLDivElement",
  "HTMLCanvasElement",
  "getComputedStyle",
  "ResizeObserver",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "Node",
  "Element",
  "Event",
  "CustomEvent",
  "MessageEvent",
  "Text",
  "DocumentFragment",
] as const;

for (const key of DOM_GLOBALS) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, security/detect-object-injection -- index comes from a closed allowlist above
  const value = (happyWindow as any)[key];
  if (value !== undefined) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, security/detect-object-injection -- key is a closed allowlist above
    (globalThis as any)[key] = value;
  }
}

// `window` and `globalThis` need to be the same object for React's
// concurrent rendering + the bundle's `if (typeof window !== "undefined")`
// checks. We do this last so the spread above doesn't get clobbered.
globalThis.window = happyWindow;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).document = happyWindow.document;

// ---------------------------------------------------------------------------
// 2. RTL cleanup hook
// ---------------------------------------------------------------------------

const { afterEach } = await import("bun:test");
const { cleanup } = await import("@testing-library/react");

afterEach(() => {
  cleanup();
});
