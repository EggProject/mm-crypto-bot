import { assertCondition } from "./runtime-driver-core.js";
import {
  makePortfolioSymbol,
  makePortfolioMarketMeta,
  makeRemotePosition,
  firstOrder,
  FaultFeed,
  AutoFlattenFeed,
  makePortfolioStack,
} from "./runtime-driver-portfolio-fixtures.js";

async function runPortfolioManagerAuthoritative(): Promise<void> {
  const symbol = makePortfolioSymbol();
  const derivativeMeta = new Map([[symbol, makePortfolioMarketMeta(false)]]);
  const spotMeta = new Map([[symbol, makePortfolioMarketMeta(true)]]);

  const stale = await makePortfolioStack({
    feed: new FaultFeed({ positions: [], marketMeta: derivativeMeta }),
    requireAuthoritativeEmergencyState: true,
    configuredSymbols: [symbol],
  });
  stale.positionManager.openPosition("stale", symbol, "long", 0.01, 60_000, 10, 1);
  const staleReport = await stale.portfolioManager.executeCloseAll();
  assertCondition(staleReport.unresolved.length === 0, "stale derivative remained unresolved");
  assertCondition(stale.positionManager.getPositionCount() === 0, "stale derivative remained local");

  const spotFeed = new FaultFeed({
    positions: [],
    balances: [
      { currency: "USDC", free: 1_000_000, total: 1_000_000 },
      { currency: "BTC", free: 0.02, total: 0.02 },
    ],
    marketMeta: spotMeta,
  });
  const spot = await makePortfolioStack({
    feed: spotFeed,
    requireAuthoritativeEmergencyState: true,
    configuredSymbols: [symbol],
  });
  const spotReport = await spot.portfolioManager.executeCloseAll();
  assertCondition(
    firstOrder(spotFeed.placedOrders, "spot venue close").amount === 0.02,
    "spot venue quantity mismatch",
  );
  assertCondition(
    spotReport.unresolved.includes("venue/BTC/USDC/spot"),
    "spot venue exposure was not retryable",
  );
  const spotPendingReport = await spot.portfolioManager.executeCloseAll();
  assertCondition(
    spotPendingReport.unresolved.includes("venue/BTC/USDC/spot"),
    "open spot journal did not remain retryable",
  );

  const derivativeFeed = new FaultFeed({
    positions: [makeRemotePosition("long", 0.03)],
    marketMeta: derivativeMeta,
  });
  const derivative = await makePortfolioStack({
    feed: derivativeFeed,
    requireAuthoritativeEmergencyState: true,
    configuredSymbols: [symbol],
  });
  const derivativeReport = await derivative.portfolioManager.executeCloseAll();
  assertCondition(
    firstOrder(derivativeFeed.placedOrders, "derivative venue close").amount === 0.03,
    "derivative venue quantity mismatch",
  );
  assertCondition(
    derivativeReport.unresolved.includes("venue/BTC/USDC/long"),
    "derivative venue exposure was not retryable",
  );
  const derivativePendingReport = await derivative.portfolioManager.executeCloseAll();
  assertCondition(
    derivativePendingReport.unresolved.includes("venue/BTC/USDC/long"),
    "open derivative journal did not remain retryable",
  );

  const autoFeed = new AutoFlattenFeed({
    positions: [makeRemotePosition()],
    marketMeta: derivativeMeta,
  });
  const auto = await makePortfolioStack({
    feed: autoFeed,
    requireAuthoritativeEmergencyState: true,
    configuredSymbols: [symbol],
  });
  auto.positionManager.openPosition("carry", symbol, "long", 0.01, 60_000, 10, 1);
  const autoReport = await auto.portfolioManager.executeCloseAll();
  assertCondition(autoReport.unresolved.length === 0, "auto-flatten remained unresolved");
  assertCondition(autoReport.closed.includes("carry/BTC/USDC/long"), "auto-flatten omitted attribution");
  assertCondition(auto.portfolioManager.didExecuteCloseAll(), "auto-flatten did not latch");

  const autoSpotFeed = new AutoFlattenFeed({
    positions: [],
    balances: [{ currency: "BTC", free: 0.01, total: 0.01 }],
    marketMeta: spotMeta,
  });
  const autoSpot = await makePortfolioStack({
    feed: autoSpotFeed,
    requireAuthoritativeEmergencyState: true,
    configuredSymbols: [symbol],
  });
  const autoSpotReport = await autoSpot.portfolioManager.executeCloseAll();
  assertCondition(autoSpotReport.unresolved.length === 0, "auto-flatten spot remained unresolved");

  for (const failure of [new Error("authority Error"), "authority string"] as const) {
    const metaFeed = new FaultFeed({ positions: [] });
    metaFeed.marketMetaFailures.push(failure);
    const metaStack = await makePortfolioStack({
      feed: metaFeed,
      requireAuthoritativeEmergencyState: true,
      configuredSymbols: [symbol],
    });
    assertCondition(
      // eslint-disable-next-line unicorn/no-await-expression-member -- The assertion reads the awaited E2E operation result exactly once.
      (await metaStack.portfolioManager.executeCloseAll()).unresolved
        .join(" ")
        .includes(typeof failure === "string" ? failure : failure.message),
      "metadata failure was not reported",
    );

    const positionFeed = new FaultFeed({ positions: [], marketMeta: derivativeMeta });
    positionFeed.positionFailures.push(failure);
    const positionStack = await makePortfolioStack({
      feed: positionFeed,
      requireAuthoritativeEmergencyState: true,
      configuredSymbols: [symbol],
    });
    positionStack.positionManager.openPosition("unavailable", symbol, "long", 0.01, 60_000, 10, 1);
    assertCondition(
      // eslint-disable-next-line unicorn/no-await-expression-member -- The assertion reads the awaited E2E operation result exactly once.
      (await positionStack.portfolioManager.executeCloseAll()).unresolved
        .join(" ")
        .includes("derivative position unavailable"),
      "position failure was not reported",
    );

    const balanceFeed = new FaultFeed({ positions: [] });
    balanceFeed.balanceFailures.push(failure);
    const balanceStack = await makePortfolioStack({
      feed: balanceFeed,
      requireAuthoritativeEmergencyState: true,
      configuredSymbols: [symbol],
    });
    assertCondition(
      // eslint-disable-next-line unicorn/no-await-expression-member -- The assertion reads the awaited E2E operation result exactly once.
      (await balanceStack.portfolioManager.executeCloseAll()).unresolved
        .join(" ")
        .includes(typeof failure === "string" ? failure : failure.message),
      "balance failure was not reported",
    );

    const verifyFeed = new FaultFeed({ positions: [] });
    verifyFeed.positionFailureOnCall = { call: 2, failure };
    verifyFeed.balanceFailureOnCall = { call: 2, failure };
    const verifyStack = await makePortfolioStack({
      feed: verifyFeed,
      requireAuthoritativeEmergencyState: true,
      configuredSymbols: [symbol],
    });
    const verifyReport = await verifyStack.portfolioManager.executeCloseAll();
    assertCondition(
      verifyReport.unresolved.join(" ").includes("authoritative position verification"),
      "position verification failure was not reported",
    );
    assertCondition(
      verifyReport.unresolved.join(" ").includes("authoritative balance verification"),
      "balance verification failure was not reported",
    );
  }

  const invalidSpot = await makePortfolioStack({
    feed: new FaultFeed({
      positions: [],
      balances: [{ currency: "BTC", free: 0.01, total: 0.01 }],
      marketMeta: spotMeta,
    }),
    requireAuthoritativeEmergencyState: true,
    configuredSymbols: [symbol],
  });
  invalidSpot.positionManager.openPosition("spot", symbol, "short", 0.01, 60_000, 10, 1);
  assertCondition(
    // eslint-disable-next-line unicorn/no-await-expression-member -- The assertion reads the awaited E2E operation result exactly once.
    (await invalidSpot.portfolioManager.executeCloseAll()).unresolved
      .join(" ")
      .includes("invalid local spot short removed"),
    "invalid spot short was not quarantined",
  );

  const unavailableSpotFeed = new FaultFeed({ positions: [], marketMeta: spotMeta });
  unavailableSpotFeed.balanceFailures.push("balances unavailable");
  const unavailableSpot = await makePortfolioStack({
    feed: unavailableSpotFeed,
    requireAuthoritativeEmergencyState: true,
    configuredSymbols: [symbol],
  });
  unavailableSpot.positionManager.openPosition("spot", symbol, "long", 0.01, 60_000, 10, 1);
  assertCondition(
    // eslint-disable-next-line unicorn/no-await-expression-member -- The assertion reads the awaited E2E operation result exactly once.
    (await unavailableSpot.portfolioManager.executeCloseAll()).unresolved
      .join(" ")
      .includes("spot inventory unavailable"),
    "unavailable spot inventory was not reported",
  );

  const staleSpot = await makePortfolioStack({
    feed: new FaultFeed({
      positions: [],
      balances: [{ currency: "BTC", free: 0, total: 0 }],
      marketMeta: spotMeta,
    }),
    requireAuthoritativeEmergencyState: true,
    configuredSymbols: [symbol],
  });
  staleSpot.positionManager.openPosition("stale-spot", symbol, "long", 0.01, 60_000, 10, 1);
  await staleSpot.portfolioManager.executeCloseAll();
  assertCondition(staleSpot.positionManager.getPositionCount() === 0, "stale spot position remained local");

  const absentSpotBalance = await makePortfolioStack({
    feed: new FaultFeed({
      positions: [],
      balances: [{ currency: "USDC", free: 1000, total: 1000 }],
      marketMeta: spotMeta,
    }),
    requireAuthoritativeEmergencyState: true,
    configuredSymbols: [symbol],
  });
  absentSpotBalance.positionManager.openPosition("absent-spot", symbol, "long", 0.01, 60_000, 10, 1);
  await absentSpotBalance.portfolioManager.executeCloseAll();
  assertCondition(
    absentSpotBalance.positionManager.getPositionCount() === 0,
    "absent spot balance remained local",
  );

  const attributedSpotFeed = new FaultFeed({
    positions: [],
    balances: [{ currency: "BTC", free: 0.01, total: 0.01 }],
    marketMeta: spotMeta,
  });
  const attributedSpot = await makePortfolioStack({
    feed: attributedSpotFeed,
    requireAuthoritativeEmergencyState: true,
    configuredSymbols: [symbol],
  });
  attributedSpot.positionManager.openPosition("attributed-spot", symbol, "long", 0.01, 60_000, 10, 1);
  const attributedSpotReport = await attributedSpot.portfolioManager.executeCloseAll();
  assertCondition(
    attributedSpotReport.unresolved.includes("attributed-spot/BTC/USDC/long"),
    "spot venue close lost local attribution",
  );

  const noPriceFeed = new FaultFeed({
    positions: [{ ...makeRemotePosition(), entryPrice: undefined, markPrice: undefined }],
    marketMeta: derivativeMeta,
  });
  const noPrice = await makePortfolioStack({
    feed: noPriceFeed,
    requireAuthoritativeEmergencyState: true,
    configuredSymbols: [symbol],
  });
  assertCondition(
    // eslint-disable-next-line unicorn/no-await-expression-member -- The assertion reads the awaited E2E operation result exactly once.
    (await noPrice.portfolioManager.executeCloseAll()).unresolved.includes("venue/BTC/USDC/long"),
    "price-less derivative was not unresolved",
  );

  const shortFeed = new FaultFeed({ positions: [makeRemotePosition("short")], marketMeta: derivativeMeta });
  const short = await makePortfolioStack({
    feed: shortFeed,
    requireAuthoritativeEmergencyState: true,
    configuredSymbols: [symbol],
  });
  await short.portfolioManager.executeCloseAll();
  assertCondition(
    firstOrder(shortFeed.placedOrders, "short venue close").side === "buy",
    "short venue close side mismatch",
  );

  for (const failure of [new Error("venue Error"), "venue string"] as const) {
    const failedDerivativeFeed = new FaultFeed({
      positions: [makeRemotePosition()],
      marketMeta: derivativeMeta,
    });
    failedDerivativeFeed.placeFailures.push(failure);
    const failedDerivative = await makePortfolioStack({
      feed: failedDerivativeFeed,
      requireAuthoritativeEmergencyState: true,
      configuredSymbols: [symbol],
    });
    assertCondition(
      // eslint-disable-next-line unicorn/no-await-expression-member -- The assertion reads the awaited E2E operation result exactly once.
      (await failedDerivative.portfolioManager.executeCloseAll()).unresolved.includes("venue/BTC/USDC/long"),
      "failed derivative close was not unresolved",
    );

    const failedSpotFeed = new FaultFeed({
      positions: [],
      balances: [{ currency: "BTC", free: 0.01, total: 0.01 }],
      marketMeta: spotMeta,
    });
    failedSpotFeed.placeFailures.push(failure);
    const failedSpot = await makePortfolioStack({
      feed: failedSpotFeed,
      requireAuthoritativeEmergencyState: true,
      configuredSymbols: [symbol],
    });
    assertCondition(
      // eslint-disable-next-line unicorn/no-await-expression-member -- The assertion reads the awaited E2E operation result exactly once.
      (await failedSpot.portfolioManager.executeCloseAll()).unresolved.includes("venue/BTC/USDC/spot"),
      "failed spot close was not unresolved",
    );
  }

  const fallbackTickerFeed = new FaultFeed({
    positions: [],
    balances: [{ currency: "BTC", free: 0.01, total: 0.01 }],
    marketMeta: spotMeta,
  });
  fallbackTickerFeed.setTicker(symbol, {
    symbol,
    timestamp: 1,
    bid: 0,
    ask: 60_001,
    last: 60_000,
    baseVolume: 0,
    quoteVolume: 0,
  });
  const fallbackTicker = await makePortfolioStack({
    feed: fallbackTickerFeed,
    requireAuthoritativeEmergencyState: true,
    configuredSymbols: [symbol],
  });
  await fallbackTicker.portfolioManager.executeCloseAll();
  assertCondition(
    fallbackTickerFeed.placedOrders.length === 1,
    "last-price spot fallback did not place scripted order",
  );

  const tooSmallFeed = new FaultFeed({
    positions: [],
    balances: [{ currency: "BTC", free: 0.0001, total: 0.0001 }],
    marketMeta: new Map([[symbol, makePortfolioMarketMeta(true, 1_000_000)]]),
  });
  const tooSmall = await makePortfolioStack({
    feed: tooSmallFeed,
    requireAuthoritativeEmergencyState: true,
    configuredSymbols: [symbol],
  });
  await tooSmall.portfolioManager.executeCloseAll();
  assertCondition(tooSmallFeed.placedOrders.length === 0, "untradable spot amount placed a scripted order");

  for (const isSpot of [true, false]) {
    const requestFeed = new FaultFeed({
      positions: [],
      marketMeta: new Map([[symbol, makePortfolioMarketMeta(isSpot)]]),
    });
    const requestStack = await makePortfolioStack({
      feed: requestFeed,
      requireAuthoritativeEmergencyState: true,
      configuredSymbols: [symbol],
    });
    const position = requestStack.positionManager.openPosition(
      isSpot ? "spot" : "derivative",
      symbol,
      "long",
      0.01,
      60_000,
      10,
      1,
    );
    assertCondition(
      !(await requestStack.portfolioManager.requestPositionClose(position, "manual")),
      "open authoritative request unexpectedly settled",
    );
  }
  for (const failure of [new Error("metadata Error"), "metadata string"] as const) {
    const requestFeed = new FaultFeed();
    requestFeed.marketMetaFailures.push(failure);
    const requestStack = await makePortfolioStack({
      feed: requestFeed,
      requireAuthoritativeEmergencyState: true,
    });
    const position = requestStack.positionManager.openPosition(
      "metadata",
      symbol,
      "long",
      0.01,
      60_000,
      10,
      1,
    );
    assertCondition(
      !(await requestStack.portfolioManager.requestPositionClose(position, "manual")),
      "metadata failure settled close",
    );
  }

  for (const mode of ["terminal", "unavailable"] as const) {
    const pendingFeed = new FaultFeed({ positions: [makeRemotePosition()], marketMeta: derivativeMeta });
    const pendingStack = await makePortfolioStack({
      feed: pendingFeed,
      requireAuthoritativeEmergencyState: true,
      configuredSymbols: [symbol],
    });
    await pendingStack.portfolioManager.executeCloseAll();
    const pendingOrder = firstOrder(pendingFeed.placedOrders, `${mode} authoritative close`);
    if (mode === "terminal")
      pendingFeed.setOrderStatus(pendingOrder.clientOrderId, { status: "canceled", filled: 0 });
    else pendingFeed.orderFailures.push("pending unavailable");
    await pendingStack.portfolioManager.executeCloseAll();
  }

  for (const mode of ["terminal", "unavailable"] as const) {
    const pendingFeed = new FaultFeed({
      positions: [],
      balances: [{ currency: "BTC", free: 0.01, total: 0.01 }],
      marketMeta: spotMeta,
    });
    const pendingStack = await makePortfolioStack({
      feed: pendingFeed,
      requireAuthoritativeEmergencyState: true,
      configuredSymbols: [symbol],
    });
    await pendingStack.portfolioManager.executeCloseAll();
    const pendingOrder = firstOrder(pendingFeed.placedOrders, `${mode} spot close`);
    if (mode === "terminal")
      pendingFeed.setOrderStatus(pendingOrder.clientOrderId, { status: "canceled", filled: 0 });
    else pendingFeed.orderFailures.push("pending spot unavailable");
    await pendingStack.portfolioManager.executeCloseAll();
  }
}

export { runPortfolioManagerAuthoritative };
