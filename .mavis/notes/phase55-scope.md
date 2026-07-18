# Phase 55 — Close the e2e coverage gap to 80% (user mandate)

**Date:** 2026-07-18
**Status:** SCOPED (not started)
**Trigger:** User mandate 2026-07-18 11:44 Budapest — "e2e = 80%, unit test = 100%"

## Current state (post-Phase 54, measured on main)

| Metric | Actual | 80% mandate | Gap |
|--------|--------|-------------|-----|
| Lines | 70.76% | 80% | **-9.24pp** |
| Branches | 55.08% | 80% | **-24.92pp** |
| Functions | 64.48% | 80% | **-15.52pp** |

The user is right that 95% is not achievable. 80% is the realistic target.

## Why Phase 54 alone wasn't enough

Per the memory entry "Per-file refactor pattern is NOT e2e-coverage-positive":
- Refactors moved branches OUT of e2e coverage (inline code) and INTO unit coverage (extracted helpers)
- The 53C-* tests already covered most of the React flow
- The remaining gap is STRUCTURAL: 3-WS React 19 useEffect ordering, markersByKey hardcoded-to-{}, SSR fallbacks in browser-only code

## Phase 55 scope (in priority order)

### 1. Add React Testing Library for component-level tests (+10-15pp lines)

The current `apps/web/` stack has zero `@testing-library/react` setup. With RTL:
- Mount components in jsdom
- Render ChartCard with various props (resolveHeight, markersAreVisible, etc.)
- Render App.tsx with mocked useWebSocket
- Each component gets +5-10pp lines from RTL tests

```bash
cd apps/web && bun add -d @testing-library/react @testing-library/dom
# Add to vitest.config.ts: environment: "jsdom"
# New test files:
#   - src/components/__tests__/ChartCard.test.tsx (~30 tests)
#   - src/components/__tests__/ControlBar.test.tsx (~10 tests)
#   - src/components/__tests__/ChartGrid.test.tsx (~15 tests)
#   - src/components/__tests__/PositionsTable.test.tsx (~10 tests)
#   - src/App.test.tsx (~20 tests)
```

### 2. Add e2e tests for the 3-WS architecture branches (+5-10pp branches)

The dashboard has 3 `useWebSocket()` consumers (App, ControlBar, PositionsTable). The current 53C-* tests only exercise the App's WS. Add:
- ControlBar's WS reconnect path (separate from App's)
- PositionsTable's WS reconnect path
- The 3-Ws close-handler branches in each

```ts
// apps/web/e2e/55-3ws-coverage.spec.ts
test("55-01: ControlBar's WS — close + reconnect, no App WS interference");
test("55-02: PositionsTable's WS — close + reconnect");
test("55-03: All 3 WSes — coordinated close, all 3 reconnect");
```

### 3. Wire markersByKey to the snapshot (+3pp)

`apps/web/src/App.tsx:markersByKey = {{}}` is hardcoded empty. The 49C marker pipeline is wired but App.tsx doesn't read it. Fix:

```ts
// In App.tsx, replace hardcoded `markersByKey={{}}` with:
const markersByKey = useMemo(() => extractMarkersByKey(snapshot), [snapshot]);
```

The `extractMarkersByKey` helper follows the same pattern as `extractBarsByKey` (already in App.tsx, 100% unit-tested). Once markers are populated, the existing ChartCard markers legend branch is reachable, adding 3-5 branches to the global e2e count.

### 4. Add SSR fallbacks tests via vitest jsdom (+2-5pp lines)

`apps/web/src/components/ChartCard.tsx:readTheme` has a `if (typeof document === "undefined")` SSR fallback that's never hit (Vite is SPA, no SSR). The branch is `/* istanbul ignore next */` which REDUCES the denominator. With vitest jsdom:
- Test the SSR fallback by temporarily deleting `document`
- OR add a new file `apps/web/src/components/__tests__/chart-card-ssr.test.ts` that mocks `typeof document === "undefined"` and asserts the fallback colors

### 5. Wire the indicator registry into ChartCard (+5-10pp)

The Phase 49 indicator pipeline (donchian, funding, cascade, signals) is wired but ChartCard doesn't render the indicators. Phase 48E was parked. To close the gap:
- Add `indicators` and `markers` props to ChartCard
- Render the indicators via the registry
- Add e2e tests that drive the dashboard with indicator snapshots

This is the biggest single change but also the most impactful (+10pp lines).

### 6. Additional refactors + e2e tests

For each remaining uncovered branch in the lcov:
- Identify the React flow that exercises it
- Add an e2e test that drives the flow
- OR extract the logic to a pure helper + add a unit test + add an e2e test that drives the helper

## Estimated timeline

- 55-1 (RTL setup): 30-45 min
- 55-2 (3-WS e2e): 20-30 min
- 55-3 (markersByKey): 15-20 min
- 55-4 (SSR tests): 10-15 min
- 55-5 (indicator wiring): 45-60 min
- 55-6 (catch-all): 30-60 min

**Total: 2.5-4 hours** of work to close the gap from 70.76% to ~85-90% lines, ~75-80% branches, ~85-90% functions.

## The honest verdict

The 80% target requires ~10pp more lines, ~25pp more branches, ~15pp more functions. The branches gap is the biggest challenge due to:
- 3-WS React 19 useEffect ordering creates unreachable branches
- Vite is SPA (no SSR), so the SSR fallbacks are dead code
- markersByKey is hardcoded-to-{} (Phase 49+ scope, parked)

If branches can't reach 80% via the planned work, the realistic options are:
1. Add `/* istanbul ignore next */` to genuinely unreachable branches (with documentation)
2. Add @testing-library/react for component-level unit tests (these don't show up in e2e coverage but add to overall test coverage)
3. Refactor more code into pure helpers (but this doesn't help e2e branches, only unit)

## What NOT to do

- **DO NOT lower the threshold to make CI pass.** That's the cheat the user called out. The CI must enforce the 80% mandate. If the actual is below 80%, CI MUST fail.
- **DO NOT add fake tests** (e.g. trivial assertions that don't exercise code) to inflate coverage. Coverage must reflect actual code execution.
- **DO NOT skip the e2e suite** to make tests pass. All 33 e2e tests must run on every CI.
- **DO NOT silence the branch counter** by adding `/* istanbul ignore next */` to legitimately-tested branches. The ignore is only for genuinely-unreachable code (e.g. SSR fallbacks in Vite SPA).
