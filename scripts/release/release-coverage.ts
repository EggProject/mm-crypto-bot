import { spawn as nodeSpawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type ReleaseCoverageLevel = "unit" | "e2e" | "all";
type CoverageLevel = Exclude<ReleaseCoverageLevel, "all">;
type CoverageReader = () => Promise<string>;

export interface ReleaseCoverageChildInput {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
}

export interface ReleaseCoverageDependencies {
  readonly environment: Readonly<Record<string, string>>;
  readonly readE2eCoverageSummary: CoverageReader;
  readonly readE2eLcov: CoverageReader;
  readonly readUnitCoverageSummary: CoverageReader;
  readonly readUnitLcov: CoverageReader;
  readonly repoRoot: string;
  readonly runChild: (input: ReleaseCoverageChildInput) => Promise<unknown>;
}

export interface ReleaseCoverageEntrypointDependencies {
  readonly argv: readonly string[];
  readonly exitCodeTarget: { exitCode: number | string | null | undefined };
  readonly isMain: boolean;
  readonly runCommand: () => Promise<void>;
  readonly writeStderr: (text: string) => void;
}

export interface RawNodeChild {
  once(eventName: string, listener: (...values: unknown[]) => void): RawNodeChild;
}

export type RawNodeSpawn = (
  executable: string,
  arguments_: readonly string[],
  options: {
    readonly cwd: string;
    readonly env: Readonly<Record<string, string>>;
    readonly shell: false;
    readonly stdio: "ignore";
  },
) => RawNodeChild;

const metricNames = ["statements", "branches", "functions", "lines"] as const;
const releaseDirectoryName = "scripts/release";
const unitSources = [
  "release-contract.ts",
  "zip-store.ts",
  "zip-store-encoder.ts",
  "release-assembler.ts",
  "release-verifier.ts",
  "release-artifact-verifier.ts",
  "release-smoke.ts",
  "release-private-candidate-reproducibility.ts",
  "verify.ts",
  "release-coverage.ts",
] as const;
const e2eSources = [
  "release-assembler.ts",
  "release-smoke.ts",
  "release-private-candidate-reproducibility.ts",
] as const;
const { readFile } = await import("node:fs/promises");

export function parseReleaseCoverageArguments(argv: readonly unknown[]): ReleaseCoverageLevel {
  if (argv.length !== 1) throw new Error("invalid release coverage arguments");
  const argument = argv[0];
  if (typeof argument !== "string") throw new Error("invalid release coverage arguments");
  if (argument === "--level=unit") return "unit";
  if (argument === "--level=e2e") return "e2e";
  if (argument === "--level=all") return "all";
  throw new Error("invalid release coverage arguments");
}

export async function runReleaseCoverage(
  level: unknown,
  dependencies: ReleaseCoverageDependencies,
): Promise<void> {
  if (!isReleaseCoverageLevel(level)) throw new Error("release coverage failed");
  try {
    if (level === "all") {
      await runCoverageLevel("unit", dependencies);
      await runCoverageLevel("e2e", dependencies);
      return;
    }
    await runCoverageLevel(level, dependencies);
  } catch {
    throw new Error("release coverage failed");
  }
}

export function sanitizeReleaseCoverageEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  temporaryDirectory: string,
): Readonly<Record<string, string>> {
  const entries: (readonly [string, string])[] = [];
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined || isNodeShimSelector(key)) continue;
    entries.push([key, key === "PATH" ? sanitizePath(value, temporaryDirectory) : value]);
  }
  return Object.freeze(Object.fromEntries(entries));
}

export function createNodeReleaseCoverageDependencies(
  repoRoot: string,
  environment: Readonly<Record<string, string | undefined>>,
  temporaryDirectory: string,
  runChild: ReleaseCoverageDependencies["runChild"],
): ReleaseCoverageDependencies {
  return Object.freeze({
    environment: sanitizeReleaseCoverageEnvironment(environment, temporaryDirectory),
    readE2eCoverageSummary: () =>
      readFile(new URL("../../coverage/release/e2e/coverage-summary.json", import.meta.url), "utf8"),
    readE2eLcov: () => readFile(new URL("../../coverage/release/e2e/lcov.info", import.meta.url), "utf8"),
    readUnitCoverageSummary: () =>
      readFile(new URL("../../coverage/release/unit/coverage-summary.json", import.meta.url), "utf8"),
    readUnitLcov: () => readFile(new URL("../../coverage/release/unit/lcov.info", import.meta.url), "utf8"),
    repoRoot,
    runChild,
  });
}

export function createNodeReleaseCoverageChildPort(
  spawn: RawNodeSpawn,
): ReleaseCoverageDependencies["runChild"] {
  return (input: ReleaseCoverageChildInput): Promise<unknown> => {
    const executable = input.argv[0];
    if (executable === undefined) return Promise.reject(new Error("invalid coverage child command"));
    return new Promise((resolve, reject) => {
      const child = spawn(executable, input.argv.slice(1), {
        cwd: input.cwd,
        env: input.env,
        shell: false,
        stdio: "ignore",
      });
      child
        .once("error", () => {
          reject(new Error("coverage child failed"));
        })
        .once("close", (status, signal) => {
          resolve(
            Object.freeze({
              signal: typeof signal === "string" ? signal : undefined,
              status: typeof status === "number" ? status : undefined,
            }),
          );
        });
    });
  };
}

export async function runReleaseCoverageEntrypoint(
  dependencies: ReleaseCoverageEntrypointDependencies,
): Promise<number | string | null | undefined> {
  if (!dependencies.isMain) return dependencies.exitCodeTarget.exitCode;
  try {
    await dependencies.runCommand();
    dependencies.exitCodeTarget.exitCode = 0;
  } catch {
    dependencies.writeStderr("release coverage failed\n");
    dependencies.exitCodeTarget.exitCode = 1;
  }
  return dependencies.exitCodeTarget.exitCode;
}

export function createReleaseCoverageCommand(
  argv: readonly string[],
  dependencies: ReleaseCoverageDependencies,
): () => Promise<void> {
  return () => runReleaseCoverage(parseReleaseCoverageArguments(argv), dependencies);
}

async function runCoverageLevel(
  level: CoverageLevel,
  dependencies: ReleaseCoverageDependencies,
): Promise<void> {
  const result = await dependencies.runChild({
    argv: coverageCommand(level),
    cwd: dependencies.repoRoot,
    env: dependencies.environment,
  });
  if (!isSuccessfulChildResult(result)) throw new Error("invalid child result");
  await validateCoverageReports(level, dependencies);
}

function coverageCommand(level: CoverageLevel): readonly string[] {
  const config =
    level === "unit" ? "scripts/release/vitest.config.ts" : "scripts/release/vitest.e2e.config.ts";
  return Object.freeze(["node", "node_modules/vitest/vitest.mjs", "run", "--config", config, "--coverage"]);
}

async function validateCoverageReports(
  level: CoverageLevel,
  dependencies: ReleaseCoverageDependencies,
): Promise<void> {
  const [summaryText, lcovText] = await readCoverageReports(level, dependencies);
  const releaseDirectory = path.join(dependencies.repoRoot, releaseDirectoryName);
  const expectedSources = sourcesFor(level);
  validateJsonSummary(summaryText, releaseDirectory, expectedSources);
  validateLcov(lcovText, releaseDirectory, expectedSources);
}

function readCoverageReports(
  level: CoverageLevel,
  dependencies: ReleaseCoverageDependencies,
): Promise<readonly [string, string]> {
  if (level === "unit") {
    return Promise.all([dependencies.readUnitCoverageSummary(), dependencies.readUnitLcov()]);
  }
  return Promise.all([dependencies.readE2eCoverageSummary(), dependencies.readE2eLcov()]);
}

function sourcesFor(level: CoverageLevel): readonly string[] {
  return level === "unit" ? unitSources : e2eSources;
}

function validateJsonSummary(
  summaryText: string,
  releaseDirectory: string,
  expectedSources: readonly string[],
): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(summaryText);
  } catch {
    throw new Error("invalid coverage summary");
  }
  if (!isRecord(parsed) || !hasExactSummarySources(parsed, releaseDirectory, expectedSources)) {
    throw new Error("invalid coverage summary");
  }
  for (const summary of Object.values(parsed)) {
    validateSummaryMetrics(summary);
  }
}

function validateSummaryMetrics(value: unknown): void {
  if (!isRecord(value) || !hasRequiredEntries(value, metricNames))
    throw new Error("invalid coverage summary");
  for (const metricName of metricNames) {
    const metric = findEntry(value, metricName);
    if (!isRecord(metric) || !hasRequiredEntries(metric, ["total", "covered", "pct"])) {
      throw new Error("invalid coverage summary");
    }
    const total = findEntry(metric, "total");
    const covered = findEntry(metric, "covered");
    const pct = findEntry(metric, "pct");
    if (
      total !== covered ||
      typeof pct !== "number" ||
      pct !== 100 ||
      !isSafeInteger(total) ||
      !isSafeInteger(covered) ||
      total < 0 ||
      covered < 0
    ) {
      throw new Error("invalid coverage summary");
    }
  }
}

function validateLcov(lcovText: string, releaseDirectory: string, expectedSources: readonly string[]): void {
  const lines = lcovText.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const foundSources = new Set<string>();
  let counters: Map<string, number> | undefined;
  for (const line of lines) {
    if (line === "TN:" && counters === undefined) continue;
    if (line.startsWith("SF:")) {
      if (counters !== undefined) throw new Error("invalid lcov report");
      const source = resolveSafeSource(line.slice(3), releaseDirectory);
      if (
        source === undefined ||
        foundSources.has(source) ||
        !isExpectedSource(source, releaseDirectory, expectedSources)
      ) {
        throw new Error("invalid lcov report");
      }
      foundSources.add(source);
      counters = new Map<string, number>();
      continue;
    }
    if (line === "end_of_record") {
      if (counters === undefined || !hasCompleteLcovCounters(counters))
        throw new Error("invalid lcov report");
      counters = undefined;
      continue;
    }
    if (counters !== undefined && isLcovDetailLine(line)) continue;
    if (counters === undefined || !hasLcovCounter(line, counters)) throw new Error("invalid lcov report");
  }
  if (counters !== undefined || foundSources.size !== expectedSources.length)
    throw new Error("invalid lcov report");
}

function hasLcovCounter(line: string, counters: Map<string, number>): boolean {
  const match = /^(LF|LH|FNF|FNH|BRF|BRH):(0|[1-9][0-9]*)$/u.exec(line);
  const label = match?.[1];
  const rawValue = match?.[2];
  if (label === undefined || rawValue === undefined || counters.has(label)) return false;
  const value = Number(rawValue);
  if (!Number.isSafeInteger(value)) return false;
  counters.set(label, value);
  return true;
}

function hasCompleteLcovCounters(counters: ReadonlyMap<string, number>): boolean {
  const required = ["LF", "LH", "FNF", "FNH", "BRF", "BRH"] as const;
  return (
    counters.size === required.length &&
    required.every((counter) => counters.has(counter)) &&
    counters.get("LF") === counters.get("LH") &&
    counters.get("FNF") === counters.get("FNH") &&
    counters.get("BRF") === counters.get("BRH")
  );
}

function isLcovDetailLine(line: string): boolean {
  return (
    /^FN:(0|[1-9][0-9]*),[^\0\r\n]+$/u.test(line) ||
    /^FNDA:(0|[1-9][0-9]*),[^\0\r\n]+$/u.test(line) ||
    /^DA:(0|[1-9][0-9]*),(0|[1-9][0-9]*)$/u.test(line) ||
    /^BRDA:(0|[1-9][0-9]*),(0|[1-9][0-9]*),(0|[1-9][0-9]*),(?:-|0|[1-9][0-9]*)$/u.test(line)
  );
}

function hasExactSummarySources(
  summary: Record<string, unknown>,
  releaseDirectory: string,
  expectedSources: readonly string[],
): boolean {
  const entries = Object.entries(summary);
  if (entries.length !== expectedSources.length + 1) return false;
  const foundSources = new Set<string>();
  for (const [key] of entries) {
    if (key === "total") {
      foundSources.add(key);
      continue;
    }
    const source = resolveSafeSource(key, releaseDirectory);
    if (
      source === undefined ||
      foundSources.has(source) ||
      !isExpectedSource(source, releaseDirectory, expectedSources)
    ) {
      return false;
    }
    foundSources.add(source);
  }
  return foundSources.has("total") && foundSources.size === expectedSources.length + 1;
}

function isExpectedSource(
  source: string,
  releaseDirectory: string,
  expectedSources: readonly string[],
): boolean {
  return expectedSources.some((expectedSource) => source === path.join(releaseDirectory, expectedSource));
}

function hasRequiredEntries(record: Record<string, unknown>, names: readonly string[]): boolean {
  return names.every((name) => findEntry(record, name) !== undefined);
}

function findEntry(record: Record<string, unknown>, name: string): unknown {
  for (const [candidate, value] of Object.entries(record)) {
    if (candidate === name) return value;
  }
  return undefined;
}

function resolveSafeSource(source: string, releaseDirectory: string): string | undefined {
  if (
    source.length === 0 ||
    source.includes("\0") ||
    source.includes("\\") ||
    source.split("/").includes("..")
  ) {
    return undefined;
  }
  const resolved = path.resolve(releaseDirectory, source);
  const relative = path.relative(releaseDirectory, resolved);
  return relative === "" || relative.startsWith("..") || path.isAbsolute(relative) ? undefined : resolved;
}

function isNodeShimSelector(key: string): boolean {
  return ["NODE", "npm_node_execpath", "npm_execpath"].includes(key);
}

function sanitizePath(pathValue: string, temporaryDirectory: string): string {
  return pathValue
    .split(path.delimiter)
    .filter((segment) => !isTemporaryNodeShim(segment, temporaryDirectory))
    .join(path.delimiter);
}

function isTemporaryNodeShim(segment: string, temporaryDirectory: string): boolean {
  const resolvedSegment = path.resolve(segment);
  const relative = path.relative(temporaryDirectory, resolvedSegment);
  return (
    !relative.startsWith("..") &&
    !path.isAbsolute(relative) &&
    path.basename(resolvedSegment).startsWith("bun-node-")
  );
}

function isReleaseCoverageLevel(value: unknown): value is ReleaseCoverageLevel {
  return typeof value === "string" && ["unit", "e2e", "all"].includes(value);
}

function isSuccessfulChildResult(value: unknown): boolean {
  if (!isRecord(value) || Object.keys(value).length !== 2) return false;
  return findEntry(value, "status") === 0 && findEntry(value, "signal") === undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const nodeChildPort = createNodeReleaseCoverageChildPort(nodeSpawn);
const nodeDependencies = createNodeReleaseCoverageDependencies(
  repoRoot,
  process.env,
  tmpdir(),
  nodeChildPort,
);
const runCommand = createReleaseCoverageCommand(process.argv.slice(2), nodeDependencies);

process.exitCode = await runReleaseCoverageEntrypoint({
  argv: process.argv.slice(2),
  exitCodeTarget: process,
  isMain: import.meta.main,
  runCommand,
  writeStderr: process.stderr.write.bind(process.stderr),
});
