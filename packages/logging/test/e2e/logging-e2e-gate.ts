// eslint-disable-next-line unicorn/import-style -- Bun's node:path declaration only exposes typed named imports under the E2E project's configured type roots.
import { relative, resolve } from "node:path";

import coveragePackage from "istanbul-lib-coverage";
import type {
  BranchMapping,
  CoverageMapData,
  CoverageSummaryData,
  FileCoverageData,
  FunctionMapping,
  Location,
  Range,
  Totals,
} from "istanbul-lib-coverage";

import {
  REPOSITORY_ROOT,
  absoluteRuntimeFiles,
  type LoggingEndToEndScopeManifest,
} from "./logging-e2e-scope.ts";
// eslint-disable-next-line unicorn/name-replacements -- Established public E2E artifact contract.
import { type LoggingE2eArtifactRun } from "./logging-e2e-artifact-run.ts";
// eslint-disable-next-line unicorn/name-replacements -- Established public E2E artifact contract.
import { readAdoptedRawLoggingE2eArtifacts } from "./logging-e2e-raw-artifact-ingestion.ts";

const createCoverageMap = coveragePackage.createCoverageMap.bind(coveragePackage);
type CoverageMetric = "statements" | "branches" | "functions" | "lines";

export interface LoggingEndToEndCoverageSummary {
  readonly schemaVersion: 1;
  readonly label: "logging-subprocess-e2e";
  readonly rawFileCount: number;
  readonly caseIds: readonly string[];
  readonly scope: readonly string[];
  readonly total: CoverageSummaryData;
  readonly files: Readonly<Record<string, CoverageSummaryData>>;
  readonly passed: boolean;
  readonly failures: readonly CoverageMetric[];
}

interface CoverageEnvelope {
  readonly schemaVersion: 1;
  readonly pid: number;
  readonly caseId: string;
  readonly coverage: Readonly<Record<string, unknown>>;
}

const METRICS: readonly CoverageMetric[] = ["statements", "branches", "functions", "lines"];
const JSON_FILE_SUFFIX = ".json";
const MAX_RAW_FILE_BYTES = 32 * 1024 * 1024;

function assertPlainObject(candidate: unknown, label: string): asserts candidate is Record<string, unknown> {
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error(`${label} must be a JSON object.`);
  }
}

function assertExactKeys(
  candidate: Record<string, unknown>,
  expectedKeys: readonly string[],
  label: string,
): void {
  if (
    Object.keys(candidate).length !== expectedKeys.length ||
    expectedKeys.some((expectedKey) => !Object.hasOwn(candidate, expectedKey))
  ) {
    throw new Error(`${label} must contain exactly: ${expectedKeys.join(", ")}.`);
  }
}

function assertNonNegativeSafeInteger(candidate: unknown, label: string): number {
  if (typeof candidate !== "number" || !Number.isSafeInteger(candidate) || candidate < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return candidate;
}

function parseLocation(candidate: unknown, label: string): Location {
  assertPlainObject(candidate, label);
  assertExactKeys(candidate, ["line", "column"], label);
  const line = assertNonNegativeSafeInteger(candidate["line"], `${label}.line`);
  const column = assertNonNegativeSafeInteger(candidate["column"], `${label}.column`);
  if (line === 0) throw new Error(`${label}.line must be positive.`);
  return { line, column };
}

function parseRange(candidate: unknown, label: string): Range {
  assertPlainObject(candidate, label);
  assertExactKeys(candidate, ["start", "end"], label);
  return {
    start: parseLocation(candidate["start"], `${label}.start`),
    end: parseLocation(candidate["end"], `${label}.end`),
  };
}

function isEmptyImplicitBranchLocationRange(candidate: Record<string, unknown>): boolean {
  const start = candidate["start"];
  const end = candidate["end"];
  return (
    start !== null &&
    typeof start === "object" &&
    !Array.isArray(start) &&
    Object.keys(start).length === 0 &&
    end !== null &&
    typeof end === "object" &&
    !Array.isArray(end) &&
    Object.keys(end).length === 0
  );
}

function parseRangeMap(candidate: unknown, label: string): Record<string, Range> {
  assertPlainObject(candidate, label);
  const parsedRanges = new Map<string, Range>();
  for (const [identifier, range] of Object.entries(candidate)) {
    parsedRanges.set(identifier, parseRange(range, `${label}.${identifier}`));
  }
  return Object.fromEntries(parsedRanges);
}

function parseFunctionMapping(candidate: unknown, label: string): FunctionMapping {
  assertPlainObject(candidate, label);
  assertExactKeys(candidate, ["name", "decl", "loc", "line"], label);
  const name = candidate["name"];
  if (typeof name !== "string") throw new Error(`${label}.name must be a string.`);
  const line = assertNonNegativeSafeInteger(candidate["line"], `${label}.line`);
  if (line === 0) throw new Error(`${label}.line must be positive.`);
  return {
    name,
    decl: parseRange(candidate["decl"], `${label}.decl`),
    loc: parseRange(candidate["loc"], `${label}.loc`),
    line,
  };
}

function parseFunctionMap(candidate: unknown, label: string): Record<string, FunctionMapping> {
  assertPlainObject(candidate, label);
  const parsedFunctions = new Map<string, FunctionMapping>();
  for (const [identifier, functionMapping] of Object.entries(candidate)) {
    parsedFunctions.set(identifier, parseFunctionMapping(functionMapping, `${label}.${identifier}`));
  }
  return Object.fromEntries(parsedFunctions);
}

function parseBranchMapping(candidate: unknown, label: string): BranchMapping {
  assertPlainObject(candidate, label);
  assertExactKeys(candidate, ["loc", "type", "locations", "line"], label);
  const type = candidate["type"];
  if (typeof type !== "string" || type.length === 0)
    throw new Error(`${label}.type must be a non-empty string.`);
  const locations = candidate["locations"];
  if (!Array.isArray(locations)) throw new Error(`${label}.locations must be an array.`);
  const line = assertNonNegativeSafeInteger(candidate["line"], `${label}.line`);
  if (line === 0) throw new Error(`${label}.line must be positive.`);
  const loc = parseRange(candidate["loc"], `${label}.loc`);
  return {
    loc,
    type,
    locations: locations.map((location, index) => {
      const locationLabel = `${label}.locations.${String(index)}`;
      assertPlainObject(location, locationLabel);
      assertExactKeys(location, ["start", "end"], locationLabel);
      return isEmptyImplicitBranchLocationRange(location) ? loc : parseRange(location, locationLabel);
    }),
    line,
  };
}

function parseBranchMap(candidate: unknown, label: string): Record<string, BranchMapping> {
  assertPlainObject(candidate, label);
  const parsedBranches = new Map<string, BranchMapping>();
  for (const [identifier, branchMapping] of Object.entries(candidate)) {
    parsedBranches.set(identifier, parseBranchMapping(branchMapping, `${label}.${identifier}`));
  }
  return Object.fromEntries(parsedBranches);
}

function parseCoverageCounterMap(candidate: unknown, label: string): Record<string, number> {
  assertPlainObject(candidate, label);
  const parsedCounters = new Map<string, number>();
  for (const [identifier, count] of Object.entries(candidate)) {
    parsedCounters.set(identifier, assertNonNegativeSafeInteger(count, `${label}.${identifier}`));
  }
  return Object.fromEntries(parsedCounters);
}

function parseBranchCounterMap(candidate: unknown, label: string): Record<string, number[]> {
  assertPlainObject(candidate, label);
  const parsedCounters = new Map<string, number[]>();
  for (const [identifier, counts] of Object.entries(candidate)) {
    if (!Array.isArray(counts)) throw new Error(`${label}.${identifier} must be an array.`);
    parsedCounters.set(
      identifier,
      counts.map((count, index) =>
        assertNonNegativeSafeInteger(count, `${label}.${identifier}.${String(index)}`),
      ),
    );
  }
  return Object.fromEntries(parsedCounters);
}

function parseFileCoverageData(candidate: unknown, expectedPath: string, label: string): FileCoverageData {
  assertPlainObject(candidate, label);
  const path = candidate["path"];
  if (typeof path !== "string" || resolve(path) !== expectedPath) {
    throw new Error(`${label}.path must equal its scoped coverage filename.`);
  }
  return {
    path: expectedPath,
    statementMap: parseRangeMap(candidate["statementMap"], `${label}.statementMap`),
    fnMap: parseFunctionMap(candidate["fnMap"], `${label}.fnMap`),
    branchMap: parseBranchMap(candidate["branchMap"], `${label}.branchMap`),
    s: parseCoverageCounterMap(candidate["s"], `${label}.s`),
    f: parseCoverageCounterMap(candidate["f"], `${label}.f`),
    b: parseBranchCounterMap(candidate["b"], `${label}.b`),
  };
}

function parseCoverageMapData(
  candidate: Readonly<Record<string, unknown>>,
  scopedFiles: ReadonlySet<string>,
  label: string,
): CoverageMapData {
  const parsedFiles = new Map<string, FileCoverageData>();
  for (const [coveredFile, rawFileCoverage] of Object.entries(candidate)) {
    const absoluteCoveredFile = resolve(coveredFile);
    if (!scopedFiles.has(absoluteCoveredFile)) {
      throw new Error(`Raw logging E2E coverage contains an out-of-scope file: ${coveredFile}.`);
    }
    parsedFiles.set(
      absoluteCoveredFile,
      parseFileCoverageData(rawFileCoverage, absoluteCoveredFile, `${label}.${coveredFile}`),
    );
  }
  return Object.fromEntries(parsedFiles);
}

function parseRawCoverageFilename(filename: string): { readonly caseId: string; readonly pid: number } {
  if (!filename.endsWith(JSON_FILE_SUFFIX)) {
    throw new Error(`Unexpected raw logging E2E coverage filename: ${filename}.`);
  }
  const stem = filename.slice(0, -JSON_FILE_SUFFIX.length);
  const delimiterIndex = stem.lastIndexOf("-");
  if (delimiterIndex <= 0) throw new Error(`Unexpected raw logging E2E coverage filename: ${filename}.`);
  const caseId = stem.slice(0, delimiterIndex);
  const pidText = stem.slice(delimiterIndex + 1);
  if (!/^[1-9][0-9]*$/u.test(pidText)) {
    throw new Error(`Unexpected raw logging E2E coverage filename: ${filename}.`);
  }
  const pid = Number(pidText);
  if (!Number.isSafeInteger(pid))
    throw new Error(`Unexpected raw logging E2E coverage filename: ${filename}.`);
  return { caseId, pid };
}

function parseCoverageEnvelope(
  contents: Uint8Array,
  filename: string,
  manifest: LoggingEndToEndScopeManifest,
): CoverageEnvelope {
  const { caseId: filenameCaseId, pid: filenamePid } = parseRawCoverageFilename(filename);
  if (contents.byteLength === 0 || contents.byteLength > MAX_RAW_FILE_BYTES) {
    throw new Error(`Raw logging E2E coverage file has an invalid size: ${filename}.`);
  }
  let parsedEnvelope: unknown;
  try {
    parsedEnvelope = JSON.parse(new TextDecoder().decode(contents));
  } catch (error: unknown) {
    throw new Error(`Malformed raw logging E2E coverage JSON ${filename}.`, { cause: error });
  }
  assertPlainObject(parsedEnvelope, `Raw logging E2E coverage envelope ${filename}`);
  assertExactKeys(
    parsedEnvelope,
    ["schemaVersion", "pid", "caseId", "coverage"],
    `Raw logging E2E coverage envelope ${filename}`,
  );
  if (parsedEnvelope["schemaVersion"] !== 1) {
    throw new Error(`Raw logging E2E coverage schemaVersion is invalid: ${filename}.`);
  }
  const pid = parsedEnvelope["pid"];
  if (typeof pid !== "number" || pid !== filenamePid || pid <= 0 || !Number.isSafeInteger(pid)) {
    throw new Error(`Raw logging E2E coverage PID does not match its filename: ${filename}.`);
  }
  const caseId = parsedEnvelope["caseId"];
  if (typeof caseId !== "string" || caseId !== filenameCaseId || !manifest.e2eCases.includes(caseId)) {
    throw new Error(`Raw logging E2E coverage case ID is invalid: ${filename}.`);
  }
  const coverage = parsedEnvelope["coverage"];
  assertPlainObject(coverage, `Raw logging E2E coverage payload ${filename}`);
  if (Object.keys(coverage).length === 0) {
    throw new Error(`Raw logging E2E coverage payload is empty: ${filename}.`);
  }
  return { schemaVersion: 1, pid, caseId, coverage };
}

function selectMetricSummary(summary: CoverageSummaryData, metric: CoverageMetric): Totals {
  switch (metric) {
    case "statements": {
      return summary.statements;
    }
    case "branches": {
      return summary.branches;
    }
    case "functions": {
      return summary.functions;
    }
    case "lines": {
      return summary.lines;
    }
  }
}

function isExactlyCovered(summary: CoverageSummaryData, metric: CoverageMetric): boolean {
  const metricSummary = selectMetricSummary(summary, metric);
  return metricSummary.covered === metricSummary.total;
}

export function collectLoggingEndToEndCoverage({
  artifactRun,
  manifest,
}: {
  readonly artifactRun: LoggingE2eArtifactRun;
  readonly manifest: LoggingEndToEndScopeManifest;
}): LoggingEndToEndCoverageSummary {
  const rawArtifacts = readAdoptedRawLoggingE2eArtifacts(artifactRun);
  const coverageMap = createCoverageMap({});
  const scopedFiles = new Set(absoluteRuntimeFiles(manifest));
  const observedCaseIds = new Set<string>();
  for (const rawArtifact of rawArtifacts) {
    const envelope = parseCoverageEnvelope(rawArtifact.contents, rawArtifact.name, manifest);
    if (observedCaseIds.has(envelope.caseId)) {
      throw new Error(`Duplicate raw logging E2E coverage case evidence: ${envelope.caseId}.`);
    }
    observedCaseIds.add(envelope.caseId);
    const coverageData = parseCoverageMapData(
      envelope.coverage,
      scopedFiles,
      `Raw logging E2E coverage payload ${rawArtifact.name}`,
    );
    coverageMap.merge(coverageData);
  }

  const coveredFiles = new Set(coverageMap.files().map((coveredFile) => resolve(coveredFile)));
  const missingSourceFiles = new Set<string>();
  for (const scopedFile of scopedFiles) {
    if (!coveredFiles.has(scopedFile)) missingSourceFiles.add(scopedFile);
  }
  if (missingSourceFiles.size > 0) {
    throw new Error(
      `Merged logging E2E coverage is missing scoped runtime sources:\n${[...missingSourceFiles].join("\n")}`,
    );
  }
  const missingCaseIds = manifest.e2eCases.filter((caseId) => !observedCaseIds.has(caseId));
  if (missingCaseIds.length > 0) {
    throw new Error(`Required logging E2E cases did not produce coverage: ${missingCaseIds.join(", ")}.`);
  }

  const total = coverageMap.getCoverageSummary().toJSON();
  const failures = METRICS.filter((metric) => !isExactlyCovered(total, metric));
  const coverageSummaries = new Map<string, CoverageSummaryData>();
  for (const scopedFile of absoluteRuntimeFiles(manifest)) {
    coverageSummaries.set(
      relative(REPOSITORY_ROOT, scopedFile),
      coverageMap.fileCoverageFor(scopedFile).toSummary().toJSON(),
    );
  }
  const files = Object.fromEntries(coverageSummaries);
  return {
    schemaVersion: 1,
    label: "logging-subprocess-e2e",
    rawFileCount: rawArtifacts.length,
    caseIds: manifest.e2eCases.filter((caseId) => observedCaseIds.has(caseId)),
    scope: manifest.runtimeFiles,
    total,
    files,
    passed: failures.length === 0,
    failures,
  };
}

export function printLoggingEndToEndSummary(summary: LoggingEndToEndCoverageSummary): void {
  console.log("Logging subprocess E2E coverage:");
  for (const metric of METRICS) {
    const metricSummary = selectMetricSummary(summary.total, metric);
    console.log(
      `  ${metric.padEnd(10)} ${String(metricSummary.covered)}/${String(metricSummary.total)} (${String(metricSummary.pct)}%)`,
    );
  }
  console.log(`  cases      ${String(summary.caseIds.length)}/${String(summary.rawFileCount)}`);
  console.log(`  gate       ${summary.passed ? "PASS" : `FAIL (${summary.failures.join(", ")})`}`);
}
