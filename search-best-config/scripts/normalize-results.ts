import { basename, relative, resolve } from "node:path";
import { readFile } from "node:fs/promises";

import {
  asBoolean,
  asNumber,
  asString,
  getArg,
  isObject,
  listJsonFiles,
  parseNamedArgs,
  REPO_ROOT,
  writeText,
  type JsonObject,
} from "./common.js";

export interface NormalizedMetrics {
  readonly totalReturnPct: number | null;
  readonly monthlyReturnPct: number | null;
  readonly annualizedReturnPct: number | null;
  readonly maxDrawdownPct: number | null;
  readonly sharpe: number | null;
  readonly sortino: number | null;
  readonly profitFactor: number | "Infinity" | null;
  readonly winRatePct: number | null;
  readonly totalTrades: number | null;
  readonly killSwitchTriggered: boolean | null;
}

export interface NormalizedResult {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly status: string;
  readonly reason: string | null;
  readonly strategyId: string;
  readonly componentMask: string | null;
  readonly symbol: string | null;
  readonly codeRevision: string | null;
  readonly parameters: JsonObject;
  readonly split: { readonly name: string | null; readonly start: string | null; readonly end: string | null };
  readonly dataInputs: readonly unknown[];
  readonly coverage: JsonObject;
  readonly metrics: NormalizedMetrics;
  readonly extendedMetrics: JsonObject;
  readonly provenance: JsonObject;
  readonly rawOutput: string;
}

function percent(value: unknown): number | null {
  const number = asNumber(value);
  return number === null ? null : number * 100;
}

function normalizedMetric(value: unknown): number | null {
  return asNumber(value);
}

function normalizedProfitFactor(value: unknown): number | "Infinity" | null {
  if (value === "Infinity") return value;
  return normalizedMetric(value);
}

function profitFactorFromResult(result: JsonObject): number | "Infinity" | null {
  const direct = normalizedProfitFactor(result["profitFactor"]);
  if (direct !== null) return direct;
  const trades = result["trades"];
  if (!Array.isArray(trades)) return null;
  let grossProfit = 0;
  let grossLoss = 0;
  for (const trade of trades) {
    if (!isObject(trade)) continue;
    const pnl = asNumber(trade["pnlUsd"]);
    if (pnl === null) continue;
    if (pnl > 0) grossProfit += pnl;
    else if (pnl < 0) grossLoss += Math.abs(pnl);
  }
  if (grossLoss > 0) return grossProfit / grossLoss;
  return grossProfit > 0 ? "Infinity" : null;
}

function emptyMetrics(): NormalizedMetrics {
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

function metricsFromNormalized(value: JsonObject): NormalizedMetrics {
  return {
    totalReturnPct: normalizedMetric(value["totalReturnPct"]),
    monthlyReturnPct: normalizedMetric(value["monthlyReturnPct"]),
    annualizedReturnPct: normalizedMetric(value["annualizedReturnPct"]),
    maxDrawdownPct: normalizedMetric(value["maxDrawdownPct"]),
    sharpe: normalizedMetric(value["sharpe"]),
    sortino: normalizedMetric(value["sortino"]),
    profitFactor: normalizedProfitFactor(value["profitFactor"]),
    winRatePct: normalizedMetric(value["winRatePct"]),
    totalTrades: normalizedMetric(value["totalTrades"]),
    killSwitchTriggered: asBoolean(value["killSwitchTriggered"]),
  };
}

function inferSplit(value: JsonObject, args: JsonObject): NormalizedResult["split"] {
  const explicit = value["split"];
  if (isObject(explicit)) {
    return {
      name: asString(explicit["name"]) ?? asString(explicit["id"]),
      start: asString(explicit["start"]),
      end: asString(explicit["end"]),
    };
  }
  const start = asString(args["startTime"]) ?? asString(args["start"]);
  const end = asString(args["endTime"]) ?? asString(args["end"]);
  let name: string | null = null;
  if (start?.startsWith("2024-01-01") === true && end?.startsWith("2025-07-01") === true) name = "is";
  else if (start?.startsWith("2024-01-01") === true && end?.startsWith("2026-07-09") === true) name = "full";
  else if (start?.startsWith("2025-07-01") === true && end?.startsWith("2026-01-01") === true) name = "validation";
  else if (start?.startsWith("2026-01-01") === true && end?.startsWith("2026-07-09") === true) name = "oos";
  else if (start !== null || end !== null) name = "custom";
  return { name, start, end };
}

function failedResult(rawOutput: string, runId: string, reason: string): NormalizedResult {
  return {
    schemaVersion: 1,
    runId,
    status: "FAILED_PARSE",
    reason,
    strategyId: "unknown",
    componentMask: null,
    symbol: null,
    codeRevision: null,
    parameters: {},
    split: { name: null, start: null, end: null },
    dataInputs: [],
    coverage: {},
    metrics: emptyMetrics(),
    extendedMetrics: {},
    provenance: {},
    rawOutput,
  };
}

function normalizeObject(value: JsonObject, rawOutput: string, inheritedRevision: string | null = null): NormalizedResult {
  const args = isObject(value["args"]) ? value["args"] : {};
  const parameters = isObject(value["parameters"]) ? value["parameters"] : args;
  const rawMetrics = isObject(value["metrics"]) ? value["metrics"] : null;
  const result = isObject(value["result"]) ? value["result"] : {};
  const strategyId = asString(value["strategyId"])
    ?? asString(value["strategy"])
    ?? (isObject(value["detectorResult"]) ? "cascade_fade" : null)
    ?? ("dydxHourlyCount" in value ? "dydx_cex_carry" : "unknown");
  const runId = asString(value["runId"]) ?? basename(rawOutput, ".json");
  const explicitStatus = asString(value["status"]);
  let status = explicitStatus ?? "LEGACY_UNVERIFIED_PROVENANCE";
  let reason = asString(value["reason"])
    ?? (explicitStatus === null ? "Az artifact nem rögzít code revisiont és input-adathash kapcsolatot." : null);
  const dataInputs = Array.isArray(value["dataInputs"]) ? value["dataInputs"] : [];
  let coverage: JsonObject = isObject(value["coverage"]) ? value["coverage"] : {};
  if (Object.keys(coverage).length === 0 && isObject(value["inputProvenance"])) coverage = value["inputProvenance"];
  if (Object.keys(coverage).length === 0 && isObject(value["data"])) coverage = value["data"];
  const derivedMetrics = isObject(value["derivedMetrics"]) ? value["derivedMetrics"] : {};
  const overlayMetrics = isObject(value["overlayMetrics"]) ? value["overlayMetrics"] : {};
  const explicitExtendedMetrics = isObject(value["extendedMetrics"]) ? value["extendedMetrics"] : {};

  const dataSource = asString(value["dataSource"]);
  if (dataSource?.toLowerCase().includes("synthetic") === true) {
    status = "UNSUPPORTED_SYNTHETIC";
    reason = dataSource;
  }

  const windowDays = asNumber(value["windowDays"]);
  const dydxHourlyCount = asNumber(value["dydxHourlyCount"]);
  if (strategyId === "dydx_cex_carry" && windowDays !== null && dydxHourlyCount !== null) {
    const expectedHourlyCount = windowDays * 24;
    const hourlyCoverageRatio = expectedHourlyCount > 0 ? dydxHourlyCount / expectedHourlyCount : 0;
    const dataSufficientDays = asNumber(result["dataSufficientDays"]);
    const dailyCoverageRatio = dataSufficientDays === null || windowDays <= 0 ? null : dataSufficientDays / windowDays;
    const reportedSufficient = asBoolean(coverage["sufficient"]);
    coverage = { ...coverage, windowDays, dydxHourlyCount, expectedHourlyCount, hourlyCoverageRatio, dataSufficientDays, dailyCoverageRatio };
    if (reportedSufficient === false || hourlyCoverageRatio < 0.9 || dailyCoverageRatio === null || dailyCoverageRatio < 0.9) {
      status = "FAILED_DATA_COVERAGE";
      reason = `dYdX coverage elégtelen: órás ${(hourlyCoverageRatio * 100).toFixed(2)}%, napi ${dailyCoverageRatio === null ? "N/A" : `${(dailyCoverageRatio * 100).toFixed(2)}%`} (mindkettő minimum 90%)`;
    }
  }

  const metrics: NormalizedMetrics = rawMetrics !== null && value["schemaVersion"] === 1
    ? metricsFromNormalized(rawMetrics)
    : {
        totalReturnPct: percent(result["totalReturn"]),
        monthlyReturnPct: percent(value["monthlyReturn"] ?? derivedMetrics["monthlyReturn"] ?? result["monthlyCarry"]),
        annualizedReturnPct: percent(result["annualizedReturn"]),
        maxDrawdownPct: percent(result["maxDrawdown"]),
        sharpe: asNumber(result["sharpeRatio"]),
        sortino: asNumber(result["sortinoRatio"]),
        profitFactor: profitFactorFromResult(result),
        winRatePct: percent(result["winRate"]),
        totalTrades: asNumber(result["totalTrades"]),
        killSwitchTriggered: asBoolean(result["killSwitchTriggered"]),
      };
  return {
    schemaVersion: 1,
    runId,
    status,
    reason,
    strategyId,
    componentMask: asString(value["componentMask"]),
    symbol: asString(parameters["symbol"]),
    codeRevision: asString(value["codeRevision"]) ?? inheritedRevision,
    parameters,
    split: inferSplit(value, args),
    dataInputs,
    coverage,
    metrics,
    extendedMetrics: { ...explicitExtendedMetrics, ...(rawMetrics !== null && value["schemaVersion"] !== 1 ? { runnerMetrics: rawMetrics } : {}), ...(Object.keys(derivedMetrics).length > 0 ? { derivedMetrics } : {}), ...(Object.keys(overlayMetrics).length > 0 ? { overlayMetrics } : {}) },
    provenance: isObject(value["provenance"]) ? value["provenance"] : {},
    rawOutput: asString(value["rawOutput"]) ?? rawOutput,
  };
}

export function normalizeDocument(value: unknown, rawOutput: string): readonly NormalizedResult[] {
  if (Array.isArray(value)) {
    return value.map((entry, index) => isObject(entry)
      ? normalizeObject(entry, `${rawOutput}#${index}`)
      : failedResult(`${rawOutput}#${index}`, `${basename(rawOutput)}-${index}`, "A tömbelem nem objektum"));
  }
  if (!isObject(value)) return [failedResult(rawOutput, basename(rawOutput), "A JSON gyökér nem objektum vagy tömb")];
  if (Array.isArray(value["jobs"])) {
    const revision = asString(value["codeRevision"]);
    return value["jobs"].map((job, index) => isObject(job)
      ? normalizeObject(job, `${rawOutput}#jobs[${index}]`, revision)
      : failedResult(`${rawOutput}#jobs[${index}]`, `${basename(rawOutput)}-job-${index}`, "A job nem objektum"));
  }
  return [normalizeObject(value, rawOutput)];
}

export async function normalizeFiles(inputPath: string): Promise<readonly NormalizedResult[]> {
  const files = await listJsonFiles(inputPath);
  const executionManifests: { readonly file: string; readonly value: JsonObject }[] = [];
  for (const file of files) {
    if (file.endsWith(".provenance.json")) continue;
    try {
      const value = JSON.parse(await readFile(file, "utf8")) as unknown;
      if (isObject(value) && value["dryRun"] === false && Array.isArray(value["jobs"])) executionManifests.push({ file, value });
    } catch {
      // A normál feldolgozás lent FAILED_PARSE sort készít.
    }
  }
  if (executionManifests.length > 0) {
    const rows: NormalizedResult[] = [];
    for (const manifest of executionManifests) rows.push(...await normalizeExecutionManifest(manifest.value, manifest.file));
    return rows;
  }
  const rows: NormalizedResult[] = [];
  for (const file of files) {
    if (file.endsWith(".provenance.json")) continue;
    const rawOutput = relative(REPO_ROOT, file);
    try {
      const raw = await readFile(file, "utf8");
      rows.push(...normalizeDocument(JSON.parse(raw) as unknown, rawOutput));
    } catch (error) {
      rows.push(failedResult(rawOutput, basename(file, ".json"), error instanceof Error ? error.message : String(error)));
    }
  }
  return rows;
}

async function normalizeExecutionManifest(manifest: JsonObject, manifestPath: string): Promise<readonly NormalizedResult[]> {
  const jobs = manifest["jobs"];
  if (!Array.isArray(jobs)) return [failedResult(relative(REPO_ROOT, manifestPath), basename(manifestPath), "A végrehajtási manifest jobs mezője hibás")];
  const inheritedRevision = asString(manifest["codeRevision"]);
  const rows: NormalizedResult[] = [];
  for (let index = 0; index < jobs.length; index++) {
    const job = jobs[index];
    const manifestRef = `${relative(REPO_ROOT, manifestPath)}#jobs[${index}]`;
    if (!isObject(job)) {
      rows.push(failedResult(manifestRef, `${basename(manifestPath)}-job-${index}`, "A job nem objektum"));
      continue;
    }
    const rawOutput = asString(job["rawOutput"]);
    const provenancePath = asString(job["provenancePath"]);
    let provenance: JsonObject = {};
    if (provenancePath !== null) {
      try {
        const parsed = JSON.parse(await readFile(resolve(REPO_ROOT, provenancePath), "utf8")) as unknown;
        if (isObject(parsed)) provenance = parsed;
      } catch {
        provenance = { missingOrInvalid: provenancePath };
      }
    }
    const status = asString(job["status"]);
    if ((status === "SUCCESS" || status === "RESUMED") && rawOutput !== null) {
      try {
        const raw = JSON.parse(await readFile(resolve(REPO_ROOT, rawOutput), "utf8")) as unknown;
        if (!isObject(raw)) throw new Error("A raw output gyökere nem objektum");
        rows.push(normalizeObject({
          ...raw,
          runId: job["runId"],
          strategyId: job["strategyId"],
          componentMask: job["componentMask"],
          status,
          reason: job["reason"],
          parameters: job["parameters"],
          split: job["split"],
          codeRevision: inheritedRevision,
          dataInputs: Array.isArray(provenance["inputHashes"]) ? provenance["inputHashes"] : job["inputFiles"],
          provenance,
          rawOutput,
        }, rawOutput, inheritedRevision));
      } catch (error) {
        rows.push(normalizeObject({ ...job, status: "FAILED_PARSE", reason: `A sikeres job raw outputja nem olvasható: ${error instanceof Error ? error.message : String(error)}`, codeRevision: inheritedRevision, provenance }, manifestRef, inheritedRevision));
      }
      continue;
    }
    rows.push(normalizeObject({ ...job, codeRevision: inheritedRevision, provenance }, manifestRef, inheritedRevision));
  }
  return rows;
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const args = parseNamedArgs(argv);
  const input = resolve(REPO_ROOT, getArg(args, "input", "backtest-results"));
  const output = resolve(REPO_ROOT, getArg(args, "output", "search-best-config/results/normalized.ndjson"));
  const rows = await normalizeFiles(input);
  await writeText(output, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length > 0 ? "\n" : ""));
  console.log(`PASS: ${rows.length} normalizált sor → ${output}`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
