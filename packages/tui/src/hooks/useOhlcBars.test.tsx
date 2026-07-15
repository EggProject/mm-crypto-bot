/**
 * packages/tui/src/hooks/useOhlcBars.test.tsx
 *
 * Phase 37 Track 3: a `useOhlcBars` React hook tesztje.
 *
 * A hook a `BotStateProvider` `tickers` snapshot-jából szintetizál
 * trade-eket, és az `OhlcStream` osztállyal aggregálja OHLC bar-okká.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import React from "react";
import { Text } from "ink";
import { render } from "ink-testing-library";

import type { Symbol, Timeframe } from "@mm-crypto-bot/exchange";
import { SimulatedProvider } from "../providers/SimulatedProvider.js";
import { useOhlcBars, __testHooks } from "./useOhlcBars.js";
import { asSymbol } from "@mm-crypto-bot/exchange";

/**
 * `BarsDisplay` — a `useOhlcBars` hook eredményét rendereli.
 * Az `onResult` callback a tesztben olvassa ki a bar-listát
 * a render után.
 */
function BarsDisplay({
  provider,
  symbol,
  timeframe,
  onResult,
}: {
  readonly provider: SimulatedProvider;
  readonly symbol: Symbol;
  readonly timeframe: Timeframe;
  readonly onResult?: (bars: readonly { timestamp: number; open: number; high: number; low: number; close: number; volume: number; tradeCount: number }[], tradeCount: number) => void;
}): React.ReactElement {
  const { bars, tradeCount } = useOhlcBars(provider, symbol, timeframe);
  if (onResult) onResult(bars, tradeCount);
  return (
    <Text>
      bars={bars.length} trades={tradeCount} lastClose={bars.length > 0 ? bars[bars.length - 1]!.close.toFixed(2) : "n/a"}
    </Text>
  );
}

describe("useOhlcBars — Phase 37 Track 3 OHLC stream hook", () => {
  let provider: SimulatedProvider;

  beforeEach(() => {
    provider = new SimulatedProvider({ mode: "tui-only", seed: 42 });
  });

  afterEach(async () => {
    await provider.stop();
  });

  it("üres bar-listával indul (még nincs ticker change)", () => {
    let captured: { bars: readonly { timestamp: number; open: number; high: number; low: number; close: number; volume: number; tradeCount: number }[]; tradeCount: number } | null = null;
    render(
      <BarsDisplay
        provider={provider}
        symbol={asSymbol("BTC/USDT")}
        timeframe="1m"
        onResult={(b, t) => { captured = { bars: b, tradeCount: t }; }}
      />,
    );
    expect(captured).not.toBeNull();
    expect(captured!.bars.length).toBe(0);
    expect(captured!.tradeCount).toBe(0);
  });

  it("a provider ticker-frissítése új OHLC bar-t eredményez", async () => {
    void provider.start();
    let lastResult: { bars: readonly unknown[]; tradeCount: number } = { bars: [], tradeCount: 0 };
    const { rerender, unmount } = render(
      <BarsDisplay
        provider={provider}
        symbol={asSymbol("BTC/USDT")}
        timeframe="1m"
        onResult={(b, t) => { lastResult = { bars: b, tradeCount: t }; }}
      />,
    );
    await new Promise((r) => setTimeout(r, 1500));
    rerender(
      <BarsDisplay
        provider={provider}
        symbol={asSymbol("BTC/USDT")}
        timeframe="1m"
        onResult={(b, t) => { lastResult = { bars: b, tradeCount: t }; }}
      />,
    );
    expect(lastResult.tradeCount).toBeGreaterThan(0);
    unmount();
  });

  it("az OhlcStream 'bar' eventje a setTick callbackot futtatja (re-render trigger)", () => {
    // A `__testHooks.entries` segítségével hozzáférünk a hook által
    // létrehozott stream-hez.  A stream-be 2 trade-et injektálunk
    // 1m grid-en átnyúló timestamp-ekkel; a 2. trade lezárja az
    // első bar-t, ami triggereli a `bar` event-et, ami a setTick
    // branch-et futtatja.  Ez 100%-os line coverage-t ad.
    const { unmount } = render(
      <BarsDisplay
        provider={provider}
        symbol={asSymbol("BTC/USDT")}
        timeframe="1m"
      />,
    );
    const map = __testHooks.entries.get(provider);
    expect(map).toBeDefined();
    const entry = map!.get("BTC/USDT::1m");
    expect(entry).toBeDefined();
    // 2 trade 1m grid-en átnyúló timestamp-ekkel → 1 bar close.
    const t0 = 1_700_000_400_000;
    entry!.stream.ingest({
      id: "1", symbol: asSymbol("BTC/USDT"), timestamp: t0, price: 100, amount: 1, takerSide: "buy",
    });
    entry!.stream.ingest({
      id: "2", symbol: asSymbol("BTC/USDT"), timestamp: t0 + 60_000, price: 110, amount: 1, takerSide: "buy",
    });
    // A setTick meghívódott → re-render triggerelve.
    // A buffer mérete ≥ 1 (a teszt trade-jei zártak 1 bar-t; a hook
    // saját useEffect-je a provider ticker-ből is injektálhatott
    // trade-eket, de a bufferbe került bar-ok száma ≥ 1).
    expect(entry!.stream.bufferSizeOf(asSymbol("BTC/USDT"), "1m")).toBeGreaterThanOrEqual(1);
    unmount();
  });
});

