# Testing

The monorepo has three test layers.

## 1. Server unit / integration tests (Vitest)

Every server package (`apps/bot`, `packages/*`) has its own `*.test.ts` files co-located with the source. Run individually per package or all at once:

```bash
bun run test                # minden csomag, Vitest
```

## 2. Server coverage (100% per-package OWN gate)

The user mandate is **7/7 server packages at 100% line coverage on their OWN `src/` files**. The CI gate is enforced by `scripts/coverage-per-package.sh`:

```bash
bun run coverage             # lcov-ot generál minden csomagra
bun run coverage:per-package # 7/7 OWN 100% threshold check (CI gate)
bun run coverage:merge       # egyesített lcov (informational)
bun run coverage:report      # egyesített summary
bun run coverage:html        # HTML riport (coverage/merged/html/)
bun run coverage:enforce     # = coverage:per-package
bun run coverage:full        # MINDEN: tesztek (no cache) + lcov + EGY nagy táblázat
```

The `apps/web` package is **intentionally exempt** from the 100% per-package gate — its test surface is the Playwright e2e suite (see below), not Vitest.

### Coverage garancia

A user mandátuma: **7/7 server packages 100% line coverage a saját `src/` fájljaira** (per-package OWN). A CI ezt gate-ként futtatja:

```
$ bun run coverage:per-package
======================================================================
  Per-package OWN coverage (standard lcov --remove + 100% line check)
======================================================================

  ✓ apps/bot                       100.0%  (own src/)
  ✓ packages/paper                 100.0%  (own src/)
  ✓ packages/exchange              100.0%  (own src/)
  ✓ packages/core                  100.0%  (own src/)
  ✓ packages/shared                100.0%  (own src/)
  ✓ packages/backtest              100.0%  (own src/)
  ✓ packages/backtest-tools        100.0%  (own src/)

Result: 7/7 PASS
```

Az egyesített (cross-package importokat is tartalmazó) lefedettség jelenleg **51.2%** — ez a 100%-hoz 50+ új tesztfájlt igényelne (multi-week scope, nem része ennek a mandátumnak).

A `apps/web` package saját lefedettsége a **Playwright e2e suite-ből** jön (`apps/web/coverage/playwright/`), nem a Vitest-ből. A 80% gate (lines/branches/functions) a CI `e2e:playwright` job-ban fut, és a `nyc check-coverage` enforce-eli. A coverage tábla a run summary-ban is megjelenik (`$GITHUB_STEP_SUMMARY` az `apps/web/scripts/coverage-summary-md.mjs` segítségével).

## 3. Web e2e tests (Playwright + MSW)

`apps/web/e2e/dashboard.spec.ts` runs against a coverage-instrumented production build served via `vite preview` on `127.0.0.1:7913` (the same loopback port the production web-client uses). MSW intercepts fetch and WebSocket in the browser so the test exercises the real app code with deterministic mock data.

```bash
cd apps/web
bun run e2e                 # Playwright + MSW (fast path)
bun run e2e:full            # Playwright + MSW + nyc coverage report (30-min cap)
bun run e2e:headed          # headed mode (debug)
```

The e2e suite enforces **80% lines / 80% branches / 80% functions** on `apps/web/src/**` via `nyc check-coverage` (lowered from the original 95/90/95 baseline after the 80% design target was met). The CI uploads the coverage report and the Playwright HTML report as artifacts, and prints the coverage table to the run summary (`$GITHUB_STEP_SUMMARY`).
