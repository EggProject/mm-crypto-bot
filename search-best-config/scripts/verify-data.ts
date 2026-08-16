import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { getArg, isObject, parseNamedArgs, readJson, REPO_ROOT } from "./common.js";

interface ExpectedFile {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly rows: number;
  readonly firstTs: number;
  readonly lastTs: number;
  readonly symbol?: string;
}

interface SnapshotDataset {
  readonly id: string;
  readonly kind: "ohlcv-manifest" | "funding-csv" | "dvol-csv";
  readonly manifestPath?: string;
  readonly manifestSha256?: string;
  readonly expectedFileCount?: number;
  readonly expectedTotalRows?: number;
  readonly cadenceMs?: number;
  readonly cadenceToleranceMs?: number;
  readonly files?: readonly ExpectedFile[];
}

interface Snapshot {
  readonly schemaVersion: number;
  readonly snapshotId: string;
  readonly datasets: readonly SnapshotDataset[];
}

export interface VerificationRow {
  readonly datasetId: string;
  readonly path: string;
  readonly status: "PASS" | "FAIL";
  readonly rows: number | null;
  readonly firstTs: number | null;
  readonly lastTs: number | null;
  readonly issues: readonly string[];
}

export interface VerificationReport {
  readonly snapshotId: string;
  readonly status: "PASS" | "FAIL";
  readonly filesChecked: number;
  readonly rowsChecked: number;
  readonly rows: readonly VerificationRow[];
}

function requireNumber(object: Record<string, unknown>, key: string): number {
  const value = object[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Hiányzó/hibás szám: ${key}`);
  return value;
}

function requireString(object: Record<string, unknown>, key: string): string {
  const value = object[key];
  if (typeof value !== "string" || value.length === 0) throw new Error(`Hiányzó/hibás szöveg: ${key}`);
  return value;
}

function parseExpectedFile(value: unknown): ExpectedFile {
  if (!isObject(value)) throw new Error("Hibás snapshot file rekord");
  const symbol = value["symbol"];
  return {
    path: requireString(value, "path"),
    sha256: requireString(value, "sha256"),
    bytes: requireNumber(value, "bytes"),
    rows: requireNumber(value, "rows"),
    firstTs: requireNumber(value, "firstTs"),
    lastTs: requireNumber(value, "lastTs"),
    ...(typeof symbol === "string" ? { symbol } : {}),
  };
}

function parseSnapshot(value: unknown): Snapshot {
  if (!isObject(value) || !Array.isArray(value["datasets"])) throw new Error("Hibás data-snapshot.json");
  const datasets = value["datasets"].map((entry): SnapshotDataset => {
    if (!isObject(entry)) throw new Error("Hibás dataset rekord");
    const kind = requireString(entry, "kind");
    if (kind !== "ohlcv-manifest" && kind !== "funding-csv" && kind !== "dvol-csv") {
      throw new Error(`Ismeretlen dataset kind: ${kind}`);
    }
    const files = entry["files"];
    return {
      id: requireString(entry, "id"),
      kind,
      ...(typeof entry["manifestPath"] === "string" ? { manifestPath: entry["manifestPath"] } : {}),
      ...(typeof entry["manifestSha256"] === "string" ? { manifestSha256: entry["manifestSha256"] } : {}),
      ...(typeof entry["expectedFileCount"] === "number" ? { expectedFileCount: entry["expectedFileCount"] } : {}),
      ...(typeof entry["expectedTotalRows"] === "number" ? { expectedTotalRows: entry["expectedTotalRows"] } : {}),
      ...(typeof entry["cadenceMs"] === "number" ? { cadenceMs: entry["cadenceMs"] } : {}),
      ...(typeof entry["cadenceToleranceMs"] === "number" ? { cadenceToleranceMs: entry["cadenceToleranceMs"] } : {}),
      ...(Array.isArray(files) ? { files: files.map(parseExpectedFile) } : {}),
    };
  });
  return {
    schemaVersion: requireNumber(value, "schemaVersion"),
    snapshotId: requireString(value, "snapshotId"),
    datasets,
  };
}

async function sha256(path: string): Promise<string> {
  const content = await readFile(path);
  return createHash("sha256").update(content).digest("hex");
}

function finite(parts: readonly string[], indexes: readonly number[]): boolean {
  return indexes.every((index) => {
    const value = Number(parts[index]);
    return Number.isFinite(value);
  });
}

async function verifyCsv(
  repoRoot: string,
  dataset: SnapshotDataset,
  expected: ExpectedFile,
  absoluteOverride?: string,
): Promise<VerificationRow> {
  const path = absoluteOverride ?? resolve(repoRoot, expected.path);
  const issues: string[] = [];
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    return {
      datasetId: dataset.id,
      path: expected.path,
      status: "FAIL",
      rows: null,
      firstTs: null,
      lastTs: null,
      issues: [`Nem olvasható: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
  const fileStat = await stat(path);
  const actualHash = createHash("sha256").update(raw).digest("hex");
  if (actualHash !== expected.sha256) issues.push(`SHA-256 eltérés: ${actualHash}`);
  if (fileStat.size !== expected.bytes) issues.push(`Byte eltérés: ${fileStat.size} != ${expected.bytes}`);

  const lines = raw.trimEnd().split("\n");
  const header = lines.shift()?.replace(/\r$/, "") ?? "";
  const isFunding = dataset.kind === "funding-csv";
  const isDvol = dataset.kind === "dvol-csv";
  const expectedHeader = isFunding
    ? "fundingTime,symbol,fundingRate,markPrice"
    : isDvol
      ? "timestamp_ms,iso_date,open,high,low,close"
      : "timestamp,open,high,low,close,volume";
  if (header !== expectedHeader) issues.push(`Hibás CSV header: ${header}`);

  let previousTs: number | null = null;
  let firstTs: number | null = null;
  let lastTs: number | null = null;
  const cadence = dataset.cadenceMs;
  const tolerance = dataset.cadenceToleranceMs ?? 0;
  for (let index = 0; index < lines.length; index++) {
    const parts = (lines[index] ?? "").replace(/\r$/, "").split(",");
    const timestamp = Number(parts[0]);
    const requiredColumns = isFunding ? 4 : 6;
    if (parts.length !== requiredColumns || !Number.isFinite(timestamp)) {
      issues.push(`Hibás sor: ${index + 2}`);
      continue;
    }
    firstTs ??= timestamp;
    lastTs = timestamp;
    if (previousTs !== null) {
      if (timestamp <= previousTs) issues.push(`Nem növekvő timestamp: ${index + 2}`);
      if (cadence !== undefined && Math.abs(timestamp - previousTs - cadence) > tolerance) {
        issues.push(`Cadence eltérés: ${index + 2}`);
      }
    }
    previousTs = timestamp;
    if (isFunding) {
      if (!finite(parts, [0, 2, 3])) issues.push(`Nem véges funding adat: ${index + 2}`);
      if (expected.symbol !== undefined && parts[1] !== expected.symbol) issues.push(`Symbol eltérés: ${index + 2}`);
    } else {
      const offset = isDvol ? 2 : 1;
      if (!finite(parts, isDvol ? [0, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5])) {
        issues.push(`Nem véges OHLC adat: ${index + 2}`);
      } else {
        const open = Number(parts[offset]);
        const high = Number(parts[offset + 1]);
        const low = Number(parts[offset + 2]);
        const close = Number(parts[offset + 3]);
        if (high < open || high < close || low > open || low > close || low > high) {
          issues.push(`OHLC invariáns sérült: ${index + 2}`);
        }
        if (!isDvol && Number(parts[5]) < 0) issues.push(`Negatív volume: ${index + 2}`);
      }
    }
  }
  if (lines.length !== expected.rows) issues.push(`Sor eltérés: ${lines.length} != ${expected.rows}`);
  if (firstTs !== expected.firstTs) issues.push(`firstTs eltérés: ${String(firstTs)} != ${expected.firstTs}`);
  if (lastTs !== expected.lastTs) issues.push(`lastTs eltérés: ${String(lastTs)} != ${expected.lastTs}`);
  return {
    datasetId: dataset.id,
    path: expected.path,
    status: issues.length === 0 ? "PASS" : "FAIL",
    rows: lines.length,
    firstTs,
    lastTs,
    issues,
  };
}

async function verifyOhlcvManifest(repoRoot: string, dataset: SnapshotDataset): Promise<readonly VerificationRow[]> {
  if (dataset.manifestPath === undefined || dataset.manifestSha256 === undefined) {
    throw new Error(`${dataset.id}: hiányzó manifestPath/manifestSha256`);
  }
  const manifestPath = resolve(repoRoot, dataset.manifestPath);
  const manifestHash = await sha256(manifestPath);
  if (manifestHash !== dataset.manifestSha256) {
    return [{
      datasetId: dataset.id,
      path: dataset.manifestPath,
      status: "FAIL",
      rows: null,
      firstTs: null,
      lastTs: null,
      issues: [`Manifest SHA-256 eltérés: ${manifestHash}`],
    }];
  }
  const rawManifest = await readJson(manifestPath);
  if (!isObject(rawManifest) || !Array.isArray(rawManifest["files"]) || !isObject(rawManifest["timeframeMs"])) {
    throw new Error(`${dataset.id}: hibás OHLCV manifest`);
  }
  const manifestFiles = rawManifest["files"].map(parseExpectedFile);
  const preflightIssues: string[] = [];
  if (dataset.expectedFileCount !== undefined && manifestFiles.length !== dataset.expectedFileCount) {
    preflightIssues.push(`Fájlszám eltérés: ${manifestFiles.length} != ${dataset.expectedFileCount}`);
  }
  const totalRows = manifestFiles.reduce((sum, file) => sum + file.rows, 0);
  if (dataset.expectedTotalRows !== undefined && totalRows !== dataset.expectedTotalRows) {
    preflightIssues.push(`Összes sorszám eltérés: ${totalRows} != ${dataset.expectedTotalRows}`);
  }
  const baseDir = dirname(manifestPath);
  const rows: VerificationRow[] = [];
  for (const expected of manifestFiles) {
    const timeframe = /_(1m|5m|15m|1h|4h|1d)\.csv$/.exec(expected.path)?.[1];
    const timeframeMs = rawManifest["timeframeMs"];
    const cadenceValue = timeframe === undefined || !isObject(timeframeMs) ? undefined : timeframeMs[timeframe];
    if (typeof cadenceValue !== "number") throw new Error(`Hiányzó timeframe cadence: ${expected.path}`);
    const csvDataset: SnapshotDataset = { ...dataset, cadenceMs: cadenceValue, cadenceToleranceMs: 0 };
    rows.push(await verifyCsv(repoRoot, csvDataset, expected, resolve(baseDir, expected.path)));
  }
  if (preflightIssues.length > 0) {
    rows.unshift({
      datasetId: dataset.id,
      path: dataset.manifestPath,
      status: "FAIL",
      rows: totalRows,
      firstTs: null,
      lastTs: null,
      issues: preflightIssues,
    });
  }
  return rows;
}

export async function verifySnapshot(snapshotPath: string, repoRoot = REPO_ROOT): Promise<VerificationReport> {
  const snapshot = parseSnapshot(await readJson(snapshotPath));
  const rows: VerificationRow[] = [];
  for (const dataset of snapshot.datasets) {
    if (dataset.kind === "ohlcv-manifest") {
      rows.push(...await verifyOhlcvManifest(repoRoot, dataset));
      continue;
    }
    if (dataset.files === undefined) throw new Error(`${dataset.id}: hiányzó files lista`);
    for (const expected of dataset.files) rows.push(await verifyCsv(repoRoot, dataset, expected));
  }
  return {
    snapshotId: snapshot.snapshotId,
    status: rows.every((row) => row.status === "PASS") ? "PASS" : "FAIL",
    filesChecked: rows.length,
    rowsChecked: rows.reduce((sum, row) => sum + (row.rows ?? 0), 0),
    rows,
  };
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const args = parseNamedArgs(argv);
  const snapshotPath = resolve(REPO_ROOT, getArg(args, "snapshot", "search-best-config/data-snapshot.json"));
  const report = await verifySnapshot(snapshotPath);
  for (const row of report.rows) {
    console.log(`${row.status}\t${row.datasetId}\t${row.path}\trows=${String(row.rows)}${row.issues.length > 0 ? `\t${row.issues.join("; ")}` : ""}`);
  }
  console.log(`${report.status}: ${report.filesChecked} fájl, ${report.rowsChecked} adatsor`);
  if (report.status !== "PASS") process.exitCode = 2;
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
}
