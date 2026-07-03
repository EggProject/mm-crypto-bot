// packages/backtest/src/index.ts — `@mm/backtest` belépési pont
//
// FELADAT: A `@mm/backtest` a kiválasztott stratégia historikus adatokon
// történő visszatesztelő motorja. A scaffold fázisban csak a típus-definíciók
// és egy `runBacktest` placeholder van itt; a tényleges implementáció a
// későbbi fázisokban készül (data-loader, position-size, equity curve,
// Sharpe/Sortino/DD metrikák, walk-forward OOS validáció).
//
// Stratégia-részletek: docs/research/selected-strategy.md §5 (backtest metrikák).

export interface BacktestOptions {
  readonly symbol: string;
  readonly startTime: Date;
  readonly endTime: Date;
  readonly initialEquityUsdt: number;
}

export interface BacktestResult {
  readonly totalReturn: number;
  readonly sharpeRatio: number;
  readonly maxDrawdown: number;
  readonly totalTrades: number;
  readonly winRate: number;
}

export async function runBacktest(_opts: BacktestOptions): Promise<BacktestResult> {
  // A későbbi fázisban: historikus adatok betöltése + stratégia végigfuttatása +
  // equity curve számítás + metrikák aggregálása + riport (CSV + JSON).
  throw new Error("not implemented yet: @mm/backtest runBacktest — későbbi fázisban implementálandó");
}

if (import.meta.main) {
  runBacktest({
    symbol: "BTC/USDT",
    startTime: new Date("2026-01-01T00:00:00Z"),
    endTime: new Date("2026-07-01T00:00:00Z"),
    initialEquityUsdt: 10_000,
  }).catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
