export type KillSwitchId =
  "indexer-stale" | "chain-non-finalized" | "divergence-7d-compression" | "bybit-eu-spot-thin";

export interface KillSwitchConfig {
  readonly indexerStaleMs: number;
  readonly chainNonFinalizedMs: number;
  readonly compressionThreshold: ExactRational;
  readonly bybitEuMinDepthUsd: number;
  readonly sparseDataMinTicksPer7d: number;
}

export interface KillSwitchVerdict {
  readonly engaged: boolean;
  readonly reason: string;
}

export interface KillSwitchInputs {
  readonly indexerStaleMs: number | undefined;
  readonly chainNonFinalizedMs: number | undefined;
  readonly compressedDivergenceDayStreak: number;
  readonly tickDensityLast7d: number;
  readonly bybitEuSpotDepthUsd: number | undefined;
}

export type KillSwitchVerdicts = Readonly<Record<KillSwitchId, KillSwitchVerdict>>;

export const ALL_KILL_SWITCHES = Object.freeze([
  "indexer-stale",
  "chain-non-finalized",
  "divergence-7d-compression",
  "bybit-eu-spot-thin",
] as const satisfies readonly KillSwitchId[]);

export const DEFAULT_KILL_SWITCH_CONFIG: KillSwitchConfig = Object.freeze({
  indexerStaleMs: 5 * 60 * 1000,
  chainNonFinalizedMs: 10 * 60 * 1000,
  compressionThreshold: ExactRational.from("0.0005"),
  bybitEuMinDepthUsd: 100_000,
  sparseDataMinTicksPer7d: 168,
});

export function evaluateKillSwitches(inputs: KillSwitchInputs, config: KillSwitchConfig): KillSwitchVerdicts {
  return {
    "indexer-stale": staleVerdict(
      inputs.indexerStaleMs,
      config.indexerStaleMs,
      "indexer",
      "indexer-never-tick",
      "indexer-fresh",
    ),
    "chain-non-finalized": staleVerdict(
      inputs.chainNonFinalizedMs,
      config.chainNonFinalizedMs,
      "chain",
      "chain-never-finalized",
      "chain-finalized",
    ),
    "divergence-7d-compression": compressionVerdict(inputs, config),
    "bybit-eu-spot-thin": liquidityVerdict(inputs.bybitEuSpotDepthUsd, config.bybitEuMinDepthUsd),
  };
}

function staleVerdict(
  ageMs: number | undefined,
  thresholdMs: number,
  name: string,
  unknownReason: string,
  freshReason: string,
): KillSwitchVerdict {
  if (typeof ageMs !== "number" || !Number.isFinite(ageMs) || ageMs < 0)
    return { engaged: true, reason: unknownReason };
  if (ageMs > thresholdMs)
    return {
      engaged: true,
      reason: `${name}-stale ${String(Math.round(ageMs / 1000))}s > ${String(Math.round(thresholdMs / 1000))}s`,
    };
  return { engaged: false, reason: freshReason };
}

function compressionVerdict(inputs: KillSwitchInputs, config: KillSwitchConfig): KillSwitchVerdict {
  if (inputs.compressedDivergenceDayStreak < 7)
    return {
      engaged: false,
      reason: `compressed-streak ${String(inputs.compressedDivergenceDayStreak)}d < 7d`,
    };
  if (inputs.tickDensityLast7d < config.sparseDataMinTicksPer7d)
    return {
      engaged: false,
      reason: `compressed-streak ${String(inputs.compressedDivergenceDayStreak)}d >= 7d BUT tick-density ${String(inputs.tickDensityLast7d)} < ${String(config.sparseDataMinTicksPer7d)} (sparse-data guard)`,
    };
  return {
    engaged: true,
    reason: `compressed-streak ${String(inputs.compressedDivergenceDayStreak)}d >= 7d with tick-density ${String(inputs.tickDensityLast7d)} >= ${String(config.sparseDataMinTicksPer7d)}`,
  };
}

function liquidityVerdict(depthUsd: number | undefined, minimumDepthUsd: number): KillSwitchVerdict {
  if (typeof depthUsd !== "number" || !Number.isFinite(depthUsd) || depthUsd < 0)
    return { engaged: true, reason: "bybit-eu-depth-unknown" };
  if (depthUsd < minimumDepthUsd)
    return {
      engaged: true,
      reason: `bybit-eu-spot-thin $${String(Math.round(depthUsd))} < $${String(minimumDepthUsd)}`,
    };
  return { engaged: false, reason: "bybit-eu-depth-ok" };
}
import { ExactRational } from "@mm-crypto-bot/numeric";
