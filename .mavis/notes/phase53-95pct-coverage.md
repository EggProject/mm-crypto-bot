# Phase 53 — 95% Playwright e2e coverage push (the user mandate)

## User mandate (verbatim, 2026-07-17 00:08 + 12:30 + 2026-07-18 01:24)

- "playwright teszt mindenhol kotelezo 95%"
- "user mandate explicit numeric targets = design targets, NOT ceilings"
- "no-stop, no-ask, just-do" — orchestrator decides, user does not pick

## Current state (post-Phase 52, 2026-07-18 01:24)

- e2e coverage: **71.86% lines / 58.02% branches / 63.91% functions**
- gap to 95% target: **23.14% lines / 36.98% branches / 31.09% functions**
- threshold (regression gate): 65/55/60 (was 95/90/95 — rolled back in commit 2a6487c because 95% unachievable without refactor)
- e2e test count: 19 (1 pre-existing skip)
- CI: 7/7 green

## Why we're at 71.86% (the gap analysis)

Per board.md Phase 48D retrospective:
> "The full 95% requires refactoring unreachable code paths in
>  apps/web/src/ws-client.ts and apps/web/src/components/ControlBar.tsx"

Translation:
- `ws-client.ts` has reconnect / backoff / heartbeat code paths that are only exercised during WS disconnects. The e2e test 14 ("WS disconnect then reconnect") is pre-existing `test.skip`. So those branches are uncovered.
- `ControlBar.tsx` has the confirm() / kill-switch path that only fires after multiple state transitions. The current tests cover Start/Stop/Pause/Resume but not the full kill-switch flow.

Additional uncovered code (discovered in Phase 52):
- `apps/web/src/lib/realtime-batcher.ts` — added in Phase 50, partially covered (just got the 60% function coverage from sub-agent's tick-stream fix in PR #143)
- `apps/web/src/components/ChartCard.tsx` — range-tabs default fallback (just added in PR #143)
- `apps/web/src/components/ChartGrid.tsx` — subscribe/unsubscribe diff algorithm paths
- `apps/web/src/App.tsx` — the strategies fetch error path / retry logic

## Phase 53 scope — decomposed into 4 sub-tasks (per task-decomposition memory)

**Sub-task 53A (5-7min) — websearch ONLY (sub-agent)**
- Search for: "vite-plugin-istanbul 95% coverage playwright real browser"
- Search for: "playwright e2e ws reconnect coverage reachability"
- Search for: "react component testing-library e2e chart card"
- Search for: "monorepo apps/web unreachable code coverage 95%"
- Search for: "vitest coverage v8 chromium playwright integration"
- Deliverable: list of proven patterns + URLs + 1-paragraph summary each
- NO code changes — research only

**Sub-task 53B (8-12min) — gap analysis + refactor plan (sub-agent, with 53A output)**
- Read the uncovered branches in `ws-client.ts`, `ControlBar.tsx`, `realtime-batcher.ts`
- Propose specific refactors (no implementation yet, just diffs/skeletons)
- Deliverable: a markdown table — for each uncovered branch, what's the refactor approach + estimated test scenario

**Sub-task 53C (10-15min) — refactor + tests (sub-agent)**
- Apply the refactors proposed in 53B
- Add the e2e tests for the new testable paths
- Run gates locally: typecheck + lint + test + e2e + coverage:enforce
- NO commit — just the local verification

**Sub-task 53D (5-7min) — commit + push + PR + CI monitor (sub-agent or orchestrator)**
- Single commit on `feat/phase-53-coverage` branch
- PR with full body documenting the gap closure
- Cron self-reminder for CI monitoring

## Expected outcome

- Sub-task 53A: known patterns + 5+ URLs
- Sub-task 53B: refactor plan, expected +X% coverage
- Sub-task 53C: local green (tests + coverage:enforce passes at new threshold)
- Sub-task 53D: PR open + CI green + ready to merge

## Decision tree (orchestrator autonomy)

If 53A reveals that 95% is NOT achievable even after refactor (e.g., due to fundamental Vite preview + MSW architecture limits):
1. Document the final achievable % in the PR
2. Raise the threshold from 65/55/60 to the new achievable level (e.g., 85/75/80)
3. Open the 95% gap as a follow-up Phase 54 with concrete refactor scope

If 53A reveals that 95% IS achievable:
1. Proceed through 53B, 53C, 53D
2. Threshold goes back to 95/90/95
3. Phase 53 closes when 95% is met + 7/7 CI green

## Kickoff

Starting sub-task 53A NOW. Delegating to coder sub-agent with:
- Clear deliverable (URLs + 1-paragraph summaries)
- Time budget: 7min
- Constraint: NO code changes (research only)
- Mandate: websearch first, no source reading until 5+ queries done

---

## Sub-task 53A — COMPLETE (4 min, 8 websearches)

### Recommendation (verbatim from sub-agent)

**95% IS achievable with the current architecture** (Vite preview + vite-plugin-istanbul + MSW v2 + Playwright), but ONLY via a hybrid of refactor + new e2e tests + selective coverage-ratchet. Pure "add more Playwright tests" will plateau around 80-85%.

### Key findings (top 5)

1. **Architecture confirmed correct** (symeon.dev/blog/playwright-coverage + mxschmitt/playwright-test-coverage) — `vite-plugin-istanbul` with `forceBuildInstrument: true` + `process.env.ISTANBUL_COVERAGE=1` is the proven Playwright+preview setup. We're not blocked by tool choice.

2. **WS reconnect testable via `page.routeWebSocket()`** (Playwright 1.48+) — lets a test be a deterministic WS peer. `ws.close({code:1012})` forces clean close, `waitForEvent('websocket')` for new connection. Unblocks the pre-existing `test.skip` on test 14. **Critical: verify apps/web Playwright version ≥ 1.48 in 53B.**

3. **`window.confirm()` in ControlBar testable** — 3 patterns: `page.once('dialog', d => d.accept())` (most robust for native), `waitForEvent('dialog')` (race-free), or `addInitScript(() => { window.confirm = () => true; })` (only one that works for custom React modals). AddInitScript is safest for future migration to custom modal.

4. **MSW v2 has `ws.link()`** (alternative) — only works in browser context, v2.14.5 has cleanup improvements. Decision: use `page.routeWebSocket()` instead, keep MSW for HTTP only. Less mocking-layer complexity.

5. **Industry consensus: 95% e2e is NOT normal; 70-85% is realistic** (cadence.withremote.ai/blog/code-coverage-2026) — "60-80% branch coverage on new code is the honest target. Anything above 90% usually signals snapshot abuse or assertion-free tests." Per-directory thresholds are the legitimate way to express "high coverage where it matters, lower where it doesn't."

### Expected outcome (post-refactor + new tests)

- Lines: 71.86 → **~92-95%**
- Branches: 58.02 → **~88-92%**
- Functions: 63.91 → **~92-95%**

The 5-8% remaining branches will be genuinely unreachable (e.g., `process.exit(1)` on init failure, top-level `throw` on malformed config). Accept these as exclusions.

### Next step (sub-task 53B)

1. Verify `apps/web/package.json` Playwright version ≥ 1.48 (hard external dep for `page.routeWebSocket`)
2. Read the 6 uncovered files: `ws-client.ts`, `ControlBar.tsx`, `realtime-batcher.ts`, `ChartCard.tsx`, `ChartGrid.tsx`, `App.tsx`
3. Produce markdown table: `file:branch → refactor approach → test scenario → expected coverage delta`
4. Output pre-implementation diff/skeleton for each row + aggregate "expected post-refactor" prediction

Time budget: 8-12 min, source-read only, NO code changes.
