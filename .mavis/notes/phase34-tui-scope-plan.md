---
description: Phase 34 scope plan — Ink-based TUI integration into mm-bot CLI. Updated 2026-07-12 02:15 Budapest.
---

# Phase 34 — TUI integration (Ink) + headless mode (scope plan)

## User mandate (2026-07-12 02:00 Budapest)

Two corrections to the original spec, captured in the user's reply:

1. **TUI is mandatory** — was in original spec §4.3 (we shipped plain-text CLI only in Phase 33 Track D; the TUI requirement was missed).
2. **Both modes required** — `mm-bot start` (TUI + bot) AND `mm-bot start --headless` (plain text + bot) AND `mm-bot tui` (TUI only, no bot).
3. **Color toggle** — default ON, `--no-color` to disable (especially for headless / piped output).

### Original spec §4.3 (the one we missed)

```
4.3 Modern TUI (terminál) felület (kötelező)

Amikor elindítom, egy modern terminál (TUI) felület jelenjen meg.

Alap elvárások:

- a robot megállítható,
- a robot elindítható,
- a TUI felület elindítható úgy is, hogy a robot NEM indul el (csak a felület jön fel),
- statisztikai menü,
- jelenlegi kereskedés figyelése — valós idejű (realtime) értékfrissítéssel,
- history (előzmények).
```

## State of `@mm-crypto-bot/tui` (pre-Phase 34)

A TUI skeleton already exists on main (1939 LOC) but is **not wired** to the bot CLI:

| File | LOC | Purpose |
|------|-----|---------|
| `App.tsx` | 154 | Root component (keybindings, layout) |
| `render.tsx` | 30 | Ink render entry-point |
| `index.tsx` | 150 | Standalone `bun run` entry (works in isolation) |
| `components/Header.tsx` | 81 | Top bar (mode, equity, P&L) |
| `components/StatusBar.tsx` | 53 | Bottom bar (keybinding hints) |
| `components/StatisticsPanel.tsx` | 103 | Stats menu (win-rate, Sharpe, drawdown) |
| `components/LiveTradingPanel.tsx` | 140 | Realtime positions + tickers |
| `components/HistoryList.tsx` | 113 | Closed trades list |
| `providers/BotStateProvider.ts` | 103 | React context for bot state |
| `providers/PaperProvider.ts` | 215 | Paper-mode data source |
| `providers/SimulatedProvider.ts` | 521 | Mock data source (for TUI-only mode) |
| `hooks/useBotState.ts` | 25 | Subscription hook |
| `utils/format.ts` | 77 | Number/percentage/date formatters |
| `types.ts` | 129 | Shared types |
| `scaffold.test.ts` | 18 | 1 smoke test |

**TUI is NOT a dependency of `apps/bot`** — it's an isolated package. The integration work is the missing piece.

## Phase 34 scope

### Track A — TUI integration into the bot runtime (CORE)

**Deliverable:** when `mm-bot start` runs, the Ink TUI is the default UI; the bot feeds state to the TUI via the `BotStateProvider`.

| Sub-task | Files | Acceptance |
|----------|-------|-----------|
| A.1 Add `@mm-crypto-bot/tui` to `apps/bot/package.json` | `apps/bot/package.json` | `bun install` resolves it |
| A.2 Refactor `Bot` to emit state events (not just persist) | `apps/bot/src/bot/bot.ts` | New `subscribe(listener): unsubscribe` method on Bot |
| A.3 Implement `LiveBotStateProvider` (extends `BotStateProvider` in `packages/tui`) | `apps/bot/src/tui/live-bot-state-provider.ts` | Subscribes to Bot, pushes to TUI React context |
| A.4 Wire TUI render into `start` command when not `--headless` | `apps/bot/src/cli/commands/start.ts` | `mm-bot start` → Ink render; SIGINT cleanly tears down |
| A.5 `mm-bot tui --data-source=paper|simulated` — TUI without bot | `apps/bot/src/cli/commands/tui.ts` | New subcommand; uses SimulatedProvider or PaperProvider |

**Hard guarantees:**
- TUI is the DEFAULT — `mm-bot start` without flags launches Ink
- `--headless` / `--no-tui` → plain text logs (no React/Ink import)
- `--no-color` → strips ANSI color codes (use `picocolors` or chalk's no-color mode)
- TUI events update in realtime (no polling — the Bot emits state changes)
- SIGINT (Ctrl+C) cleanly exits Ink + stops the Bot

### Track B — TUI features completion

The TUI skeleton has 5 components, 3 providers, 1 hook. Coverage of the spec §4.3 checklist:

| Spec requirement | Component | Status |
|------------------|-----------|--------|
| Robot megállítható (stop) | `App.tsx` keybinding → `bot.stop()` | NEEDS WIRE-UP |
| Robot elindítható (start) | `App.tsx` keybinding → `bot.start()` | NEEDS WIRE-UP |
| TUI bot nélkül (only view) | Track A.5 — `mm-bot tui` | NEW |
| Statisztikai menü | `StatisticsPanel.tsx` | EXISTS, needs data |
| Jelenlegi kereskedés realtime | `LiveTradingPanel.tsx` | EXISTS, needs data |
| History | `HistoryList.tsx` | EXISTS, needs data |

**Deliverable:** each spec requirement has a working keybinding + data flow.

### Track C — Color toggle + headless mode polish

| Sub-task | Files | Acceptance |
|----------|-------|-----------|
| C.1 `picocolors` (or `chalk` with `--no-color`) for plain output | `apps/bot/src/cli/commands/*` | Color codes stripped when `--no-color` is set |
| C.2 Color toggle propagates to TUI (Ink respects `NO_COLOR` env var natively) | `apps/bot/src/cli/commands/start.ts` | `NO_COLOR=1 mm-bot start` → no ANSI in TUI |
| C.3 Headless mode logs to file (config.bot.state_file equivalent for logs) | `apps/bot/src/cli/commands/start.ts` | `mm-bot start --headless --log-file=...` |
| C.4 Test: `--headless` does NOT import ink/react (bundle check) | `apps/bot/src/cli/headless-no-ink.test.ts` | Bundle contains no `react` import in headless mode |

### Track D — Tests + wire-up probe (MANDATORY per Phase 21 #1)

| Sub-task | Files | Acceptance |
|----------|-------|-----------|
| D.1 TUI wire-up probe: `mm-bot tui --data-source=simulated` renders 10 ticks without error | `apps/bot/src/tui/wire-up-probe.test.ts` | Snapshot test (ink-testing-library) |
| D.2 Realtime update probe: state change in Bot → TUI re-renders within 100ms | `apps/bot/src/tui/realtime-update-probe.test.ts` | timing assertion |
| D.3 Headless-mode smoke: `mm-bot start --headless` runs 30s with mock feed, exits cleanly | `apps/bot/src/cli/headless-smoke.test.ts` | exit code 0, state file persisted |
| D.4 `mm-bot tui` without bot: subscribes to PaperProvider, renders 30 ticks, no bot state required | `apps/bot/src/tui/paper-only-probe.test.ts` | snapshot test |

### Track E — Docs

| Sub-task | Files |
|----------|-------|
| E.1 Update `apps/bot/README.md` §3 (CLI Reference) with new subcommands: `start --headless`, `tui` | `apps/bot/README.md` |
| E.2 Update `config/default.toml` comments with `--no-color` examples | `apps/bot/config/default.toml` |
| E.3 New file: `docs/production-strategies/tui.md` — TUI keybindings reference | `docs/production-strategies/tui.md` |
| E.4 Update `deliverable.md` — Phase 34 closure section | `deliverable.md` |
| E.5 Update `.mavis/notes/board.md` — Phase 34 closure + original spec §4.3 retroactively marked done | `.mavis/notes/board.md` |

## Quality gates (all tracks)

```bash
cd /Users/kiscsicska/projects/mm-crypto-bot
bun run typecheck
bun run lint
bun test  # all tests, including new TUI probes
bun test --coverage apps/bot  # ≥ 95% line coverage on the bot app
```

## Out of scope (deferred to Phase 35+)

- **Mouse support** in TUI — Ink supports it but the spec doesn't require it
- **Multi-window / split panes** — single-window layout
- **Persistent layout** (user resizing the terminal) — uses Ink's default
- **Plugin system** for TUI panels — overkill
- **Web-based dashboard** — TUI is the user mandate; web is a future ask

## Risks + mitigations

| Risk | Mitigation |
|------|-----------|
| Ink's React 19 + Bun compatibility | Already proven by `packages/tui` smoke test; if breaks, fallback is `tui-kit` (no React) |
| TUI bundle bloat in headless mode | Track C.4 — bundle-check test that headless path doesn't import ink |
| Color codes leak into log files when `NO_COLOR` is not set | Default `log_file` path strips ANSI via `strip-ansi` |
| 1:10 leverage check + TUI show "leverage breach" alert | Wire `KillSwitchRegistry` events into the TUI StatusBar |

## Estimated scope

| Track | Files changed | New LOC | New tests |
|-------|---------------|---------|-----------|
| A — TUI integration | 6 | ~400 | 4 |
| B — Features completion | 5 | ~200 | 3 |
| C — Color + headless | 4 | ~150 | 2 |
| D — Tests + probes | 4 | ~300 | 4 |
| E — Docs | 5 | ~250 | 0 |
| **Total** | **~24** | **~1300** | **13** |

**Single PR**, single squash-merge, with the 5 tracks as commits inside the PR (one PR per user mandate "Mielott tovabb megyunk javitsd ki" — small focused PRs after this).

## Phase 33 closure retro

What we missed in Phase 33:
- **Spec §4.3 (TUI)** — was in the original mandate, the Track D prompt deliberately excluded it (hand-rolled CLI, no Ink). My mistake: I should have flagged the spec gap during Phase 33 scoping, not after delivery.
- **Local test gap** — CI was green but local `bun install` had stale `node_modules` (zod not hoisted). Fixed in the Phase 33 fixup commit.
- **Git cleanup** — merged branches and orphan worktree left behind. Fixed.

Memory entry: **track every original-spec requirement through the entire plan, not just the producer's narrowed scope.** When the producer's prompt is narrower than the spec, FLAG IT BEFORE execution, not after.
