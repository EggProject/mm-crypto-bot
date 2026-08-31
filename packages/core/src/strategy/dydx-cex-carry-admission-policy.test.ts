import { describe, expect, it } from "bun:test";

import {
  DEFAULT_KILL_SWITCH_CONFIG,
  DEFAULT_PRECONDITION_CONFIG,
  allPreconditionsSatisfied,
  evaluateKillSwitches,
  evaluatePrecondition,
  type PreconditionsState,
} from "./dydx-cex-carry.js";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 6, 1);

function satisfiedState(startMs: number): PreconditionsState {
  return {
    "live-divergence": { satisfied: true, firstSatisfiedMs: startMs, lastVerifiedMs: NOW },
    "chain-incident-clear": { satisfied: true, firstSatisfiedMs: startMs, lastVerifiedMs: NOW },
    "no-recent-governance": { satisfied: true, firstSatisfiedMs: startMs, lastVerifiedMs: NOW },
  };
}

describe("dYdX CEX carry admission policy", () => {
  it("halts stale or never-finalized inputs while reducing only thin spot depth", () => {
    const verdicts = evaluateKillSwitches(
      {
        indexerStaleMs: 6 * 60 * 1000,
        chainNonFinalizedMs: undefined,
        compressedDivergenceDayStreak: 0,
        tickDensityLast7d: 200,
        bybitEuSpotDepthUsd: 50_000,
      },
      DEFAULT_KILL_SWITCH_CONFIG,
    );

    expect(verdicts["indexer-stale"]).toEqual({ engaged: true, reason: "indexer-stale 360s > 300s" });
    expect(verdicts["chain-non-finalized"]).toEqual({ engaged: true, reason: "chain-never-finalized" });
    expect(verdicts["bybit-eu-spot-thin"].engaged).toBe(true);
  });

  it("requires both seven compressed days and sufficient density", () => {
    const inputs = {
      indexerStaleMs: 0,
      chainNonFinalizedMs: 0,
      compressedDivergenceDayStreak: 7,
      bybitEuSpotDepthUsd: 200_000,
    };

    expect(
      evaluateKillSwitches({ ...inputs, tickDensityLast7d: 167 }, DEFAULT_KILL_SWITCH_CONFIG)[
        "divergence-7d-compression"
      ].engaged,
    ).toBe(false);
    expect(
      evaluateKillSwitches({ ...inputs, tickDensityLast7d: 168 }, DEFAULT_KILL_SWITCH_CONFIG)[
        "divergence-7d-compression"
      ].engaged,
    ).toBe(true);
  });

  it("requires each sustained precondition duration before admitting entry", () => {
    const result = allPreconditionsSatisfied(
      satisfiedState(NOW - 20 * DAY),
      NOW,
      DEFAULT_PRECONDITION_CONFIG,
    );

    expect(result).toEqual({ ok: true, reasons: [] });
    expect(
      allPreconditionsSatisfied(satisfiedState(NOW - 6 * DAY), NOW, DEFAULT_PRECONDITION_CONFIG).reasons,
    ).toContain("live-divergence sustained 6d < 7d");
    expect(
      allPreconditionsSatisfied(satisfiedState(NOW - 60 * HOUR), NOW, DEFAULT_PRECONDITION_CONFIG).reasons,
    ).toContain("chain-incident-clear sustained 60h < 72h");
  });

  it("resets the sustained precondition clock after a failed re-verification", () => {
    const first = evaluatePrecondition(
      "live-divergence",
      { satisfied: false, firstSatisfiedMs: undefined, lastVerifiedMs: undefined },
      NOW - 8 * DAY,
      { kind: "live-divergence", satisfied: true },
    );
    const failed = evaluatePrecondition("live-divergence", first, NOW - DAY, {
      kind: "live-divergence",
      satisfied: false,
    });
    const recovered = evaluatePrecondition("live-divergence", failed, NOW, {
      kind: "live-divergence",
      satisfied: true,
    });

    expect(failed.firstSatisfiedMs).toBeUndefined();
    expect(recovered.firstSatisfiedMs).toBe(NOW);
  });

  it("rejects a claimed precondition that has no first-satisfied timestamp", () => {
    const state = satisfiedState(NOW - 20 * DAY);
    const malformed = {
      ...state,
      "live-divergence": { ...state["live-divergence"], firstSatisfiedMs: undefined },
    };
    expect(allPreconditionsSatisfied(malformed, NOW, DEFAULT_PRECONDITION_CONFIG).ok).toBe(false);
    expect(allPreconditionsSatisfied(malformed, NOW, DEFAULT_PRECONDITION_CONFIG).reasons).toContain(
      "live-divergence never observed satisfied",
    );
  });

  it("formats the governance duration in days", () => {
    const state = satisfiedState(NOW - 20 * DAY);
    const insufficientGovernance = {
      ...state,
      "no-recent-governance": { ...state["no-recent-governance"], firstSatisfiedMs: NOW - 10 * DAY },
    };
    expect(
      allPreconditionsSatisfied(insufficientGovernance, NOW, DEFAULT_PRECONDITION_CONFIG).reasons,
    ).toContain("no-recent-governance sustained 10d < 14d");
  });
});
