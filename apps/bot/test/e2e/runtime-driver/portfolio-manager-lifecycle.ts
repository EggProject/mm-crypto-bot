import type { Logger } from "@mm-crypto-bot/logging";

import { assertCondition } from "./runtime-driver-core.js";
import {
  makePortfolioSymbol,
  makePortfolioMarketMeta,
  makeRemotePosition,
  firstOrder,
  FailOnceCancelFeed,
  FaultFeed,
  LifecycleFeed,
  FailOnceLifecycleFeed,
  makePortfolioStack,
  makeExecution,
} from "./runtime-driver-portfolio-fixtures.js";

async function runPortfolioManagerLifecycle(): Promise<void> {
  const symbol = makePortfolioSymbol();
  const feed = new LifecycleFeed();
  const stack = await makePortfolioStack({ feed, terminalCloseEvidenceLimit: 1 });
  await stack.orderManager.startLifecycle();
  try {
    for (const side of ["long", "short"] as const) {
      const position = stack.positionManager.openPosition(side, symbol, side, 0.01, 60_000, 10, 1);
      assertCondition(
        !(await stack.portfolioManager.requestPositionClose(position, `close-${side}`)),
        `${side} close settled before lifecycle fill`,
      );
      const order = feed.placedOrders.at(-1);
      if (order === undefined) throw new Error(`missing ${side} lifecycle close order`);
      feed.emitLifecycle({ kind: "order", payload: { ...order, status: "open", filled: 0 } });
      feed.emitLifecycle({ kind: "execution", payload: makeExecution(order, `execution-${side}`, 0.01) });
      assertCondition(
        stack.positionManager.getPositions().every((item) => item.id !== position.id),
        `${side} lifecycle fill retained position`,
      );
      feed.emitLifecycle({
        kind: "execution",
        payload: makeExecution(order, `execution-${side}-late`, 0.01),
      });
      feed.emitLifecycle({
        kind: "execution",
        payload: makeExecution(order, `execution-${side}-late`, 0.01),
      });
    }

    const missing = stack.positionManager.openPosition("missing", symbol, "long", 0.01, 60_000, 10, 1);
    await stack.portfolioManager.requestPositionClose(missing, "missing");
    const missingOrder = feed.placedOrders.at(-1);
    if (missingOrder === undefined) throw new Error("missing-position order was not scripted");
    stack.positionManager.reconcileVenueAbsent(missing.id);
    feed.emitLifecycle({
      kind: "execution",
      payload: makeExecution(missingOrder, "execution-missing", 0.01),
    });

    const orderPosition = stack.positionManager.openPosition(
      "order-event",
      symbol,
      "long",
      0.01,
      60_000,
      10,
      1,
    );
    await stack.portfolioManager.requestPositionClose(orderPosition, "order-event");
    const orderUpdate = feed.placedOrders.at(-1);
    if (orderUpdate === undefined) throw new Error("order-event close was not scripted");
    feed.emitLifecycle({
      kind: "order",
      payload: {
        ...orderUpdate,
        status: "closed",
        filled: 0.01,
        average: 59_900,
        updateTimestamp: undefined,
      },
    });
    assertCondition(
      stack.positionManager.getPositions().every((item) => item.id !== orderPosition.id),
      "closed order event retained position",
    );

    const latePosition = stack.positionManager.openPosition("late", symbol, "long", 0.01, 60_000, 10, 1);
    await stack.portfolioManager.requestPositionClose(latePosition, "late-first");
    const cancelledOrder = feed.placedOrders.at(-1);
    if (cancelledOrder === undefined) throw new Error("late close was not scripted");
    feed.emitLifecycle({ kind: "order", payload: { ...cancelledOrder, status: "canceled", filled: 0 } });
    await stack.portfolioManager.requestPositionClose(latePosition, "late-retry");
    const replacement = feed.placedOrders.at(-1);
    if (replacement === undefined) throw new Error("replacement close was not scripted");
    feed.emitLifecycle({
      kind: "order",
      payload: {
        ...cancelledOrder,
        status: "closed",
        filled: 0.004,
        average: 59_850,
        updateTimestamp: undefined,
      },
    });
    await Promise.resolve();
    assertCondition(
      stack.positionManager.getPositions().find((item) => item.id === latePosition.id)?.quantity === 0.006,
      "late fill remainder mismatch",
    );
    assertCondition(
      feed.getOrder(replacement.clientOrderId)?.status === "canceled",
      "late fill did not cancel replacement",
    );

    const noReplacementPosition = stack.positionManager.openPosition(
      "no-replacement",
      symbol,
      "long",
      0.01,
      60_000,
      10,
      1,
    );
    await stack.portfolioManager.requestPositionClose(noReplacementPosition, "no-replacement");
    const noReplacementOrder = feed.placedOrders.at(-1);
    if (noReplacementOrder === undefined) throw new Error("no-replacement close was not scripted");
    feed.emitLifecycle({ kind: "order", payload: { ...noReplacementOrder, status: "canceled", filled: 0 } });
    feed.emitLifecycle({
      kind: "execution",
      payload: makeExecution(noReplacementOrder, "late-without-replacement", 0.004),
    });
  } finally {
    await stack.orderManager.stopLifecycle();
    await feed.close();
  }

  const errorLog: string[] = [];
  const errorLogger: Logger = {
    critical: (message) => {
      errorLog.push(message);
    },
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- This E2E logger double intentionally discards non-observable records.
    debug: () => {},
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- This E2E logger double intentionally discards non-observable records.
    info: () => {},
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- This E2E logger double intentionally discards non-observable records.
    warn: () => {},
    error: (message) => {
      errorLog.push(message);
    },
  };
  const failFeed = new FailOnceLifecycleFeed();
  const failStack = await makePortfolioStack({ feed: failFeed, logger: errorLogger });
  await failStack.orderManager.startLifecycle();
  try {
    const position = failStack.positionManager.openPosition(
      "cancel-fault",
      symbol,
      "long",
      0.01,
      60_000,
      10,
      1,
    );
    await failStack.portfolioManager.requestPositionClose(position, "cancel-first");
    const cancelledOrder = failFeed.placedOrders.at(-1);
    if (cancelledOrder === undefined) throw new Error("cancel-fault order was not scripted");
    failFeed.emitLifecycle({ kind: "order", payload: { ...cancelledOrder, status: "canceled", filled: 0 } });
    await failStack.portfolioManager.requestPositionClose(position, "cancel-retry");
    failFeed.emitLifecycle({
      kind: "execution",
      payload: makeExecution(cancelledOrder, "late-cancel-fault", 0.004),
    });
    await Bun.sleep(0);
    assertCondition(
      errorLog.includes("portfolio.close.replacement.cancel.failed"),
      "late replacement cancel failure was not logged",
    );
  } finally {
    await failStack.orderManager.stopLifecycle();
    await failFeed.close();
  }

  const reconcileFeed = new FaultFeed();
  const reconcile = await makePortfolioStack({ feed: reconcileFeed });
  const pending = reconcile.positionManager.openPosition("reconcile", symbol, "long", 0.01, 60_000, 10, 1);
  assertCondition(
    !(await reconcile.portfolioManager.requestPositionClose(pending, "first")),
    "open close unexpectedly settled",
  );
  assertCondition(
    !(await reconcile.portfolioManager.requestPositionClose(pending, "still-open")),
    "open reconciliation unexpectedly settled",
  );
  const pendingOrder = firstOrder(reconcileFeed.placedOrders, "reconcile close");
  reconcileFeed.setOrderStatus(pendingOrder.clientOrderId, {
    status: "canceled",
    filled: 0.004,
    average: undefined,
    price: undefined,
    updateTimestamp: undefined,
  });
  assertCondition(
    !(await reconcile.portfolioManager.requestPositionClose(pending, "partial-retry")),
    "partial REST close unexpectedly settled",
  );
  const replacementOrder = reconcileFeed.placedOrders.at(-1);
  if (replacementOrder === undefined) throw new Error("partial REST replacement was not scripted");
  reconcileFeed.setOrderStatus(replacementOrder.clientOrderId, {
    status: "closed",
    filled: 0.006,
    average: undefined,
    price: undefined,
    updateTimestamp: undefined,
  });
  const remaining = reconcile.positionManager.getPositions()[0];
  if (remaining === undefined) throw new Error("partial REST close lost remaining position");
  assertCondition(
    await reconcile.portfolioManager.requestPositionClose(remaining, "final-reconcile"),
    "REST-reconciled close did not settle",
  );
  await reconcileFeed.close();

  const cancelFeed = new FailOnceCancelFeed();
  const cancelStack = await makePortfolioStack({ feed: cancelFeed });
  await cancelStack.orderManager.placeOrder({
    signal: { side: "buy", confidence: 1, reason: "pending-entry", stopLoss: 0, takeProfit: 0 },
    symbol,
    amount: 0.01,
    referencePrice: 60_000,
    type: "market",
  });
  const failedCancel = await cancelStack.portfolioManager.executeCloseAll();
  assertCondition(
    failedCancel.unresolved.some((entry) => entry.startsWith("cancel ")),
    "cancel failure was not reported",
  );
  const successfulCancel = await cancelStack.portfolioManager.executeCloseAll();
  assertCondition(
    successfulCancel.cancelledOrders.length === 1,
    "successful retry cancellation was not reported",
  );

  for (const failure of [new Error("close Error"), "close string"] as const) {
    const pendingFeed = new FaultFeed();
    const pendingStack = await makePortfolioStack({ feed: pendingFeed });
    const pendingPosition = pendingStack.positionManager.openPosition(
      "pending",
      symbol,
      "long",
      0.01,
      60_000,
      10,
      1,
    );
    await pendingStack.portfolioManager.requestPositionClose(pendingPosition, "first");
    pendingFeed.orderFailures.push(failure);
    assertCondition(
      !(await pendingStack.portfolioManager.requestPositionClose(pendingPosition, "retry")),
      "failed reconciliation settled close",
    );

    const placeFeed = new FaultFeed();
    placeFeed.placeFailures.push(failure);
    const placeStack = await makePortfolioStack({ feed: placeFeed });
    const fresh = placeStack.positionManager.openPosition("fresh", symbol, "long", 0.01, 60_000, 10, 1);
    assertCondition(
      !(await placeStack.portfolioManager.requestPositionClose(fresh, "first")),
      "failed placement settled close",
    );
  }

  const attributionFeed = new LifecycleFeed({
    positions: [makeRemotePosition("long", 0.01)],
    marketMeta: new Map([[symbol, makePortfolioMarketMeta(false)]]),
  });
  const attribution = await makePortfolioStack({
    feed: attributionFeed,
    requireAuthoritativeEmergencyState: true,
    configuredSymbols: [symbol],
  });
  await attribution.orderManager.startLifecycle();
  try {
    attribution.positionManager.openPosition("first", symbol, "long", 0.01, 60_000, 10, 1);
    attribution.positionManager.openPosition("second", symbol, "long", 0.01, 60_000, 10, 1);
    await attribution.portfolioManager.executeCloseAll();
    const venueOrder = attributionFeed.placedOrders.find((order) => order.side === "sell");
    if (venueOrder === undefined) throw new Error("authoritative attribution order was not scripted");
    attributionFeed.emitLifecycle({
      kind: "execution",
      payload: makeExecution(venueOrder, "attribution-exhaustion", 0.01),
    });
    assertCondition(
      attribution.positionManager.getPositionCount() === 1,
      "attribution did not stop at venue quantity",
    );
  } finally {
    await attribution.orderManager.stopLifecycle();
    await attributionFeed.close();
  }
}

export { runPortfolioManagerLifecycle };
