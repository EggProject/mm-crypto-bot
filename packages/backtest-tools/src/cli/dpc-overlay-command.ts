import { stat } from "node:fs/promises";
import path from "node:path";

import {
  DEFAULT_SOL_FLIP_KILL_SWITCH_PLUGIN_CONFIG,
  type RegimeDetectorConfig,
  type SOLFlipKillSwitchPluginConfig,
} from "@mm-crypto-bot/core";

export const OVERLAY_MASKS = ["dpc", "dpc-solflip", "dpc-regime", "dpc-solflip-regime"] as const;
export type OverlayMask = (typeof OVERLAY_MASKS)[number];

export interface OverlayCliArgs {
  readonly mask: OverlayMask;
  readonly symbol: string;
  readonly startTime: Date;
  readonly endTime: Date;
  readonly window: "IS";
  readonly outputPath: string;
  readonly dataDir: string;
  readonly fundingPath: string;
  readonly initialEquityUsd: number;
  readonly minConsensus: number;
  readonly riskPerTrade: number;
  readonly maxPositionPctEquity: number;
  readonly regimeConfig: Partial<RegimeDetectorConfig>;
  readonly solFlipConfig: Partial<SOLFlipKillSwitchPluginConfig>;
  readonly smoke: boolean;
}

const ALLOWED_SYMBOLS = new Set(["BTC/USDT", "ETH/USDT", "SOL/USDT"]);

function finiteInRange(flag: string, raw: string, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${flag} must be in [${String(min)}, ${String(max)}], got: ${raw}`);
  }
  return value;
}

function integerInRange(flag: string, raw: string, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${flag} must be an integer in [${String(min)}, ${String(max)}], got: ${raw}`);
  }
  return value;
}

export function parseOverlayMask(raw: string): OverlayMask {
  if ((OVERLAY_MASKS as readonly string[]).includes(raw)) return raw as OverlayMask;
  throw new Error(`--mask must be one of: ${OVERLAY_MASKS.join(", ")}; got: ${raw}`);
}

export function maskUsesSolFlip(mask: OverlayMask): boolean {
  return mask === "dpc-solflip" || mask === "dpc-solflip-regime";
}

export function maskUsesRegime(mask: OverlayMask): boolean {
  return mask === "dpc-regime" || mask === "dpc-solflip-regime";
}

export function parseArgs(argv: readonly string[] = process.argv.slice(2)): OverlayCliArgs {
  let mask: OverlayMask = "dpc";
  let symbol = "BTC/USDT";
  let startTime = new Date(Date.UTC(2024, 0, 1));
  let endTime = new Date();
  const window = "IS" as const;
  let outputPath = "backtest-results/dpc-overlay-combination.json";
  let dataDir = path.resolve(import.meta.dir, "..", "..", "..", "..", "data", "ohlcv");
  let fundingPath = path.resolve(
    import.meta.dir,
    "..",
    "..",
    "..",
    "..",
    "data",
    "funding",
    "binance_solusdt_funding_8h.csv",
  );
  let initialEquityUsd = 10_000;
  let minConsensus = 1;
  let riskPerTrade = 0.01;
  let maxPositionPctEquity = 0.2;
  let regimeConfig: Partial<RegimeDetectorConfig> = {};
  let solFlipConfig: Partial<SOLFlipKillSwitchPluginConfig> = {
    ...DEFAULT_SOL_FLIP_KILL_SWITCH_PLUGIN_CONFIG,
    enabledSymbols: ["SOL/USDT"],
  };
  let isSmoke = false;

  arguments: for (const argument of argv) {
    const [flag, raw = ""] = argument.split("=", 2);
    switch (flag) {
      case "--mask": {
        mask = parseOverlayMask(raw);
        continue arguments;
      }
      case "--smoke": {
        isSmoke = true;
        continue arguments;
      }
      case "--symbol": {
        symbol = raw;
        continue arguments;
      }
      case "--start":
      case "--is-start": {
        startTime = new Date(raw);
        continue arguments;
      }
      case "--end":
      case "--is-end": {
        endTime = new Date(raw);
        continue arguments;
      }
      case "--window": {
        if (raw.toUpperCase() !== "IS") throw new Error(`--window supports IS only, got: ${raw}`);
        continue arguments;
      }
      case "--output": {
        outputPath = raw;
        continue arguments;
      }
      case "--data-dir": {
        dataDir = path.resolve(raw);
        continue arguments;
      }
      case "--funding-input": {
        fundingPath = path.resolve(raw);
        continue arguments;
      }
      case "--equity": {
        initialEquityUsd = finiteInRange(flag, raw, 1, Number.MAX_SAFE_INTEGER);
        continue arguments;
      }
      case "--min-consensus": {
        minConsensus = integerInRange(flag, raw, 1, 2);
        continue arguments;
      }
      case "--risk-per-trade": {
        riskPerTrade = finiteInRange(flag, raw, 0.000001, 0.1);
        continue arguments;
      }
      case "--max-position-pct-equity": {
        maxPositionPctEquity = finiteInRange(flag, raw, 0.01, 0.5);
        continue arguments;
      }
      case "--regime-min-observations": {
        regimeConfig = { ...regimeConfig, minObservations: integerInRange(flag, raw, 5, 365) };
        continue arguments;
      }
      case "--regime-learning-days": {
        regimeConfig = { ...regimeConfig, transitionLearningDays: integerInRange(flag, raw, 30, 730) };
        continue arguments;
      }
      case "--regime-trending-multiplier": {
        const multiplier = finiteInRange(flag, raw, 0, 1);
        const current = regimeConfig.perRegimeSizeMultiplier ?? [1, 0.7, 0.4];
        regimeConfig = { ...regimeConfig, perRegimeSizeMultiplier: [multiplier, current[1], current[2]] };
        continue arguments;
      }
      case "--regime-ranging-multiplier": {
        const multiplier = finiteInRange(flag, raw, 0, 1);
        const current = regimeConfig.perRegimeSizeMultiplier ?? [1, 0.7, 0.4];
        regimeConfig = { ...regimeConfig, perRegimeSizeMultiplier: [current[0], multiplier, current[2]] };
        continue arguments;
      }
      case "--regime-volatile-multiplier": {
        const multiplier = finiteInRange(flag, raw, 0, 1);
        const current = regimeConfig.perRegimeSizeMultiplier ?? [1, 0.7, 0.4];
        regimeConfig = { ...regimeConfig, perRegimeSizeMultiplier: [current[0], current[1], multiplier] };
        continue arguments;
      }
      case "--sol-sign-flip-window-days": {
        solFlipConfig = { ...solFlipConfig, signFlipWindowDays: finiteInRange(flag, raw, 1, 365) };
        continue arguments;
      }
      case "--sol-extreme-sigma": {
        solFlipConfig = { ...solFlipConfig, extremeSigmaThreshold: finiteInRange(flag, raw, 0, 20) };
        continue arguments;
      }
      case "--sol-persistence-days": {
        solFlipConfig = { ...solFlipConfig, persistenceDays: finiteInRange(flag, raw, 0, 365) };
        continue arguments;
      }
      case "--sol-vol-window-days": {
        solFlipConfig = { ...solFlipConfig, volWindowDays: integerInRange(flag, raw, 1, 365) };
        continue arguments;
      }
      default: {
        throw new Error(`Unknown argument: ${argument}`);
      }
    }
  }
  if (!ALLOWED_SYMBOLS.has(symbol))
    throw new Error(`--symbol must be BTC/USDT, ETH/USDT, or SOL/USDT; got: ${symbol}`);
  if (!Number.isFinite(startTime.getTime()) || !Number.isFinite(endTime.getTime()) || startTime >= endTime) {
    throw new Error("--start/--is-start and --end/--is-end must define a valid increasing interval");
  }
  if (maskUsesSolFlip(mask) && symbol !== "SOL/USDT") {
    throw new Error(`INVALID_MASK: ${mask} requires --symbol=SOL/USDT; SOLFlip is not a BTC/ETH no-op`);
  }
  return {
    mask,
    symbol,
    startTime,
    endTime,
    window,
    outputPath,
    dataDir,
    fundingPath,
    initialEquityUsd,
    minConsensus,
    riskPerTrade,
    maxPositionPctEquity,
    regimeConfig,
    solFlipConfig,
    smoke: isSmoke,
  };
}

export function helpText(): string {
  return [
    "Production DPC overlay-combination historical runner",
    "",
    "Usage:",
    "  bun run packages/backtest-tools/src/cli/run-dpc-overlay-combination.ts [options]",
    "",
    "Required execution contract:",
    `  --mask=${OVERLAY_MASKS.join("|")}`,
    "  --symbol=BTC/USDT|ETH/USDT|SOL/USDT",
    "  --start=YYYY-MM-DD (alias: --is-start)",
    "  --end=YYYY-MM-DD (alias: --is-end)",
    "  --output=path/to/result.json",
    "",
    "Adapter gate:",
    "  --help   Print this contract without loading market data",
    "  --smoke  Validate the selected mask and real input files, write a small JSON result, and skip the backtest",
    "",
    "Common tuning flags:",
    "  --min-consensus=1|2 --risk-per-trade=0.01 --max-position-pct-equity=0.2",
    "  --data-dir=data/ohlcv --funding-input=data/funding/binance_solusdt_funding_8h.csv",
  ].join("\n");
}

export async function runSmoke(arguments_: OverlayCliArgs): Promise<Record<string, unknown>> {
  const ohlcvPath = path.resolve(
    arguments_.dataDir,
    `binance_${arguments_.symbol.split("/", 1)[0]!.toLowerCase()}_15m.csv`,
  );
  const ohlcvStat = await stat(ohlcvPath);
  if (!ohlcvStat.isFile() || ohlcvStat.size === 0)
    throw new Error(`Smoke: missing/empty OHLCV input: ${ohlcvPath}`);
  let funding: Record<string, unknown> | null = null;
  if (maskUsesSolFlip(arguments_.mask)) {
    const fundingStat = await stat(arguments_.fundingPath);
    if (!fundingStat.isFile() || fundingStat.size === 0)
      throw new Error(`Smoke: missing/empty funding input: ${arguments_.fundingPath}`);
    funding = { path: arguments_.fundingPath, bytes: fundingStat.size, synthetic: false };
  }
  return {
    status: "SMOKE_OK",
    runner: "dpc-overlay-combination",
    mask: arguments_.mask,
    symbol: arguments_.symbol,
    supportedMasks: OVERLAY_MASKS,
    executionSkipped: true,
    inputChecks: { ohlcv: { path: ohlcvPath, bytes: ohlcvStat.size, synthetic: false }, funding },
  };
}
