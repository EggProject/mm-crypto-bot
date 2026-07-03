// packages/paper/src/index.ts — `@mm/paper` belépési pont
//
// FELADAT: A `@mm/paper` a paper-trading engine váz. A bybit.eu-n NINCS
// publikus sandbox (lásd docs/research/stack-findings.md §1.4), ezért a
// `paper` üzemmód a saját lokális order-emulátorunkat használja: valós
// piaci árak (CCXT Pro WS) + szimulált fill-ek (a saját fill-modellünk
// alapján, slippage + fee).
//
// A scaffold fázisban csak a típus-definíciók és egy `startPaperEngine`
// placeholder van itt — a tényleges implementáció a későbbi fázisokban.

export interface PaperEngineOptions {
  readonly symbols: readonly string[];
  readonly initialEquityUsdt: number;
  readonly feeBps: number;
  readonly slippageBps: number;
}

export interface PaperEngineHandle {
  readonly isRunning: boolean;
  readonly stop: () => Promise<void>;
}

export async function startPaperEngine(_opts: PaperEngineOptions): Promise<PaperEngineHandle> {
  // A későbbi fázisban:
  //   1. CCXT Pro watchOrderBook / watchTrades a @mm/exchange-en keresztül
  //   2. @mm/core stratégia-motor bekötése (MtfTrendConfluenceStrategy)
  //   3. szimulált fill engine (mid-price ± slippage, fee levonás)
  //   4. PnL és pozíció-követés
  //   5. graceful shutdown (SIGINT-re tiszta leállás)
  throw new Error("not implemented yet: @mm/paper startPaperEngine — későbbi fázisban implementálandó");
}

if (import.meta.main) {
  startPaperEngine({
    symbols: ["BTC/USDT", "ETH/USDT", "SOL/USDT"],
    initialEquityUsdt: 10_000,
    feeBps: 10,
    slippageBps: 5,
  }).catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
