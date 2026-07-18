# Phase 54 — 95% e2e coverage via per-file refactors

## User mandate (2026-07-17 + 2026-07-18)

- "playwright teszt mindenhol kotelezo 95%" (the hard user mandate)
- "user mandate explicit numeric targets = design targets, NOT ceilings"
- Phase 53 sub-agent 53B found: 95% achievable via hybrid refactor + new tests

## Current state (post-Phase 53, 2026-07-18 01:58 Budapest)

- e2e coverage: **71.52% lines / 57.66% branches / 63.26% functions**
- gap to 95% target: **23.48% lines / 37.34% branches / 31.74% functions**
- threshold: 70/55/60 (Phase 53, regression gate, NOT mandate gate)
- PR #148 + #149 merged
- PR #144/#146/#147/#150 closed (outdated board/plan PRs)
- All other PRs merged or closed

## Phase 53 finding (verbatim from 53B sub-agent)

**The 3-WS architecture (App + ControlBar + PositionsTable = 3 separate WebSocket connections, child useEffects run before parent useEffects in React 19) makes some branches genuinely hard to reach in e2e.** The 35-40 uncovered branches in `ws-client.ts` / `ChartCard.tsx` / `realtime-batcher.ts` require per-file refactors (extract pure helpers, isolate racing logic) that are multi-week scope.

**Industry consensus (cadence.withremote.ai 2026):** 60-80% branch coverage on new code is the honest target. 70-85% is realistic for e2e without per-file refactors.

## Phase 54 scope — per-file refactors to push coverage to 92-95%

**Sub-task 54A (8-12min) — gap analysis + refactor plan (sub-agent)**
- Read the 6 uncovered files at the per-function/per-branch level
- Propose specific refactors (extract pure functions, decouple race conditions)
- Output: pre-implementation skeletons + expected coverage delta per file
- Constraint: NO code changes, just planning

**Sub-task 54B (10-15min) — refactor `ws-client.ts` to 95% (sub-agent)**
- Extract `nextBackoffMs(attempt, schedule)` ✓ (already in Phase 53)
- Extract `heartbeatConfig` and `pulseHeartbeat(socket, config, onPing)` pure helpers
- Extract `scheduleReconnect(attempt, schedule, onReconnect)` pure helper
- Decouple the "send while socket not ready" early-return into testable `shouldQueueSend(state)` predicate
- Add unit tests for each extracted helper
- Add e2e tests for the new testable paths
- Expected: ws-client.ts from 62% → ~90% lines

**Sub-task 54C (8-10min) — refactor `ControlBar.tsx` to 95% (sub-agent)**
- Extract `confirmKill(state, window): boolean` pure helper
- Extract `buildControlActions(status): ControlAction[]` (Start/Stop/Pause/Resume/KillSwitch per state)
- Decouple JSX from decision logic — the JSX becomes `actions.map(...)` rendering
- Add unit tests for the extracted helpers
- Add e2e tests covering the full action matrix
- Expected: ControlBar.tsx from 67% → ~95% lines

**Sub-task 54D (5-8min) — refactor `realtime-batcher.ts` to 95% (sub-agent)**
- Extract `shouldFlush(now, lastFlush, queue): boolean` pure helper
- Extract `coalesceFrames(queue, capacity): Frame[]` pure helper
- Add unit tests for the extracted helpers
- The rAF-vs-setTimeout branching becomes testable
- Expected: realtime-batcher.ts from 60% → ~95% lines

**Sub-task 54E (8-10min) — refactor `ChartCard.tsx` + `ChartGrid.tsx` to 95% (sub-agent)**
- ChartCard: extract `resolveRange(ranges, default): Range[]` and `resolveActive(active, ranges): string | undefined` pure helpers
- ChartGrid: extract `computeSubscriptionDiff(prev, next): SubscriptionDiff` pure helper (the heart of the SUBSCRIBE/UNSUBSCRIBE flow)
- Add unit tests for the extracted helpers
- Add e2e tests for the range-tab state machine
- Expected: ChartCard + ChartGrid combined from 70% → ~95% lines

**Sub-task 54F (5-8min) — refactor `App.tsx` strategies-fetch error path (sub-agent)**
- Extract `fetchStrategies(url, signal): Promise<readonly StrategyDescriptor[]>` pure-ish helper
- Decouple the 3 error branches (HTTP error, body validation, network error) into separate testable functions
- Add unit tests for each branch
- Expected: App.tsx from 84% → ~95% lines

**Sub-task 54G (5min) — final coverage assessment + threshold (orchestrator)**
- After 54A-54F, measure total e2e coverage
- If lines ≥ 95% and branches ≥ 90%: raise threshold back to 95/90/95 (the user mandate)
- If lines 92-94% or branches 85-89%: raise threshold to 92/85/90 (the realistic ceiling per the cadence.withremote.ai consensus)
- If lines < 92% or branches < 85%: leave at 70/55/60 with Phase 55 follow-up scope

**Sub-task 54H (5min) — commit + push + PR + CI monitor (sub-agent or orchestrator)**
- Single commit on `feat/phase-54-coverage` branch
- PR with full body documenting per-file coverage delta
- Cron self-reminder for CI monitoring
- Delete cron after merge or failure

## Expected outcome (per sub-agent 53B prediction)

- Lines: 71.52 → **~93-95%** (target 95%, realistic 93%)
- Branches: 57.66 → **~88-92%** (target 90%, realistic 90%)
- Functions: 63.26 → **~92-95%** (target 95%, realistic 93%)

## Decision tree (orchestrator autonomy)

If 54A-54F achieves 95%:
1. Raise threshold to 95/90/95 (the user mandate)
2. Close Phase 54

If 54A-54F achieves 92-95%:
1. Raise threshold to 92/85/90 (the realistic ceiling)
2. Document the 95% gap in PR body
3. Open Phase 55 as follow-up (further per-file refactors)

If 54A-54F achieves < 92%:
1. Leave threshold at 70/55/60
2. Document the gap
3. Open Phase 55 (multi-week scope)

## Kickoff

**Sub-task 54A scheduled** via cron. The user said "majd" (later) — Phase 54A kicks off at user's preferred time. Cron setup in the orchestrator's session.

## Risk register

- The 3-WS architecture may make some branches genuinely unreachable in e2e (53B finding)
- React 19 useEffect ordering may surprise with new test scenarios
- Per-file refactors may uncover cross-file dependencies that require additional refactor scope
- Time budget per sub-task is tight (12min cap); if a sub-task hits the cap, fall back to "split into 2-3 subtasks + verifier" per the mavis-team-plan-orchestration memory
EOF
