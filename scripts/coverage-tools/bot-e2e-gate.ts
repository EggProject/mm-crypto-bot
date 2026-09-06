/* eslint-disable security/detect-non-literal-fs-filename -- every path is constrained to the validated raw/report roots */
/* eslint-disable security/detect-object-injection -- metric and entry-kind keys come from closed validated allowlists */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import coveragePackage from "istanbul-lib-coverage";
import type { CoverageSummaryData } from "istanbul-lib-coverage";

import {
  REPOSITORY_ROOT,
  absoluteRuntimeFiles,
  loadScopeManifest,
  type BotRuntimeScopeManifest,
  type E2eEntryKind as E2EEntryKind,
} from "./bot-runtime-scope.ts";

const createCoverageMap = coveragePackage.createCoverageMap.bind(coveragePackage);
type CoverageMetric = "statements" | "branches" | "functions" | "lines";

export interface BotE2ECoverageSummary {
  readonly schemaVersion: 1;
  readonly label: "bot-subprocess-e2e";
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
  readonly entryKind: E2EEntryKind;
  readonly caseId: string;
  readonly coverage: Readonly<Record<string, unknown>>;
}

const METRICS: readonly CoverageMetric[] = ["statements", "branches", "functions", "lines"];
const RAW_FILE_PATTERN = /^(?<pid>[1-9][0-9]*)\.json$/u;
const MAX_RAW_FILES = 1024;
const MAX_RAW_FILE_BYTES = 32 * 1024 * 1024;

function assertPlainObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
}

function isMatchingProcessIdentifier(value: unknown, filenamePid: number): value is number {
  return typeof value === "number" && value === filenamePid && value > 0 && Number.isSafeInteger(value);
}

function compareCodeUnits(left: string, right: string): number {
  return Number(left > right) - Number(left < right);
}

function parseEnvelope(filePath: string, name: string, manifest: BotRuntimeScopeManifest): CoverageEnvelope {
  const match = RAW_FILE_PATTERN.exec(name);
  if (match?.groups?.["pid"] === undefined) throw new Error(`unexpected raw coverage filename: ${name}`);
  const size = statSync(filePath).size;
  if (size === 0 || size > MAX_RAW_FILE_BYTES) throw new Error(`raw coverage file has invalid size: ${name}`);
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    const message = String(Reflect.get(new Object(error), "message"));
    throw new Error(`malformed raw coverage JSON ${name}: ${message}`, { cause: error });
  }
  assertPlainObject(value, `raw coverage envelope ${name}`);
  const filenamePid = Number(match.groups["pid"]);
  const pid = value["pid"];
  if (!isMatchingProcessIdentifier(pid, filenamePid)) {
    throw new Error(`raw coverage PID does not match filename: ${name}`);
  }
  if (value["schemaVersion"] !== 1) throw new Error(`raw coverage schemaVersion is invalid: ${name}`);
  const entryKind = value["entryKind"];
  if (entryKind !== "canonical-cli" && entryKind !== "runtime-driver") {
    throw new Error(`raw coverage entry kind is invalid: ${name}`);
  }
  const envelopeCaseId = value["caseId"];
  if (typeof envelopeCaseId !== "string" || !manifest.e2eCases[entryKind].includes(envelopeCaseId)) {
    throw new Error(`raw coverage case ID is invalid: ${name}`);
  }
  const coverage = value["coverage"];
  assertPlainObject(coverage, `raw coverage payload ${name}`);
  if (Object.keys(coverage).length === 0) throw new Error(`raw coverage payload is empty: ${name}`);
  return { schemaVersion: 1, pid, entryKind, caseId: envelopeCaseId, coverage };
}

function isExactMetric(summary: CoverageSummaryData, metric: CoverageMetric): boolean {
  const value = summary[metric];
  return value.total === value.covered;
}

export function collectBotE2ECoverage({
  rawDirectory,
  manifest = loadScopeManifest(),
}: {
  readonly rawDirectory: string;
  readonly manifest?: BotRuntimeScopeManifest;
}): BotE2ECoverageSummary {
  const entries = readdirSync(rawDirectory, { withFileTypes: true });
  if (entries.length === 0) throw new Error("no PID coverage files were produced");
  if (entries.length > MAX_RAW_FILES) {
    throw new Error(`too many raw coverage files: ${String(entries.length)}`);
  }
  const map = createCoverageMap({});
  const expectedFiles = new Set<string>(absoluteRuntimeFiles(manifest));
  const observedCases = new Set<string>();
  const sortedEntries = entries.toSorted((left, right) => compareCodeUnits(left.name, right.name));
  for (const entry of sortedEntries) {
    if (!entry.isFile()) throw new Error(`unexpected entry in raw coverage directory: ${entry.name}`);
    const envelope = parseEnvelope(path.resolve(rawDirectory, entry.name), entry.name, manifest);
    const files = Object.keys(envelope.coverage);
    for (const file of files) {
      if (!expectedFiles.has(path.resolve(file)))
        throw new Error(`raw coverage contains out-of-scope file: ${file}`);
    }
    map.merge(envelope.coverage);
    observedCases.add(`${envelope.entryKind}:${envelope.caseId}`);
  }

  const coveredFiles = new Set(map.files().map((file) => path.resolve(file)));
  const missingFiles: string[] = [];
  for (const expectedFile of expectedFiles) {
    if (!coveredFiles.has(expectedFile)) missingFiles.push(expectedFile);
  }
  if (missingFiles.length > 0) {
    throw new Error(`merged coverage is missing owned runtime files:\n${missingFiles.join("\n")}`);
  }
  const missingCases = Object.entries(manifest.e2eCases)
    .flatMap(([kind, ids]) => ids.map((id) => `${kind}:${id}`))
    .filter((caseKey) => !observedCases.has(caseKey));
  if (missingCases.length > 0)
    throw new Error(`required E2E cases did not produce coverage: ${missingCases.join(", ")}`);

  const total = map.getCoverageSummary().toJSON();
  const files = Object.fromEntries(
    map
      .files()
      .toSorted(compareCodeUnits)
      .map((file) => [path.relative(REPOSITORY_ROOT, file), map.fileCoverageFor(file).toSummary().toJSON()]),
  );
  const failures: CoverageMetric[] = [];
  for (const metric of METRICS) {
    if (!isExactMetric(total, metric)) failures.push(metric);
  }
  return {
    schemaVersion: 1,
    label: "bot-subprocess-e2e",
    rawFileCount: entries.length,
    caseIds: [...observedCases].toSorted(compareCodeUnits),
    scope: manifest.runtimeFiles,
    total,
    files,
    passed: failures.length === 0,
    failures,
  };
}

export function writeBotE2ESummary(summary: BotE2ECoverageSummary, outputPath: string): void {
  writeFileSync(outputPath, `${JSON.stringify(summary, undefined, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

export function printBotE2ESummary(summary: BotE2ECoverageSummary): void {
  console.log("Bot subprocess E2E coverage:");
  for (const metric of METRICS) {
    const value = summary.total[metric];
    console.log(
      `  ${metric.padEnd(10)} ${String(value.covered)}/${String(value.total)} (${String(value.pct)}%)`,
    );
  }
  console.log(`  cases      ${String(summary.caseIds.length)}/${String(summary.caseIds.length)}`);
  console.log(`  gate       ${summary.passed ? "PASS" : `FAIL (${summary.failures.join(", ")})`}`);
}

export {
  collectBotE2ECoverage as collectBotE2eCoverage,
  printBotE2ESummary as printBotE2eSummary,
  writeBotE2ESummary as writeBotE2eSummary,
};
export type { BotE2ECoverageSummary as BotE2eCoverageSummary };
