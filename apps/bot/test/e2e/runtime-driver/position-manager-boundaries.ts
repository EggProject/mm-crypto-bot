import { asSymbol } from "@mm-crypto-bot/exchange";

import { PositionManager } from "../../../src/bot/position-manager.js";
import { assertCondition, expectFailure, RecordingLogger } from "./runtime-driver-core.js";

function manager(maxPositions = 3): PositionManager {
  return new PositionManager({
    initialEquityUsd: 10_000,
    maxPositions,
    maxLeverage: 10,
    logger: new RecordingLogger(),
  });
}

export function runPositionManagerBoundaries(): void {
  const symbol = asSymbol("BTC/USDC");
  expectFailure(
    () =>
      new PositionManager({
        initialEquityUsd: 0,
        maxPositions: 3,
        maxLeverage: 10,
        logger: new RecordingLogger(),
      }),
    "zero equity",
  );
  expectFailure(
    () =>
      new PositionManager({
        initialEquityUsd: 10_000,
        maxPositions: 0,
        maxLeverage: 10,
        logger: new RecordingLogger(),
      }),
    "zero cap",
  );
  expectFailure(
    () =>
      new PositionManager({
        initialEquityUsd: 10_000,
        maxPositions: 3,
        maxLeverage: 11,
        logger: new RecordingLogger(),
      }),
    "invalid cap leverage",
  );

  const caps = manager(2);
  caps.openPosition("a", symbol, "long", 0.01, 60_000, 1);
  caps.openPosition("b", asSymbol("ETH/USDC"), "long", 0.01, 3000, 1);
  expectFailure(() => caps.openPosition("c", asSymbol("SOL/USDC"), "long", 0.1, 150, 1), "max positions");
  expectFailure(() => manager().openPosition("a", symbol, "long", 1, 100, 11), "invalid position leverage");
  expectFailure(() => manager().openPosition("a", symbol, "long", 0, 100, 1), "zero quantity");
  expectFailure(() => manager().openPosition("a", symbol, "long", 1, 0, 1), "zero price");
  const duplicateOpen = manager();
  duplicateOpen.openPosition("duplicate", symbol, "long", 1, 100, 1);
  duplicateOpen.openPosition("duplicate", symbol, "long", 1, 120, 1);
  assertCondition(
    duplicateOpen.getPosition("duplicate", symbol, "long")?.entryPrice === 110,
    "duplicate open did not reuse the same-side fill path",
  );

  const fills = manager();
  fills.recordFill({
    strategy: "fill",
    symbol,
    side: "long",
    quantity: 1,
    price: 100,
    leverage: 1,
    timestamp: 1,
  });
  fills.recordFill({
    strategy: "fill",
    symbol,
    side: "long",
    quantity: 1,
    price: 120,
    leverage: 1,
    timestamp: 2,
  });
  assertCondition(
    fills.getPosition("fill", symbol, "long")?.entryPrice === 110,
    "same-side fill did not average entry",
  );
  fills.recordFill({
    strategy: "fill",
    symbol,
    side: "short",
    quantity: 0.5,
    price: 130,
    leverage: 1,
    timestamp: 3,
  });
  assertCondition(
    fills.getPosition("fill", symbol, "long")?.quantity === 1.5,
    "opposite partial fill did not reduce exposure",
  );
  fills.recordFill({
    strategy: "fill",
    symbol,
    side: "short",
    quantity: 1.5,
    price: 90,
    leverage: 1,
    timestamp: 4,
  });
  assertCondition(fills.getPositionCount() === 0, "opposite terminal fill did not close exposure");
  assertCondition(fills.getClosedTrades().length === 1, "opposite terminal fill did not retain closed trade");
  const excessiveOppositeFill = manager();
  excessiveOppositeFill.openPosition("excessive", symbol, "long", 1, 100, 1);
  expectFailure(
    () =>
      excessiveOppositeFill.recordFill({
        strategy: "excessive",
        symbol,
        side: "short",
        quantity: 2,
        price: 100,
        leverage: 1,
        timestamp: 1,
      }),
    "opposite fill exceeding the position",
  );

  const updates = manager();
  updates.openPosition("update", symbol, "long", 1, 100, 1);
  updates.updateMarketPrice(symbol, 120);
  assertCondition(
    updates.getPosition("update", symbol, "long")?.unrealizedPnl === 20,
    "market update lost unrealized PnL",
  );
  updates.updateMarketPrice(symbol, 0);
  assertCondition(
    updates.getPosition("update", symbol, "long")?.currentPrice === 120,
    "invalid price changed the position",
  );
  updates.updateMarketPrice(asSymbol("ETH/USDC"), 150);
  assertCondition(
    updates.getPosition("update", symbol, "long")?.currentPrice === 120,
    "unmatched market update changed another position",
  );
  assertCondition(updates.closePosition("update", symbol, 130, 10) === 30, "close PnL was incorrect");
  expectFailure(() => updates.closePosition("update", symbol, 130), "missing position close");

  const restored = manager(1);
  restored.restorePosition({
    strategy: "restore",
    symbol,
    side: "long",
    quantity: 1,
    entryPrice: 100,
    currentPrice: 95,
    leverage: 10,
    unrealizedPnl: -5,
    realizedPnl: 0,
    openedAt: 1,
    notionalUsd: 100,
  });
  restored.recordFill({
    strategy: "restore",
    symbol,
    side: "long",
    quantity: 1,
    price: 110,
    leverage: 10,
    timestamp: 2,
  });
  assertCondition(
    restored.getPositionCount() === 1,
    "same-side restored fill bypassed the position identity",
  );
  const closedTradeHistory = Array.from({ length: 1001 }, (_, index) => ({
    strategy: "restore-history",
    symbol,
    side: "long",
    quantity: 1,
    entryPrice: 100,
    exitPrice: 110,
    pnl: 10,
    pnlPct: 10,
    closedAt: index,
  })) satisfies Parameters<PositionManager["restoreClosedTrades"]>[0];
  restored.restoreClosedTrades(closedTradeHistory);
  assertCondition(
    restored.getClosedTrades().length === 1000 && restored.getClosedTrades().at(0)?.closedAt === 1,
    "restored closed-trade history did not retain the newest bounded history",
  );
  expectFailure(
    () =>
      restored.restorePosition({
        strategy: "bad",
        symbol,
        side: "long",
        quantity: 0,
        entryPrice: 100,
        currentPrice: 100,
        leverage: 10,
        unrealizedPnl: 0,
        realizedPnl: 0,
        openedAt: 1,
        notionalUsd: 0,
      }),
    "invalid restored quantity",
  );
  for (const [entryPrice, leverage, label] of [
    [0, 10, "invalid restored entry price"],
    [100, 11, "invalid restored leverage"],
  ] as const) {
    expectFailure(
      () =>
        restored.restorePosition({
          strategy: "bad-restore",
          symbol,
          side: "long",
          quantity: 1,
          entryPrice,
          currentPrice: 100,
          leverage,
          unrealizedPnl: 0,
          realizedPnl: 0,
          openedAt: 1,
          notionalUsd: 100,
        }),
      label,
    );
  }
  restored.restoreRealizedPnl(250);
  assertCondition(restored.getRealizedPnl() === 250, "realized PnL restore failed");
  restored.restoreRealizedPnl(260);
  assertCondition(
    restored.getRealizedPnl() === 260 && restored.getEquity() === 10_270,
    "explicit realized PnL overwrite did not update the public equity aggregate",
  );
  assertCondition(!restored.reconcileVenueAbsent("missing"), "missing venue position was reconciled");
  const position = restored.getPositions().at(0);
  if (position === undefined) throw new Error("expected restored position");
  assertCondition(restored.reconcileVenueAbsent(position.id), "venue position was not quarantined");
  assertCondition(
    restored.getPosition("restore", symbol, "long") === undefined,
    "quarantined venue position remained publicly available",
  );

  const exhausted = manager(2);
  exhausted.openPosition("loss", symbol, "long", 900, 100, 1);
  exhausted.openPosition("remaining", asSymbol("ETH/USDC"), "long", 100, 100, 1);
  exhausted.closePosition("loss", symbol, 1);
  expectFailure(
    () =>
      exhausted.recordFill({
        strategy: "remaining",
        symbol: asSymbol("ETH/USDC"),
        side: "long",
        quantity: 0.01,
        price: 100,
        leverage: 1,
        timestamp: 1,
      }),
    "exhausted equity aggregate leverage",
  );

  const leverageLogger = new RecordingLogger();
  const leverageRejected = new PositionManager({
    initialEquityUsd: 10_000,
    maxPositions: 3,
    maxLeverage: 10,
    logger: leverageLogger,
  });
  expectFailure(
    () => leverageRejected.openPosition("breach", symbol, "long", 1001, 100, 1),
    "opening aggregate leverage breach",
  );
  assertCondition(
    leverageLogger.entries.some((entry) => entry.message === "position.leverage.open.rejected"),
    "leverage breach was not logged through the public logger",
  );

  const aggregateLogger = new RecordingLogger();
  const aggregateRejected = new PositionManager({
    initialEquityUsd: 10_000,
    maxPositions: 3,
    maxLeverage: 10,
    logger: aggregateLogger,
  });
  aggregateRejected.openPosition("aggregate", symbol, "long", 1000, 100, 1);
  expectFailure(
    () =>
      aggregateRejected.recordFill({
        strategy: "aggregate",
        symbol,
        side: "long",
        quantity: 1,
        price: 100,
        leverage: 1,
        timestamp: 2,
      }),
    "same-side aggregate leverage breach",
  );
  assertCondition(
    aggregateLogger.entries.some((entry) => entry.message === "position.leverage.aggregate.breached"),
    "same-side aggregate leverage breach was not logged",
  );
  leverageRejected.setRiskManager(undefined);
  leverageRejected.updateMarketPrice(symbol, 100);
  assertCondition(
    leverageRejected.getMaxPositions() === 3 && leverageRejected.getMaxLeverage() === 10,
    "public position limits changed after an absent risk manager",
  );
}
