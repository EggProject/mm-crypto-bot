---
description: Phase 13 scope plan — multi-symbol portfolio orchestrator + signal-center decision engine + cross-symbol hedge plugins. Builds on Phase 12 read-only plugin set + Phase 11.1/11.2 defensive+alpha set. User directive 2026-07-06 00:12 Budapest: "Jelenlegi kodot ugy atalakitani hogy az osszes eddig megirt strategiat a signal kozpont moge rejtjuk + BTC/ETH/SOL egyszerre + uj hedge strategiak + backtest 5% risk / 10x lev / 7 maxpos + 100% test coverage".
---

# Phase 13 — Multi-symbol portfolio orchestrator + decision engine + cross-symbol hedges

**Date opened:** 2026-07-06 00:15 Budapest
**Owner:** Mavis (root session `mvs_c13fe65cb68f4df3851304dea09a9099`)
**Builds on:** main @ `b8dca1e` (Phase 12 runner patch) → squash-merge of PR #26 (runner risk args) + Phase 12 final commit `a21f9c4`

---

## User mandate (verbatim, 2026-07-06 00:12 Budapest)

1. "Jelenlegi kodot ugy atalakitani hogy az osszes eddig megirt strategiat a signal kozpont moge rejtjuk es amikor jelezz akkor sulyozassal vagy mas megoldassal dontjuk el hogy torodunk-e vele vagy ha 2 signal jelezz stb..."
   - **Decode:** refactor all 16 monolith strategies + 9 existing plugins behind a single SignalCenterV1 with smart arbitration (weighted vote, conflict resolution, 2+ signals = ???).
2. "Ugy alakitsuk at a kodot hogy a btc,eth,sol -on egyszerre kereskedjen"
   - **Decode:** multi-symbol simultaneous — PortfolioOrchestrator runs BTC + ETH + SOL together.
3. "nezd meg hogy van-e hedge vagy vedekezo strategiank? ha nincs akkor epitsunk be parat az 1-es lepesben irt signal kozpontba"
   - **Decode:** audit hedge/defensive strategies, build new ones if missing — must live behind the Decision Engine from step 1.
4. "alap beallitasok ezzel felul irva: backtest + binance + risk per trade: 5% + max leverage: 10 + max positions: 7 -val futtasd a vegen ami elkeszul"
   - **Decode:** final backtest = binance data, 5% risk/trade, 10x leverage, 7 max positions. Window = last 1y (project default).
5. "ne felejtsd el unit test coverage 100% az elvaras"
   - **Decode:** 100% line + branch coverage on NEW code (Phase 12 lcov.info discipline).

---

## Current state (verified, not assumed)

| Réteg | Van | Hiányzik |
|---|---|---|
| Plugin registry | 9 plugin (`packages/core/src/signal-center/plugins/`) | — |
| Signal bus | `SignalBus.subscribe(kind, fn)` — fan-out | **Decision Engine** (ki nyer ha 2 plugin ellentéteset mond) |
| Risk engine | `PortfolioRiskEngine` per-symbol | **Portfolio Orchestrator** (cross-symbol) |
| Multi-symbol | Minden SCv1 instance 1 symbol | **BTC + ETH + SOL egyszerre** |
| Hedge | `FundingCarry` delta-neutral (long-spot + short-perp, **per-symbol**) | **Cross-symbol** (BTC long vs ETH short, spread, momentum overlay) |
| Defensive | RegimeDetector, PerpDexLiquidation, SOLFlipKS | ✅ OK (per-symbol, de aggregálható orchestrator-on keresztül) |
| Monolith strategies | 16 db `packages/core/src/strategy/` | **Mind a 16 SCv1 plugin wrapper mögé** |
| Test coverage | `bun test --coverage` core-on | 100% threshold enforcement az új fájlokon |

---

## Architecture (4 layers, my recommendation)

```
┌─────────────────────────────────────────────────────────────────┐
│ Layer 4 — PortfolioOrchestrator (NEW)                          │
│  - N× SignalCenterV1 instances (BTC + ETH + SOL)              │
│  - N× DecisionEngine (per-symbol)                              │
│  - 1× PortfolioAggregator (cross-symbol VaR, concentration)    │
│  - 1× EquityCurve (portfolio-level)                            │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
   DecisionEngine       DecisionEngine        DecisionEngine
   (BTC)                (ETH)                 (SOL)
        │                     │                     │
        ▼                     ▼                     ▼
   SignalCenterV1        SignalCenterV1        SignalCenterV1
   (BTC)                (ETH)                 (SOL)
        │                     │                     │
        ▼                     ▼                     ▼
   9 baseline + cross-symbol plugins (P1/E1/M1 read-only + 3 NEW hedges)
```

**Decision Engine arbitration rules (my proposal, agent-default):**
- Each plugin has a weight (default 1.0; defensive plugins weight 2.0)
- Conflict resolution:
  - All agree → execute with weighted average size
  - 2+ directional signals agree, 1+ risk signal disagrees → execute with `min(sizeMultiplier) × risk_penalty`
  - Directional conflict (long vs short) → defer to higher weighted sum OR if tied → flat
  - Risk signal (sizeModifier < 1.0) → always wins, applies to all
  - Read-only (P1/E1/M1) → factor only, never vetoes

**Cross-symbol hedge plugins (3 NEW):**
| Plugin | Edge class | Logic |
|---|---|---|
| `CrossSymbolSpreadReversion` | directional | BTC-ETH log-spread z-score: z>2 short spread, z<-2 long spread (mean reversion) |
| `CrossSymbolMomentumOverlay` | directional | BTC+ETH both long when BTC 20d momentum >0, both flat when <0 |
| `CrossSymbolFundingDifferential` | carry | Long-spot higher funding symbol + short-spot lower funding symbol → cross-neutral |

---

## Team plan structure (4 tracks, parallel where possible)

```yaml
plan: phase13-portfolio-orchestrator
tracks:
  A — Decision Engine + 16 monolith wrappers:
    type: coder
    scope: |
      1. packages/core/src/signal-center/decision-engine.ts (NEW)
         - StrategyPlugin arbitration layer
         - PositionDecision output
         - Weighted vote + conflict matrix
         - Never exhaustiveness on SignalKind
      2. packages/core/src/signal-center/monolith-wrappers/ (16 NEW files)
         - Wrap each strategy/*.ts as StrategyPlugin (no behavior change)
         - Same factory pattern as CarryBaselinePlugin
    dependencies: []
    timeout: 60min
    verify: verifier (100% coverage + Decision Engine tests ≥25)

  B — Portfolio Orchestrator:
    type: coder
    scope: |
      1. packages/core/src/portfolio/portfolio-orchestrator.ts (NEW)
         - N× SignalCenterV1 (BTC + ETH + SOL)
         - Cross-symbol position aggregation
         - maxPositions global cap (default 7, configurable)
         - Per-symbol concentration cap (40%)
         - Cross-symbol VaR cap (15% portfolio)
         - PortfolioEquityCurve
    dependencies: [A]  # needs Decision Engine
    timeout: 60min
    verify: verifier (100% coverage + ≥25 tests)

  C — 3 cross-symbol hedge plugins:
    type: coder
    scope: |
      1. packages/core/src/signal-center/plugins/cross-symbol-spread-reversion-plugin.ts (NEW)
      2. packages/core/src/signal-center/plugins/cross-symbol-momentum-overlay-plugin.ts (NEW)
      3. packages/core/src/signal-center/plugins/cross-symbol-funding-differential-plugin.ts (NEW)
      Each: StrategyPlugin interface, ≥20 unit tests, 100% coverage
    dependencies: []
    timeout: 60min
    verify: verifier (independent for each, 100% coverage)

  D — Portfolio orchestrator runner + REPORT:
    type: coder
    scope: |
      1. packages/backtest-tools/src/cli/run-portfolio-orchestrator.ts (NEW)
         - BTC + ETH + SOL simultaneous
         - binance data, 5% risk, 10x leverage, 7 max positions, 1y window
         - Per-symbol + portfolio-level envelope output
      2. docs/research/REPORT-phase13.md (NEW)
         - Architecture, decision-log examples, envelope table, hedge validation
    dependencies: [A, B, C]
    timeout: 45min
    verify: verifier (5 envelope JSONs + REPORT + 100% coverage)
```

**Track dependencies:** A → B (sequential), C (independent), D (last, depends on A+B+C)

**Optimal parallelism:** A + C parallel (5-7 days work, parallel = 3-4 days), then B (1-2 days), then D (1 day)

---

## Coverage enforcement (Phase 12 lcov.info discipline)

- Bun's built-in coverage (`bun test --coverage`) outputs `coverage/lcov.info`
- Verifier reads lcov.info directly (NOT producer summary)
- Required threshold: **100% lines AND 100% branches** on NEW files in `packages/core/src/signal-center/decision-engine.ts` + `packages/core/src/portfolio/` + 3 cross-symbol plugins + 16 wrappers
- CI threshold: enforce via existing turbo pipeline OR add new turbo task `coverage-threshold` that fails if < 100%
- Existing 9 plugins: 100% coverage maintained (Phase 12 achieved this; do not regress)

---

## Final backtest command (Track D deliverable)

```bash
bun run packages/backtest-tools/src/cli/run-portfolio-orchestrator.ts \
  --symbols=BTC/USDT,ETH/USDT,SOL/USDT \
  --exchange=binance \
  --window-days=365 \
  --risk-per-trade=0.05 \
  --max-leverage=10 \
  --max-positions=7 \
  --output-dir=backtest-results/portfolio-orchestrator
```

Expected output:
- `backtest-results/portfolio-orchestrator/portfolio-envelope-{btc,eth,sol}.json` (per-symbol)
- `backtest-results/portfolio-orchestrator/portfolio-envelope-combined.json` (portfolio-level)
- Decision log: `backtest-results/portfolio-orchestrator/decision-log.jsonl` (one line per arbiter call)
- `docs/research/REPORT-phase13.md`

---

## Memory + doctrine compliance

- **1:10 leverage MANDATORY** on all trades (project-wide, retroactive). Each new plugin must declare `maxLeverage: 10` + 3-layer defense (constructor + subscribe + per-emit).
- **Research doctrine OVERRIDE active** — but Phase 13 is CODE work (not research), doctrine applies to any external source citations in REPORT-phase13.md.
- **Citation laundering guard** — if REPORT-phase13.md cites Phase 11.4 envelope numbers, verify leverage multiplier matches (Phase 11.4 was at 1:10, OK to cite).
- **Per-symbol PARTIAL PASS** — if a cross-symbol hedge works for BTC+ETH but fails for SOL, document per-symbol composition disclosure.
- **Verifier-mandate conflict pattern** — user mandate here is "5% risk + 10x lev + 7 maxpos", overrides project default (1% risk + 3 maxpos). Producer MUST apply user spec literally; verifier must NOT flag as fabrication.

---

## Open decisions / blockers

None. User said "go" with my Option A recommendation (team plan). Proceeding with launch.

---

## Success criteria (Phase 13 closed when)

- [ ] Decision Engine implemented, ≥25 unit tests, 100% coverage
- [ ] 16 monolith strategies wrapped as SCv1 plugins, each with unit test, 100% coverage
- [ ] Portfolio Orchestrator implemented, BTC+ETH+SOL simultaneous, ≥25 unit tests, 100% coverage
- [ ] 3 cross-symbol hedge plugins implemented, ≥20 tests each, 100% coverage
- [ ] Final backtest ran with 5%/10x/7maxpos/1y/binance, output envelope JSONs + REPORT-phase13.md
- [ ] All 4 tracks merged to main via squash-merge (no orphan branches)
- [ ] CI green: lint + typecheck + test + coverage (100% new) + build
- [ ] board.md updated with Phase 13 closure + envelope table

---

## Failure handling (per memory)

- Cycle 1 FAIL → `manual_retry` with 5-8 step correction spec ("DO NOT REWRITE" emphasis)
- Cycle 2 FAIL on mechanical only → owner-self-push + `override_accept`
- Cycle 2 FAIL on substantive → `manual_retry` again with tighter spec
- Cycle 3 FAIL → owner escalate to user, NO loop
- Producer timeout mid-task with ≥50% code on disk → `manual_retry` NOT `override`
- Stale-retry verification: if disk state shows work complete + pushed + green, do NOT re-spawn producer

---

## Cron schedule

- After plan launch: `phase13-monitor` at 5min cadence, 12h TTL (until 2026-07-06 12:15 Budapest)
- Gate discipline: only act on state change; silent stand-down on skip ticks
- Delete cron on plan completion