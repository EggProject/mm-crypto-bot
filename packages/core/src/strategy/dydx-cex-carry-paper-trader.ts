import type { TickDensityState } from "./dydx-cex-carry-config.js";
import type { KillSwitchVerdicts } from "./dydx-cex-carry-kill-switches.js";
import type { ExactRational } from "@mm-crypto-bot/numeric";

export function recordTickDensity(previous: TickDensityState, day: string): TickDensityState {
  const days = previous.days.map((entry) => ({ ...entry }));
  const latest = days.at(-1);
  const current = latest?.day === day ? latest : { day, dydxCount: 0, cexCount: 0 };
  if (latest?.day !== day) days.push(current);
  current.dydxCount += 1;
  current.cexCount += 1;
  const retained = days.slice(-7);
  return {
    days: retained,
    totalTicksLast7d: retained.reduce((total, entry) => total + entry.dydxCount + entry.cexCount, 0),
  };
}

export function calculateFundingPayment(
  notionalUsd: ExactRational,
  dydxFundingRate: ExactRational,
  cexFundingRate: ExactRational,
): ExactRational {
  return notionalUsd.multiply(cexFundingRate.subtract(dydxFundingRate));
}

export function isHaltEngaged(verdicts: KillSwitchVerdicts | undefined): boolean {
  return (
    verdicts?.["indexer-stale"].engaged === true ||
    verdicts?.["chain-non-finalized"].engaged === true ||
    verdicts?.["divergence-7d-compression"].engaged === true ||
    verdicts?.["bybit-eu-spot-thin"].reason === "bybit-eu-depth-unknown"
  );
}
