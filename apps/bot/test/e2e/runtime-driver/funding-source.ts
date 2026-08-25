import { MockDydxFundingSource } from "../../../src/bot/mock-dydx-funding-source.js";

import { assertCondition } from "./runtime-driver-core.js";

export async function runFundingSource(): Promise<void> {
  const market = "BTC-USD";
  const source = new MockDydxFundingSource();
  assertCondition(
    source.lastTickAgeMs(market, Date.now()) === null,
    "funding source unexpectedly had a pre-subscription tick",
  );
  assertCondition(
    source.lastChainBlockHeight(market) === 1_000_000,
    "funding source initial height mismatch",
  );
  assertCondition(
    source.lastChainBlockTs(market) === null,
    "funding source unexpectedly had a pre-subscription block time",
  );
  assertCondition(
    source.bybitEuSpotDepthUsd(market, Date.now()) === 1_000_000,
    "funding source depth mismatch",
  );
  source.health();
  let ticks = 0;
  const handle = source.subscribe(market, (snapshot) => {
    ticks += 1;
    assertCondition(snapshot.dydx.symbol === "BTC-USD", "dYdX funding symbol mismatch");
    assertCondition(snapshot.cex.symbol === "BTCUSDT", "CEX funding symbol mismatch");
  });
  await Bun.sleep(1050);
  handle.close();
  assertCondition(ticks >= 2, "funding interval did not emit a second tick");
  assertCondition(source.lastTickAgeMs(market, Date.now()) !== null, "funding source lost its last tick");
  assertCondition(source.lastChainBlockTs(market) !== null, "funding source lost its block time");
  source.health();

  const first = new MockDydxFundingSource(123);
  const second = new MockDydxFundingSource(123);
  let firstRate: number | undefined;
  let secondRate: number | undefined;
  const firstHandle = first.subscribe(market, (snapshot) => {
    firstRate = snapshot.dydx.fundingRate;
  });
  const secondHandle = second.subscribe(market, (snapshot) => {
    secondRate = snapshot.dydx.fundingRate;
  });
  firstHandle.close();
  secondHandle.close();
  assertCondition(firstRate === secondRate, "seeded funding sources diverged");
}
