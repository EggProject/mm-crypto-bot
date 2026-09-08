/* eslint-disable security/detect-non-literal-fs-filename -- the test creates and deletes only exact temporary adapter-child and raw-envelope paths */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import coveragePackage, { type CoverageMetricData } from "istanbul-lib-coverage";
import instrumentPackage from "istanbul-lib-instrument";
import { describe, expect, it } from "bun:test";

import { buildBotE2EChildEnvironment } from "./bot-e2e-child-environment.ts";
import { REPOSITORY_ROOT } from "./bot-runtime-scope.ts";

const ADAPTER_SOURCE = path.resolve(REPOSITORY_ROOT, "scripts/coverage-tools/bot-e2e-preload.ts");
const ADAPTER_IMPORT_SPECIFIERS = [
  "./bot-e2e-child-environment.ts",
  "./bot-e2e-preload-runtime.ts",
  "./bot-runtime-scope.ts",
  "./bot-runtime-network-guard.ts",
] as const;
const NETWORK_NEGATIVE_FIXTURE = path.resolve(
  REPOSITORY_ROOT,
  "scripts/coverage-tools/bot-runtime-network-negative-fixture.ts",
);
const RAW_DIRECTORY = path.resolve(REPOSITORY_ROOT, "apps/bot/coverage/e2e/raw");

interface RawCoverageEnvelope {
  readonly caseId: string;
  readonly coverage: Readonly<Record<string, unknown>>;
  readonly entryKind: "canonical-cli" | "runtime-driver";
  readonly pid: number;
  readonly schemaVersion: 1;
}

function readJsonProperty(value: object, property: string): unknown {
  const propertyValue: unknown = Reflect.get(value, property);
  return propertyValue;
}

function isReadonlyRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rewriteAdapterImportSpecifiers(source: string): string {
  let rewritten = source;
  for (const specifier of ADAPTER_IMPORT_SPECIFIERS) {
    const staticImportSpecifier = `from "${specifier}"`;
    const occurrences = rewritten.split(staticImportSpecifier).length - 1;
    if (occurrences !== 1) {
      throw new Error(`adapter source must contain exactly one static import for ${specifier}`);
    }
    const absoluteSpecifier = pathToFileURL(path.resolve(path.dirname(ADAPTER_SOURCE), specifier)).href;
    const importIndex = rewritten.indexOf(staticImportSpecifier);
    rewritten = `${rewritten.slice(0, importIndex)}from "${absoluteSpecifier}"${rewritten.slice(
      importIndex + staticImportSpecifier.length,
    )}`;
  }
  return rewritten;
}

function parseRawCoverageEnvelope(contents: string): RawCoverageEnvelope {
  const parsed: unknown = JSON.parse(contents);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("preload child wrote a non-object raw coverage envelope");
  }
  const schemaVersion = readJsonProperty(parsed, "schemaVersion");
  const pid = readJsonProperty(parsed, "pid");
  const entryKind = readJsonProperty(parsed, "entryKind");
  const caseId = readJsonProperty(parsed, "caseId");
  const coverage = readJsonProperty(parsed, "coverage");
  if (
    typeof pid !== "number" ||
    typeof caseId !== "string" ||
    schemaVersion !== 1 ||
    !isReadonlyRecord(coverage) ||
    !Number.isSafeInteger(pid) ||
    (entryKind !== "canonical-cli" && entryKind !== "runtime-driver")
  ) {
    throw new Error("preload child wrote an invalid raw coverage envelope");
  }
  return {
    schemaVersion,
    pid,
    entryKind,
    caseId,
    coverage,
  };
}

function expectFullyCovered(metric: CoverageMetricData): void {
  expect(metric.covered).toBe(metric.total);
  expect(metric.pct).toBe(100);
}

describe("bot E2E preload adapter", () => {
  it("scrubs credentials and blocks outbound boundaries before I/O while fully covering the adapter", () => {
    mkdirSync(RAW_DIRECTORY, { recursive: true });
    const existingRawFiles = new Set(readdirSync(RAW_DIRECTORY));
    const adapterDirectory = mkdtempSync(path.join(tmpdir(), "mm-crypto-bot-bot-e2e-preload-"));
    let ownedRawPath: string | undefined;

    try {
      const adapterChild = path.join(adapterDirectory, "adapter.ts");
      const instrumentedAdapter = instrumentPackage
        .createInstrumenter({ esModules: true, produceSourceMap: false, parserPlugins: ["typescript"] })
        .instrumentSync(rewriteAdapterImportSpecifiers(readFileSync(ADAPTER_SOURCE, "utf8")), ADAPTER_SOURCE);
      writeFileSync(adapterChild, instrumentedAdapter, { encoding: "utf8", flag: "wx", mode: 0o600 });
      const result = spawnSync("bun", ["--preload", adapterChild, NETWORK_NEGATIVE_FIXTURE], {
        cwd: REPOSITORY_ROOT,
        encoding: "utf8",
        env: buildBotE2EChildEnvironment(
          {
            ...process.env,
            BYBIT_API_KEY: "must-not-reach-child",
            BYBIT_API_SECRET: "must-not-reach-child",
            BYBIT_EU_ACCESS_TOKEN: "must-not-reach-child",
            CCXT_PASSWORD: "must-not-reach-child",
            EXCHANGE_PASSPHRASE: "must-not-reach-child",
          },
          {
            MM_BOT_E2E_COVERAGE_RAW_DIR: RAW_DIRECTORY,
            MM_BOT_E2E_ENTRY_KIND: "canonical-cli",
            MM_BOT_E2E_CASE_ID: "network-negative",
          },
        ),
      });
      ownedRawPath = path.resolve(RAW_DIRECTORY, `${String(result.pid)}.json`);
      if (result.error !== undefined) throw result.error;
      if (result.status !== 86) {
        throw new Error(`preload child did not exit with the network guard code: ${result.stderr}`);
      }
      const rawFiles = readdirSync(RAW_DIRECTORY).filter((file) => !existingRawFiles.has(file));
      const rawFile = rawFiles[0];
      if (rawFile === undefined || rawFiles.length !== 1) {
        throw new Error("preload child did not write exactly one owned raw coverage envelope");
      }
      const rawPath = path.resolve(RAW_DIRECTORY, rawFile);
      if (rawPath !== ownedRawPath) {
        throw new Error("preload child wrote an unexpected raw coverage envelope path");
      }
      const envelope = parseRawCoverageEnvelope(readFileSync(rawPath, "utf8"));
      const coverage = coveragePackage.createCoverageMap(envelope.coverage);
      const summary = coverage.fileCoverageFor(ADAPTER_SOURCE).toSummary().toJSON();

      expect(result.stderr).toContain("credential environment absent before fixture evaluation");
      expect(result.stderr).toContain("blocked outbound attempt: global.fetch");
      expect(result.stderr).toContain("blocked outbound attempt: node:http.request");
      expect(result.stderr).toContain("blocked outbound attempt: Bun.connect");
      expect(envelope.schemaVersion).toBe(1);
      expect(envelope.entryKind).toBe("canonical-cli");
      expect(envelope.caseId).toBe("network-negative");
      expect(coverage.files()).toEqual([ADAPTER_SOURCE]);
      expectFullyCovered(summary.statements);
      expectFullyCovered(summary.branches);
      expectFullyCovered(summary.functions);
      expectFullyCovered(summary.lines);
    } finally {
      if (ownedRawPath !== undefined) rmSync(ownedRawPath, { force: true });
      rmSync(adapterDirectory, { force: true, recursive: true });
    }
  });
});
