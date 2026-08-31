### §8.7 Branch state

```
feat/phase25-2-impl at c0aabf3 (8 commits ahead of main)
  5dfe232 feat(phase25-2-t4): cross-venue funding-divergence signal-pool feed (Track C regime indicator)
  9426b8e feat(phase25-2-t1): dYdX v4 Indexer client + Tardis.dev backtest validation (Track B empirical check)
  5a8e61f feat(phase25-2-t3): liquidation cascade detector (3-layer filter, paper-trade mode, Track D satellite)
  e35f140 fix(phase25-2-t1-t3): kill-switch refactor — DayBucket + per-provider cross-confirm + 5-layer risk gates
  dd26b13 fix(phase25-2-t3): bug fixes — findEventBySymbol + cascade-replay replay typecheck
  54e8600 feat(phase25-2-t3): 2025-10-10 cascade replay result — Layer 3 fires, Track D §5 band PASS
  9f5c037 fix(phase25-2-t3): enforce cascade gates and replay validation
  c0aabf3 feat(phase25-2-t2): dYdX-vs-CEX cross-venue funding carry (live integration, BTC-only)
```

8 commits, 5,420 insertions, 6 deletions (excluding the 9 large backtest JSONs which are themselves 27,493 lines of equity-curve data).

---

## §9. Honest caveats and what would change my mind

### §9.1 Track B caveats

- **Tardis sparse data:** Free tier only allows first-of-month CSV downloads. Each quarter's backtest uses 3 days of dYdX data (one per month). The intra-month days are linearly interpolated by the carry simulation; this understates real intraday volatility. Paid Tardis API would give full daily coverage (~$50–100/mo).
- **Cost model not yet applied to T1 backtest:** Gross carry is reported. Subtract ~2.5%/mo for fees + slippage + rebalance to get net. The research's 7–8% net annualized = ~0.6–0.7%/mo matches gross +3.3%/mo BTC 2026-Q1 minus 2.5%/mo cost.
- **CEX venue assumption:** Backtest uses Binance 8h funding. bybit.eu is SPOT-only (no perps), so the hedge leg must be on Binance/Bybit Global/OKX. Different venues may have slightly different 8h averages (typically <5 bps apart on majors).
- **Q1 2026 SOL inversion** is a T1 novel finding, not a refutation of the research (Track B focused on BTC+ETH).

### §9.2 Track D caveats

- **Curupira sub-5min ETH fade-scalper** is a live forward test, not a 5-year backtest. Anomiq.io full-year backtest of naked mean-reversion on extreme deviations was flat-to-negative after costs. The cascade filter (CoinGlass + Bitquery + Axel Adler OI/ELR) is the mitigation, but until we run 30+ days of paper-trade + 1-year historical backtest with 30bps cost, the +0.5–1.5%/mo realistic is a forward-looking estimate, not a proven number.
- **2022-05 Terra/LUNA and 2022-11 FTX cascades** did not mean-revert. The 10-min timed exit + 5%/7d rolling kill-switch is the regime-change detector, but it's untested on a true regime-change event.
- **$500k–$1M notional** assumes bybit.eu SPOT market share holds at ~7%. If it falls below 5%, capacity halves and expected alpha drops to +0.3–0.8%/mo.

### §9.3 What would change the verdict to FAIL

- Track B downgrade to NO-GO if: live divergence <0.0005/8h for 7 consecutive days during paper-trade Week 2; or dYdX v4 chain incidents occur 2+ times in 30 days; or Track B backtest on Tardis paid tier shows <3% net annualized carry.
- Track D downgrade to NO-GO if: paper-trade Week 3-4 P&L is negative after 30bps cost assumption; or CoinGlass historical backtest shows <0bps net edge at $500k size; or 2 consecutive cascade trades fail to mean-revert within 10-min window during paper-trade.
- Phase 25 #2 cancellation if: combined paper-trade Week 4 P&L is <+0.3%/mo incremental. **Currently NOT triggered** (combined +2.15–2.65%/mo is 7.2–8.8× the floor).

### §9.4 What would change the verdict to full PASS

- Track B upgrade to PASS if: live divergence ≥ 0.0005/8h × 7d paper-trade window; or Tardis paid tier backtest shows ≥5% net annualized carry (would re-widen to full $250k/leg spec sizing).
- Track D upgrade to PASS if: 3+ backtested cascades show >100bps net edge at $1M notional; or reliable cross-venue leader feed (Binance perp → bybit.eu spot) reduces execution slippage to <15bps (would enable $2M+ sizing).
- Combined full PASS if: 30+ days of live paper-trade show combined P&L ≥ +0.3%/mo with positive Sharpe, AND both Track B and Track D hit their per-track success criteria.

---

_End of REPORT-phase25-2.md. All artifacts on branch `feat/phase25-2-impl` (commits 5dfe232, 9426b8e, 5a8e61f, e35f140, dd26b13, 54e8600, 9f5c037, c0aabf3). Combined PR #58 retitled to "Phase 25 #2 — Perp-DEX Funding Microstructure Implementation (Track B + Track D + Track C)"._
