import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { relative, resolve } from "node:path";

import { asNumber, asString, isObject, readJson, REPO_ROOT, writeText } from "./common.js";
import { captureCodeProvenance, executeSearchJobs, type ExecutionOptions } from "./search-execution.js";
import { generateCombinationMatrix } from "./generate-combination-matrix.js";

interface Split {
  readonly id: string;
  readonly start: string;
  readonly end: string;
}

interface CommonPriceGrid {
  readonly symbols: readonly string[];
  readonly timeframe: string;
  readonly initialEquityUsd: number;
}

interface DpcGrid extends CommonPriceGrid {
  readonly minConsensus: readonly number[];
  readonly maxPositionPctEquity: readonly number[];
}

interface DrcGrid extends CommonPriceGrid {
  readonly donchianPeriod: readonly number[];
  readonly adxTrendThreshold: readonly number[];
}

interface PivotGrid extends CommonPriceGrid {
  readonly maxPositionPctEquity: readonly number[];
}

interface OhlcTrendGrid {
  readonly symbols: readonly string[];
  readonly timeframe: readonly string[];
  readonly initialEquityUsd: number;
  readonly emaPairs: readonly (readonly [number, number])[];
  readonly atrStopMultiplier: readonly number[];
  readonly rewardToRisk: readonly number[];
  readonly crossLookback: readonly number[];
}

interface SolFlipGrid {
  readonly input: string;
  readonly signFlipWindowDays: readonly number[];
  readonly extremeSigmaThreshold: readonly number[];
  readonly persistenceDays: readonly number[];
  readonly volWindowDays: readonly number[];
}

interface OverlayGrid {
  readonly supportedPhases: readonly string[];
  readonly masks: readonly string[];
  readonly symbols: readonly string[];
  readonly minConsensus: readonly number[];
  readonly maxPositionPctEquity: readonly number[];
  readonly fundingInput: string;
}

interface ParsedGrids {
  readonly splits: readonly Split[];
  readonly dpc: DpcGrid;
  readonly drc: DrcGrid;
  readonly pivot: PivotGrid;
  readonly ohlcTrend: OhlcTrendGrid;
  readonly solFlip: SolFlipGrid;
  readonly overlay: OverlayGrid;
}

export interface SearchJob {
  readonly runId: string;
  readonly componentMask: string;
  readonly enabledComponents: readonly string[];
  readonly strategyId: string;
  readonly status: string;
  readonly reason: string | null;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly split: Split | null;
  readonly command: readonly string[] | null;
  readonly rawOutput: string | null;
  readonly inputFiles: readonly string[];
  readonly metrics: Readonly<Record<string, null>>;
  readonly provenancePath?: string | null;
  readonly exitCode?: number | null;
}

export const RUNNABLE_STRATEGIES = [
  "donchian_pivot_composition",
  "donchian_range_channel",
  "pivot_point_grid",
  "ohlc_trend",
  "funding_flip_kill_switch",
] as const;

const STRATEGY_ALIASES: Readonly<Record<string, string>> = {
  dpc: "donchian_pivot_composition",
  drc: "donchian_range_channel",
  pivot: "pivot_point_grid",
  "ohlc-trend": "ohlc_trend",
  ohlc: "ohlc_trend",
  solflip: "funding_flip_kill_switch",
  "sol-flip": "funding_flip_kill_switch",
  overlay: "overlay_combination",
  "dpc-overlay": "overlay_combination",
};

const OVERLAY_ADAPTER = {
  id: "overlay_combination",
  runner: "search-best-config/scripts/run-overlay-adapter.ts",
  requiredHelpTokens: ["--smoke", "--mask", "--symbol", "--output", "--start", "--end"],
} as const;

function requireArray(value: unknown, name: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`Hiányzó/hibás tömb: ${name}`);
  return value;
}

function stringArray(value: unknown, name: string): readonly string[] {
  return requireArray(value, name).map((item) => {
    if (typeof item !== "string" || item.length === 0) throw new Error(`Hibás szöveg: ${name}`);
    return item;
  });
}

function numberArray(value: unknown, name: string): readonly number[] {
  return requireArray(value, name).map((item) => {
    const number = asNumber(item);
    if (number === null) throw new Error(`Hibás szám: ${name}`);
    return number;
  });
}

function commonPriceGrid(value: unknown, name: string): CommonPriceGrid {
  if (!isObject(value)) throw new Error(`Hiányzó grid: ${name}`);
  const timeframe = asString(value["timeframe"]);
  const initialEquityUsd = asNumber(value["initialEquityUsd"]);
  if (timeframe === null || initialEquityUsd === null) throw new Error(`Hiányos grid: ${name}`);
  return { symbols: stringArray(value["symbols"], `${name}.symbols`), timeframe, initialEquityUsd };
}

function parseGrids(value: unknown): ParsedGrids {
  if (
    !isObject(value) ||
    !isObject(value["production"]) ||
    !isObject(value["ablations"]) ||
    !isObject(value["optionalAdapters"])
  ) {
    throw new Error("Hibás grids.json");
  }
  const splits = requireArray(value["splits"], "splits").map((entry): Split => {
    if (!isObject(entry)) throw new Error("Hibás split");
    const id = asString(entry["id"]);
    const start = asString(entry["start"]);
    const end = asString(entry["end"]);
    if (id === null || start === null || end === null) throw new Error("Hiányos split");
    return { id, start, end };
  });
  const production = value["production"];
  const ablations = value["ablations"];
  const rawDpc = production["donchian_pivot_composition"];
  const rawSolFlip = production["funding_flip_kill_switch"];
  const rawDrc = ablations["donchian_range_channel"];
  const rawPivot = ablations["pivot_point_grid"];
  const rawOhlc = ablations["ohlc_trend"];
  const rawOverlay = value["optionalAdapters"]["overlay_combination"];
  if (
    !isObject(rawDpc) ||
    !isObject(rawSolFlip) ||
    !isObject(rawDrc) ||
    !isObject(rawPivot) ||
    !isObject(rawOhlc) ||
    !isObject(rawOverlay)
  ) {
    throw new Error("Hiányzó runnable grid");
  }
  const dpcCommon = commonPriceGrid(rawDpc, "donchian_pivot_composition");
  const drcCommon = commonPriceGrid(rawDrc, "donchian_range_channel");
  const pivotCommon = commonPriceGrid(rawPivot, "pivot_point_grid");
  const ohlcInitialEquityUsd = asNumber(rawOhlc["initialEquityUsd"]);
  if (ohlcInitialEquityUsd === null) throw new Error("Hiányzó ohlc_trend.initialEquityUsd");
  const emaPairs = requireArray(rawOhlc["emaPairs"], "ohlc_trend.emaPairs").map(
    (pair): readonly [number, number] => {
      const values = numberArray(pair, "ohlc_trend.emaPairs[]");
      if (values.length !== 2 || values[0] === undefined || values[1] === undefined)
        throw new Error("Hibás EMA pár");
      return [values[0], values[1]];
    },
  );
  const input = asString(rawSolFlip["input"]);
  const overlayFundingInput = asString(rawOverlay["fundingInput"]);
  if (input === null || overlayFundingInput === null) throw new Error("Hiányzó funding input");
  return {
    splits,
    dpc: {
      ...dpcCommon,
      minConsensus: numberArray(rawDpc["minConsensus"], "minConsensus"),
      maxPositionPctEquity: numberArray(rawDpc["maxPositionPctEquity"], "maxPositionPctEquity"),
    },
    drc: {
      ...drcCommon,
      donchianPeriod: numberArray(rawDrc["donchianPeriod"], "donchianPeriod"),
      adxTrendThreshold: numberArray(rawDrc["adxTrendThreshold"], "adxTrendThreshold"),
    },
    pivot: {
      ...pivotCommon,
      maxPositionPctEquity: numberArray(rawPivot["maxPositionPctEquity"], "pivot.maxPositionPctEquity"),
    },
    ohlcTrend: {
      symbols: stringArray(rawOhlc["symbols"], "ohlc_trend.symbols"),
      timeframe: stringArray(rawOhlc["timeframe"], "ohlc_trend.timeframe"),
      initialEquityUsd: ohlcInitialEquityUsd,
      emaPairs,
      atrStopMultiplier: numberArray(rawOhlc["atrStopMultiplier"], "ohlc_trend.atrStopMultiplier"),
      rewardToRisk: numberArray(rawOhlc["rewardToRisk"], "ohlc_trend.rewardToRisk"),
      crossLookback: numberArray(rawOhlc["crossLookback"], "ohlc_trend.crossLookback"),
    },
    solFlip: {
      input,
      signFlipWindowDays: numberArray(rawSolFlip["signFlipWindowDays"], "solFlip.signFlipWindowDays"),
      extremeSigmaThreshold: numberArray(
        rawSolFlip["extremeSigmaThreshold"],
        "solFlip.extremeSigmaThreshold",
      ),
      persistenceDays: numberArray(rawSolFlip["persistenceDays"], "solFlip.persistenceDays"),
      volWindowDays: numberArray(rawSolFlip["volWindowDays"], "solFlip.volWindowDays"),
    },
    overlay: {
      supportedPhases: stringArray(rawOverlay["supportedPhases"], "overlay.supportedPhases"),
      masks: stringArray(rawOverlay["masks"], "overlay.masks"),
      symbols: stringArray(rawOverlay["symbols"], "overlay.symbols"),
      minConsensus: numberArray(rawOverlay["minConsensus"], "overlay.minConsensus"),
      maxPositionPctEquity: numberArray(rawOverlay["maxPositionPctEquity"], "overlay.maxPositionPctEquity"),
      fundingInput: overlayFundingInput,
    },
  };
}

function nullMetrics(): Readonly<Record<string, null>> {
  return {
    totalReturnPct: null,
    monthlyReturnPct: null,
    annualizedReturnPct: null,
    maxDrawdownPct: null,
    sharpe: null,
    sortino: null,
    profitFactor: null,
    winRatePct: null,
    totalTrades: null,
    killSwitchTriggered: null,
  };
}

function compact(value: number): string {
  return String(value).replace(/\./g, "p");
}

function symbolId(symbol: string): string {
  return symbol.split("/")[0]?.toLowerCase() ?? symbol.toLowerCase();
}

function outputFor(outputDir: string, runId: string): string {
  return resolve(outputDir, "raw", `${runId}.json`);
}

function readyJob(input: Omit<SearchJob, "status" | "reason" | "metrics">): SearchJob {
  return { ...input, status: "READY_DRY_RUN", reason: null, metrics: nullMetrics() };
}

function gitRevision(): string | null {
  const result = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "ignore",
  });
  return result.exitCode === 0 ? result.stdout.toString().trim() : null;
}

function selectSplits(splits: readonly Split[], requestedPhases: readonly string[]): readonly Split[] {
  const selected = splits.filter((split) => requestedPhases.includes(split.id));
  if (selected.length !== requestedPhases.length)
    throw new Error(`Ismeretlen vagy ismételt phase: ${requestedPhases.join(",")}`);
  return selected;
}

export async function buildSearchManifest(
  gridsPath = resolve(REPO_ROOT, "search-best-config/grids.json"),
  requestedPhases: readonly string[] = ["is", "validation", "oos"],
  outputDir = resolve(REPO_ROOT, "search-best-config/results"),
): Promise<Readonly<Record<string, unknown>>> {
  const grids = parseGrids(await readJson(gridsPath));
  const { splits, dpc } = grids;
  const selectedSplits = selectSplits(splits, requestedPhases);
  const matrix = generateCombinationMatrix();
  const jobs: SearchJob[] = [];
  const overlayAdapter = await probeOverlayAdapter();
  for (const combination of matrix) {
    if (combination.status !== "SUPPORTED_REAL_DATA") {
      jobs.push({
        runId: `production-${combination.mask}`,
        componentMask: combination.mask,
        enabledComponents: combination.enabled,
        strategyId: combination.enabled.join("+") || "none",
        status: combination.status,
        reason: combination.reason,
        parameters: {},
        split: null,
        command: null,
        rawOutput: null,
        inputFiles: [],
        metrics: nullMetrics(),
      });
      continue;
    }
    const overlayMask =
      combination.mask === "10001"
        ? "dpc-regime"
        : combination.mask === "10010"
          ? "dpc-solflip"
          : combination.mask === "10011"
            ? "dpc-solflip-regime"
            : null;
    if (overlayMask !== null) {
      for (const split of selectedSplits)
        for (const symbol of combination.validSymbols)
          for (const minConsensus of grids.overlay.minConsensus)
            for (const cap of grids.overlay.maxPositionPctEquity) {
              const runId = `production-overlay-${combination.mask}-${split.id}-${symbolId(symbol)}-${minConsensus}of2-cap${compact(cap)}`;
              const parameters = { mask: overlayMask, symbol, minConsensus, maxPositionPctEquity: cap };
              if (!overlayAdapter.ready) {
                jobs.push({
                  runId,
                  componentMask: combination.mask,
                  enabledComponents: combination.enabled,
                  strategyId: "overlay_combination",
                  status: "UNSUPPORTED_ADAPTER",
                  reason: overlayAdapter.reason,
                  parameters,
                  split,
                  command: null,
                  rawOutput: null,
                  inputFiles: [],
                  metrics: nullMetrics(),
                });
                continue;
              }
              const rawOutput = outputFor(outputDir, runId);
              const usesSolFlip = overlayMask.includes("solflip");
              const inputFiles = [
                `data/ohlcv/binance_${symbolId(symbol)}_15m.csv`,
                `data/ohlcv/binance_${symbolId(symbol)}_4h.csv`,
                `data/ohlcv/binance_${symbolId(symbol)}_1d.csv`,
                ...(usesSolFlip ? [grids.overlay.fundingInput] : []),
              ];
              jobs.push(
                readyJob({
                  runId,
                  componentMask: combination.mask,
                  enabledComponents: combination.enabled,
                  strategyId: "overlay_combination",
                  parameters,
                  split,
                  rawOutput,
                  inputFiles,
                  command: [
                    "bun",
                    "run",
                    OVERLAY_ADAPTER.runner,
                    `--mask=${overlayMask}`,
                    `--symbol=${symbol}`,
                    `--start=${split.start}`,
                    `--end=${split.end}`,
                    `--min-consensus=${minConsensus}`,
                    `--max-position-pct-equity=${cap}`,
                    `--funding-input=${resolve(REPO_ROOT, grids.overlay.fundingInput)}`,
                    `--output=${rawOutput}`,
                  ],
                }),
              );
            }
      continue;
    }
    for (const split of selectedSplits)
      for (const symbol of dpc.symbols)
        for (const minConsensus of dpc.minConsensus)
          for (const cap of dpc.maxPositionPctEquity) {
            const runId = `dpc-${split.id}-${symbolId(symbol)}-${minConsensus}of2-cap${compact(cap)}`;
            const rawOutput = outputFor(outputDir, runId);
            jobs.push(
              readyJob({
                runId,
                componentMask: combination.mask,
                enabledComponents: combination.enabled,
                strategyId: "donchian_pivot_composition",
                parameters: {
                  symbol,
                  timeframe: dpc.timeframe,
                  initialEquityUsd: dpc.initialEquityUsd,
                  minConsensus,
                  maxPositionPctEquity: cap,
                },
                split,
                rawOutput,
                inputFiles: [
                  `data/ohlcv/binance_${symbolId(symbol)}_15m.csv`,
                  `data/ohlcv/binance_${symbolId(symbol)}_4h.csv`,
                  `data/ohlcv/binance_${symbolId(symbol)}_1d.csv`,
                ],
                command: [
                  "bun",
                  "run",
                  "packages/backtest-tools/src/cli/run-donchian-pivot-composition.ts",
                  `--symbol=${symbol}`,
                  `--timeframe=${dpc.timeframe}`,
                  `--equity=${dpc.initialEquityUsd}`,
                  `--min-consensus=${minConsensus}`,
                  `--max-position-pct-equity=${cap}`,
                  `--start=${split.start}`,
                  `--end=${split.end}`,
                  `--output=${rawOutput}`,
                ],
              }),
            );
          }
  }
  return manifestEnvelope(
    requestedPhases,
    matrix.map((row) => row.mask),
    jobs,
    outputDir,
    true,
  );
}

async function probeOverlayAdapter(): Promise<{ readonly ready: boolean; readonly reason: string }> {
  const runnerPath = resolve(REPO_ROOT, OVERLAY_ADAPTER.runner);
  try {
    await access(runnerPath);
  } catch {
    return { ready: false, reason: `Adapter inaktív: nem létezik ${OVERLAY_ADAPTER.runner}` };
  }
  const help = Bun.spawnSync(["bun", "run", OVERLAY_ADAPTER.runner, "--help"], {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const helpText = `${help.stdout.toString()}\n${help.stderr.toString()}`;
  if (help.exitCode !== 0 || !OVERLAY_ADAPTER.requiredHelpTokens.every((token) => helpText.includes(token))) {
    return {
      ready: false,
      reason:
        "Adapter inaktív: a --help szerződés vagy a kötelező --smoke/--mask/--symbol/--output/--start/--end flag hiányzik",
    };
  }
  const temp = await mkdtemp(resolve(tmpdir(), "overlay-adapter-smoke-"));
  const smokeOutput = resolve(temp, "smoke.json");
  try {
    const smoke = Bun.spawnSync(
      ["bun", "run", OVERLAY_ADAPTER.runner, "--smoke", `--output=${smokeOutput}`],
      { cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe" },
    );
    if (smoke.exitCode !== 0)
      return { ready: false, reason: "Adapter inaktív: a CLI smoke futás hibával állt le" };
    const document = JSON.parse(await readFile(smokeOutput, "utf8")) as unknown;
    if (!isObject(document))
      return { ready: false, reason: "Adapter inaktív: a smoke output nem JSON objektum" };
    return { ready: true, reason: "A később telepített overlay adapter help és smoke szerződése érvényes" };
  } catch (error) {
    return {
      ready: false,
      reason: `Adapter inaktív: hibás smoke output (${error instanceof Error ? error.message : String(error)})`,
    };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

export async function buildRunnableManifest(
  gridsPath: string,
  requestedPhases: readonly string[],
  requestedStrategies: readonly string[],
  outputDir: string,
): Promise<Readonly<Record<string, unknown>>> {
  const grids = parseGrids(await readJson(gridsPath));
  const selectedSplits = selectSplits(grids.splits, requestedPhases);
  const jobs: SearchJob[] = [];
  for (const strategyId of requestedStrategies) {
    if (strategyId === "overlay_combination") {
      const adapter = await probeOverlayAdapter();
      const g = grids.overlay;
      for (const split of selectedSplits)
        for (const mask of g.masks)
          for (const symbol of g.symbols)
            for (const minConsensus of g.minConsensus)
              for (const cap of g.maxPositionPctEquity) {
                const runId = `overlay-${split.id}-${mask}-${symbolId(symbol)}-${minConsensus}of2-cap${compact(cap)}`;
                const usesSolFlip = mask.includes("solflip");
                const parameters = { mask, symbol, minConsensus, maxPositionPctEquity: cap };
                if (usesSolFlip && symbol !== "SOL/USDT") {
                  jobs.push({
                    runId,
                    componentMask: mask,
                    enabledComponents: mask.split("-"),
                    strategyId,
                    status: "INVALID_MASK",
                    reason: `${mask} csak SOL/USDT szimbólummal érvényes; BTC/ETH nem kezelhető no-opként`,
                    parameters,
                    split,
                    command: null,
                    rawOutput: null,
                    inputFiles: [],
                    metrics: nullMetrics(),
                  });
                  continue;
                }
                if (!g.supportedPhases.includes(split.id)) {
                  jobs.push({
                    runId,
                    componentMask: mask,
                    enabledComponents: mask.split("-"),
                    strategyId,
                    status: "UNSUPPORTED_WINDOW",
                    reason: `Az overlay CLI jelenleg csak ezt támogatja: ${g.supportedPhases.join(",")}`,
                    parameters,
                    split,
                    command: null,
                    rawOutput: null,
                    inputFiles: [],
                    metrics: nullMetrics(),
                  });
                  continue;
                }
                if (!adapter.ready) {
                  jobs.push({
                    runId,
                    componentMask: mask,
                    enabledComponents: mask.split("-"),
                    strategyId,
                    status: "UNSUPPORTED_ADAPTER",
                    reason: adapter.reason,
                    parameters,
                    split,
                    command: null,
                    rawOutput: null,
                    inputFiles: [],
                    metrics: nullMetrics(),
                  });
                  continue;
                }
                const rawOutput = outputFor(outputDir, runId);
                const inputFiles = [
                  `data/ohlcv/binance_${symbolId(symbol)}_15m.csv`,
                  `data/ohlcv/binance_${symbolId(symbol)}_4h.csv`,
                  `data/ohlcv/binance_${symbolId(symbol)}_1d.csv`,
                  ...(usesSolFlip ? [g.fundingInput] : []),
                ];
                jobs.push(
                  readyJob({
                    runId,
                    componentMask: mask,
                    enabledComponents: mask.split("-"),
                    strategyId,
                    parameters,
                    split,
                    rawOutput,
                    inputFiles,
                    command: [
                      "bun",
                      "run",
                      OVERLAY_ADAPTER.runner,
                      `--mask=${mask}`,
                      `--symbol=${symbol}`,
                      `--start=${split.start}`,
                      `--end=${split.end}`,
                      `--min-consensus=${minConsensus}`,
                      `--max-position-pct-equity=${cap}`,
                      `--funding-input=${resolve(REPO_ROOT, g.fundingInput)}`,
                      `--output=${rawOutput}`,
                    ],
                  }),
                );
              }
      continue;
    }
    if (!RUNNABLE_STRATEGIES.includes(strategyId as (typeof RUNNABLE_STRATEGIES)[number]))
      throw new Error(`Ismeretlen strategy: ${strategyId}`);
    for (const split of selectedSplits) {
      if (strategyId === "donchian_pivot_composition") {
        const g = grids.dpc;
        for (const symbol of g.symbols)
          for (const minConsensus of g.minConsensus)
            for (const cap of g.maxPositionPctEquity) {
              const runId = `dpc-${split.id}-${symbolId(symbol)}-${minConsensus}of2-cap${compact(cap)}`;
              const rawOutput = outputFor(outputDir, runId);
              jobs.push(
                readyJob({
                  runId,
                  componentMask: "10000",
                  enabledComponents: [strategyId],
                  strategyId,
                  parameters: {
                    symbol,
                    timeframe: g.timeframe,
                    initialEquityUsd: g.initialEquityUsd,
                    minConsensus,
                    maxPositionPctEquity: cap,
                  },
                  split,
                  rawOutput,
                  inputFiles: [
                    `data/ohlcv/binance_${symbolId(symbol)}_15m.csv`,
                    `data/ohlcv/binance_${symbolId(symbol)}_4h.csv`,
                    `data/ohlcv/binance_${symbolId(symbol)}_1d.csv`,
                  ],
                  command: [
                    "bun",
                    "run",
                    "packages/backtest-tools/src/cli/run-donchian-pivot-composition.ts",
                    `--symbol=${symbol}`,
                    `--timeframe=${g.timeframe}`,
                    `--equity=${g.initialEquityUsd}`,
                    `--min-consensus=${minConsensus}`,
                    `--max-position-pct-equity=${cap}`,
                    `--start=${split.start}`,
                    `--end=${split.end}`,
                    `--output=${rawOutput}`,
                  ],
                }),
              );
            }
      } else if (strategyId === "donchian_range_channel") {
        const g = grids.drc;
        for (const symbol of g.symbols)
          for (const donchianPeriod of g.donchianPeriod)
            for (const adxTrendThreshold of g.adxTrendThreshold) {
              const runId = `drc-${split.id}-${symbolId(symbol)}-dc${donchianPeriod}-adx${compact(adxTrendThreshold)}`;
              const rawOutput = outputFor(outputDir, runId);
              jobs.push(
                readyJob({
                  runId,
                  componentMask: "ablation",
                  enabledComponents: [strategyId],
                  strategyId,
                  parameters: {
                    symbol,
                    timeframe: g.timeframe,
                    initialEquityUsd: g.initialEquityUsd,
                    donchianPeriod,
                    adxTrendThreshold,
                  },
                  split,
                  rawOutput,
                  inputFiles: [
                    `data/ohlcv/binance_${symbolId(symbol)}_15m.csv`,
                    `data/ohlcv/binance_${symbolId(symbol)}_4h.csv`,
                    `data/ohlcv/binance_${symbolId(symbol)}_1d.csv`,
                  ],
                  command: [
                    "bun",
                    "run",
                    "packages/backtest-tools/src/cli/run-donchian-range-baseline.ts",
                    `--symbol=${symbol}`,
                    `--timeframe=${g.timeframe}`,
                    `--equity=${g.initialEquityUsd}`,
                    `--donchian-period=${donchianPeriod}`,
                    `--adx-trend-threshold=${adxTrendThreshold}`,
                    `--start=${split.start}`,
                    `--end=${split.end}`,
                    `--output=${rawOutput}`,
                  ],
                }),
              );
            }
      } else if (strategyId === "pivot_point_grid") {
        const g = grids.pivot;
        for (const symbol of g.symbols)
          for (const cap of g.maxPositionPctEquity) {
            const runId = `pivot-${split.id}-${symbolId(symbol)}-cap${compact(cap)}`;
            const rawOutput = outputFor(outputDir, runId);
            jobs.push(
              readyJob({
                runId,
                componentMask: "ablation",
                enabledComponents: [strategyId],
                strategyId,
                parameters: {
                  symbol,
                  timeframe: g.timeframe,
                  initialEquityUsd: g.initialEquityUsd,
                  maxPositionPctEquity: cap,
                },
                split,
                rawOutput,
                inputFiles: [
                  `data/ohlcv/binance_${symbolId(symbol)}_15m.csv`,
                  `data/ohlcv/binance_${symbolId(symbol)}_4h.csv`,
                  `data/ohlcv/binance_${symbolId(symbol)}_1d.csv`,
                ],
                command: [
                  "bun",
                  "run",
                  "packages/backtest-tools/src/cli/run-pivot-grid-baseline.ts",
                  `--symbol=${symbol}`,
                  `--timeframe=${g.timeframe}`,
                  `--equity=${g.initialEquityUsd}`,
                  `--max-position-pct-equity=${cap}`,
                  `--start=${split.start}`,
                  `--end=${split.end}`,
                  `--output=${rawOutput}`,
                ],
              }),
            );
          }
      } else if (strategyId === "ohlc_trend") {
        const g = grids.ohlcTrend;
        for (const symbol of g.symbols)
          for (const timeframe of g.timeframe)
            for (const [fastEma, slowEma] of g.emaPairs)
              for (const atrStopMultiplier of g.atrStopMultiplier)
                for (const rewardToRisk of g.rewardToRisk)
                  for (const crossLookback of g.crossLookback) {
                    const runId = `ohlc-${split.id}-${symbolId(symbol)}-${timeframe}-ema${fastEma}-${slowEma}-atr${compact(atrStopMultiplier)}-rr${compact(rewardToRisk)}-x${crossLookback}`;
                    const rawOutput = outputFor(outputDir, runId);
                    jobs.push(
                      readyJob({
                        runId,
                        componentMask: "non-production",
                        enabledComponents: [strategyId],
                        strategyId,
                        parameters: {
                          symbol,
                          timeframe,
                          initialEquityUsd: g.initialEquityUsd,
                          fastEma,
                          slowEma,
                          atrStopMultiplier,
                          rewardToRisk,
                          crossLookback,
                        },
                        split,
                        rawOutput,
                        inputFiles: [`data/ohlcv/binance_${symbolId(symbol)}_${timeframe}.csv`],
                        command: [
                          "bun",
                          "run",
                          "packages/backtest-tools/src/cli/run-ohlc-trend-baseline.ts",
                          `--symbol=${symbol}`,
                          `--timeframe=${timeframe}`,
                          `--equity=${g.initialEquityUsd}`,
                          `--fast-ema=${fastEma}`,
                          `--slow-ema=${slowEma}`,
                          `--atr-stop-multiplier=${atrStopMultiplier}`,
                          `--reward-to-risk=${rewardToRisk}`,
                          `--cross-lookback=${crossLookback}`,
                          `--start=${split.start}`,
                          `--end=${split.end}`,
                          `--output=${rawOutput}`,
                        ],
                      }),
                    );
                  }
      } else {
        const g = grids.solFlip;
        for (const signFlipWindowDays of g.signFlipWindowDays)
          for (const extremeSigmaThreshold of g.extremeSigmaThreshold)
            for (const persistenceDays of g.persistenceDays)
              for (const volWindowDays of g.volWindowDays) {
                const runId = `solflip-${split.id}-flip${compact(signFlipWindowDays)}-sigma${compact(extremeSigmaThreshold)}-persist${compact(persistenceDays)}-vol${compact(volWindowDays)}`;
                const rawOutput = outputFor(outputDir, runId);
                jobs.push(
                  readyJob({
                    runId,
                    componentMask: "00010",
                    enabledComponents: [strategyId],
                    strategyId,
                    parameters: {
                      signFlipWindowDays,
                      extremeSigmaThreshold,
                      persistenceDays,
                      volWindowDays,
                      pnlApplicable: false,
                    },
                    split,
                    rawOutput,
                    inputFiles: [g.input],
                    command: [
                      "bun",
                      "run",
                      "packages/backtest-tools/src/cli/run-sol-flip-funding-replay.ts",
                      `--input=${resolve(REPO_ROOT, g.input)}`,
                      `--sign-flip-window-days=${signFlipWindowDays}`,
                      `--extreme-sigma-threshold=${extremeSigmaThreshold}`,
                      `--persistence-days=${persistenceDays}`,
                      `--vol-window-days=${volWindowDays}`,
                      `--start=${split.start}`,
                      `--end=${split.end}`,
                      `--output=${rawOutput}`,
                    ],
                  }),
                );
              }
      }
    }
  }
  return manifestEnvelope(requestedPhases, [], jobs, outputDir, true, requestedStrategies);
}

function manifestEnvelope(
  phases: readonly string[],
  representedMasks: readonly string[],
  jobs: readonly SearchJob[],
  outputDir: string,
  dryRun: boolean,
  strategies?: readonly string[],
): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: 2,
    dryRun,
    generatedAt: new Date().toISOString(),
    codeRevision: gitRevision(),
    dataSnapshot: "search-best-config/data-snapshot.json",
    phases,
    ...(strategies === undefined
      ? { combinationCount: representedMasks.length, representedMasks }
      : { strategies }),
    outputDir: relative(REPO_ROOT, outputDir) || ".",
    jobs,
  };
}

interface CliOptions {
  readonly execute: boolean;
  readonly strategies: readonly string[];
  readonly phases: readonly string[];
  readonly concurrency: number;
  readonly resume: boolean;
  readonly outputDir: string;
  readonly output: string;
}

function parseBoolean(name: string, raw: string): boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`--${name}=true|false alakú legyen`);
}

export function parseRunSearchArgs(argv: readonly string[]): CliOptions {
  const values = new Map<string, string>();
  let execute = false;
  for (const arg of argv) {
    if (arg === "--execute") {
      execute = true;
      continue;
    }
    if (!arg.startsWith("--") || !arg.includes("=")) throw new Error(`Ismeretlen argumentum: ${arg}`);
    const equals = arg.indexOf("=");
    const name = arg.slice(2, equals);
    const value = arg.slice(equals + 1);
    if (!["execute", "strategy", "phase", "concurrency", "resume", "output-dir", "output"].includes(name))
      throw new Error(`Ismeretlen argumentum: --${name}`);
    values.set(name, value);
  }
  if (values.has("execute")) execute = parseBoolean("execute", values.get("execute") ?? "");
  const concurrency = Number(values.get("concurrency") ?? "1");
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 64)
    throw new Error("--concurrency 1 és 64 közötti egész legyen");
  const rawStrategies = (values.get("strategy") ?? "production")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const strategies = rawStrategies.flatMap((item) =>
    item === "all" || item === "all-runnable"
      ? [...RUNNABLE_STRATEGIES, "overlay_combination"]
      : [STRATEGY_ALIASES[item] ?? item],
  );
  if (new Set(strategies).size !== strategies.length)
    throw new Error("A --strategy lista ismételt elemet tartalmaz");
  const phases = (values.get("phase") ?? "is,validation,oos")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const outputDir = resolve(REPO_ROOT, values.get("output-dir") ?? "search-best-config/results");
  const output = resolve(REPO_ROOT, values.get("output") ?? resolve(outputDir, "run-manifest.json"));
  return {
    execute,
    strategies,
    phases,
    concurrency,
    resume: parseBoolean("resume", values.get("resume") ?? "true"),
    outputDir,
    output,
  };
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const options = parseRunSearchArgs(argv);
  const gridsPath = resolve(REPO_ROOT, "search-best-config/grids.json");
  const productionMode = options.strategies.length === 1 && options.strategies[0] === "production";
  let manifest = productionMode
    ? await buildSearchManifest(gridsPath, options.phases, options.outputDir)
    : await buildRunnableManifest(gridsPath, options.phases, options.strategies, options.outputDir);
  await writeText(options.output, `${JSON.stringify(manifest, null, 2)}\n`);
  const initialJobs = manifest["jobs"];
  if (!Array.isArray(initialJobs)) throw new Error("A manifest jobs mezője hibás");
  if (!options.execute) {
    console.log(`DRY-RUN: ${initialJobs.length} job/status sor → ${options.output}`);
    return;
  }
  const code = captureCodeProvenance();
  const executionOptions: ExecutionOptions = {
    outputDir: options.outputDir,
    snapshotPath: resolve(REPO_ROOT, "search-best-config/data-snapshot.json"),
    concurrency: options.concurrency,
    resume: options.resume,
    codeRevision: code.codeRevision,
    dirtyDiffSha256: code.dirtyDiffSha256,
  };
  const executedJobs = await executeSearchJobs(initialJobs as SearchJob[], executionOptions);
  const failed = executedJobs.filter((job) => job.status.startsWith("FAILED"));
  manifest = {
    ...manifest,
    dryRun: false,
    executedAt: new Date().toISOString(),
    codeRevision: code.codeRevision,
    dirtyDiffSha256: code.dirtyDiffSha256,
    jobs: executedJobs,
  };
  await writeText(options.output, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `EXECUTE: ${executedJobs.length} sor, ${failed.length} FAILED, concurrency=${options.concurrency} → ${options.output}`,
  );
  if (failed.length > 0) process.exitCode = 2;
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
