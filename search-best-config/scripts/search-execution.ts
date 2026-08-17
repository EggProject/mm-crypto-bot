import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { isObject, readJson, REPO_ROOT, writeText } from "./common.js";
import { verifySnapshot, type VerificationReport } from "./verify-data.js";
import type { SearchJob } from "./run-search.js";

interface ProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CodeProvenance {
  readonly codeRevision: string | null;
  readonly dirtyDiffSha256: string;
}

export interface ExecutionOptions extends CodeProvenance {
  readonly outputDir: string;
  readonly snapshotPath: string;
  readonly concurrency: number;
  readonly resume: boolean;
  readonly verify?: (snapshotPath: string) => Promise<VerificationReport>;
  readonly run?: (command: readonly string[]) => Promise<ProcessResult>;
}

interface InputHash {
  readonly path: string;
  readonly sha256: string;
}

interface InputVerification {
  readonly status: "PASS" | "FAIL";
  readonly checkedAt: string;
  readonly files: readonly {
    readonly path: string;
    readonly expectedSha256: string | null;
    readonly actualSha256: string | null;
    readonly status: "PASS" | "FAIL";
    readonly reason: string | null;
  }[];
}

interface ExecutionProvenance {
  readonly schemaVersion: 2;
  readonly runId: string;
  readonly strategyId: string;
  readonly status: string;
  readonly reason: string | null;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly codeRevision: string | null;
  readonly dirtyDiffSha256: string;
  readonly command: readonly string[];
  readonly exitCode: number | null;
  readonly rawOutput: string;
  readonly rawOutputSha256: string | null;
  readonly stdoutLog: string | null;
  readonly stderrLog: string | null;
  readonly dataSnapshot: {
    readonly path: string;
    readonly sha256: string;
    readonly snapshotId: string | null;
  };
  readonly inputHashes: readonly InputHash[];
  readonly batchPreflight: VerificationReport;
  readonly inputBefore: InputVerification;
  readonly inputAfter: InputVerification | null;
  readonly batchPostflight: VerificationReport | null;
  readonly resumedFrom?: string;
}

function sha256Bytes(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function sha256File(path: string): Promise<string> {
  return sha256Bytes(await readFile(path));
}

function spawnGit(args: readonly string[]): { readonly exitCode: number; readonly stdout: string } {
  const result = Bun.spawnSync(["git", ...args], { cwd: REPO_ROOT, stdout: "pipe", stderr: "ignore" });
  return { exitCode: result.exitCode, stdout: result.stdout.toString() };
}

export function captureCodeProvenance(): CodeProvenance {
  const revision = spawnGit(["rev-parse", "HEAD"]);
  const diff = spawnGit([
    "diff",
    "--binary",
    "HEAD",
    "--",
    ".",
    ":(exclude)backtest-results/**",
    ":(exclude)search-best-config/results/**",
    ":(exclude)logs/**",
  ]);
  const untracked = spawnGit(["ls-files", "--others", "--exclude-standard"]);
  const ignoredGeneratedPrefixes = ["backtest-results/", "search-best-config/results/", "logs/"];
  const hash = createHash("sha256").update(diff.exitCode === 0 ? diff.stdout : "");
  if (untracked.exitCode === 0) {
    for (const path of untracked.stdout.split("\n").filter(Boolean).sort()) {
      if (ignoredGeneratedPrefixes.some((prefix) => path.startsWith(prefix))) continue;
      try {
        hash.update(`\0UNTRACKED\0${path}\0`);
        hash.update(readFileSync(resolve(REPO_ROOT, path)));
      } catch {
        hash.update("<unreadable>");
      }
    }
  }
  return {
    codeRevision: revision.exitCode === 0 ? revision.stdout.trim() : null,
    dirtyDiffSha256: hash.digest("hex"),
  };
}

async function defaultRun(command: readonly string[]): Promise<ProcessResult> {
  const child = Bun.spawn([...command], { cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

async function snapshotInputHashes(snapshotPath: string): Promise<readonly InputHash[]> {
  const snapshot = await readJson(snapshotPath);
  if (!isObject(snapshot) || !Array.isArray(snapshot["datasets"])) throw new Error("Hibás data snapshot");
  const hashes: InputHash[] = [];
  for (const dataset of snapshot["datasets"]) {
    if (!isObject(dataset)) continue;
    if (typeof dataset["manifestPath"] === "string" && typeof dataset["manifestSha256"] === "string") {
      hashes.push({ path: dataset["manifestPath"], sha256: dataset["manifestSha256"] });
      const manifest = await readJson(resolve(REPO_ROOT, dataset["manifestPath"]));
      if (isObject(manifest) && Array.isArray(manifest["files"]))
        for (const file of manifest["files"]) {
          if (isObject(file) && typeof file["path"] === "string" && typeof file["sha256"] === "string")
            hashes.push({ path: `data/ohlcv/${file["path"]}`, sha256: file["sha256"] });
        }
    }
    if (Array.isArray(dataset["files"]))
      for (const file of dataset["files"]) {
        if (isObject(file) && typeof file["path"] === "string" && typeof file["sha256"] === "string")
          hashes.push({ path: file["path"], sha256: file["sha256"] });
      }
  }
  return hashes;
}

async function verifyJobInputs(
  job: SearchJob,
  expected: ReadonlyMap<string, string>,
): Promise<InputVerification> {
  const files = await Promise.all(
    job.inputFiles.map(async (path) => {
      const expectedSha256 = expected.get(path) ?? null;
      try {
        const actualSha256 = await sha256File(resolve(REPO_ROOT, path));
        const pass = expectedSha256 !== null && actualSha256 === expectedSha256;
        return {
          path,
          expectedSha256,
          actualSha256,
          status: pass ? ("PASS" as const) : ("FAIL" as const),
          reason: pass
            ? null
            : expectedSha256 === null
              ? "Az input nincs a fagyasztott snapshotban"
              : "SHA-256 eltérés",
        };
      } catch (error) {
        return {
          path,
          expectedSha256,
          actualSha256: null,
          status: "FAIL" as const,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
  return {
    status: files.every((file) => file.status === "PASS") ? "PASS" : "FAIL",
    checkedAt: new Date().toISOString(),
    files,
  };
}

async function safeVerify(
  verify: (snapshotPath: string) => Promise<VerificationReport>,
  snapshotPath: string,
): Promise<VerificationReport> {
  try {
    return await verify(snapshotPath);
  } catch (error) {
    return {
      snapshotId: "unreadable",
      status: "FAIL",
      filesChecked: 0,
      rowsChecked: 0,
      rows: [
        {
          datasetId: "snapshot",
          path: snapshotPath,
          status: "FAIL",
          rows: null,
          firstTs: null,
          lastTs: null,
          issues: [error instanceof Error ? error.message : String(error)],
        },
      ],
    };
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function validJson(path: string): Promise<boolean> {
  try {
    JSON.parse(await readFile(path, "utf8"));
    return true;
  } catch {
    return false;
  }
}

function commandEquals(left: readonly string[], right: unknown): boolean {
  return (
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

async function readReusableProvenance(
  path: string,
  job: SearchJob,
  options: ExecutionOptions,
  snapshotSha256: string,
): Promise<ExecutionProvenance | null> {
  if (!options.resume || !(await exists(path)) || job.rawOutput === null || !(await exists(job.rawOutput)))
    return null;
  try {
    const value = await readJson(path);
    if (
      !isObject(value) ||
      value["status"] !== "SUCCESS" ||
      value["exitCode"] !== 0 ||
      value["codeRevision"] !== options.codeRevision ||
      value["dirtyDiffSha256"] !== options.dirtyDiffSha256 ||
      !commandEquals(job.command ?? [], value["command"])
    )
      return null;
    const snapshot = value["dataSnapshot"];
    if (!isObject(snapshot) || snapshot["sha256"] !== snapshotSha256) return null;
    const rawHash = typeof value["rawOutputSha256"] === "string" ? value["rawOutputSha256"] : null;
    if (
      rawHash === null ||
      rawHash !== (await sha256File(job.rawOutput)) ||
      !(await validJson(job.rawOutput))
    )
      return null;
    return value as unknown as ExecutionProvenance;
  } catch {
    return null;
  }
}

async function runOne(
  job: SearchJob,
  options: ExecutionOptions,
  allInputHashes: readonly InputHash[],
  batchPreflight: VerificationReport,
  snapshotSha256: string,
): Promise<SearchJob> {
  if (job.status !== "READY_DRY_RUN" || job.command === null || job.rawOutput === null) return job;
  const run = options.run ?? defaultRun;
  const expectedMap = new Map(allInputHashes.map((entry) => [entry.path, entry.sha256]));
  const inputHashes = job.inputFiles.map((path) => ({
    path,
    sha256: expectedMap.get(path) ?? "MISSING_FROM_SNAPSHOT",
  }));
  const provenancePath = `${job.rawOutput}.provenance.json`;
  const stdoutLog = resolve(options.outputDir, "logs", `${job.runId}.stdout.log`);
  const stderrLog = resolve(options.outputDir, "logs", `${job.runId}.stderr.log`);
  const startedAt = new Date().toISOString();
  const inputBefore = await verifyJobInputs(job, expectedMap);
  const base = {
    schemaVersion: 2 as const,
    runId: job.runId,
    strategyId: job.strategyId,
    startedAt,
    codeRevision: options.codeRevision,
    dirtyDiffSha256: options.dirtyDiffSha256,
    command: job.command,
    rawOutput: job.rawOutput,
    dataSnapshot: {
      path: options.snapshotPath,
      sha256: snapshotSha256,
      snapshotId: batchPreflight.snapshotId,
    },
    inputHashes,
    batchPreflight,
    inputBefore,
  };
  if (inputBefore.status !== "PASS") {
    const provenance: ExecutionProvenance = {
      ...base,
      status: "FAILED_INPUT_HASH_BEFORE",
      reason: "A job input SHA-256 ellenőrzése futás előtt sikertelen",
      finishedAt: new Date().toISOString(),
      exitCode: null,
      rawOutputSha256: null,
      stdoutLog: null,
      stderrLog: null,
      inputAfter: null,
      batchPostflight: null,
    };
    await writeText(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);
    return { ...job, status: provenance.status, reason: provenance.reason, provenancePath, exitCode: null };
  }
  const reusable = await readReusableProvenance(provenancePath, job, options, snapshotSha256);
  if (reusable !== null) {
    const inputAfter = await verifyJobInputs(job, expectedMap);
    const status = inputAfter.status === "PASS" ? "RESUMED" : "FAILED_INPUT_HASH_AFTER";
    const reason =
      inputAfter.status === "PASS"
        ? "Korábbi sikeres, azonos code/data/command futás újrafelhasználva"
        : "A resume utáni input SHA-256 ellenőrzés sikertelen";
    const resumed: ExecutionProvenance = {
      ...reusable,
      inputBefore,
      inputAfter,
      batchPreflight,
      batchPostflight: null,
      resumedFrom: reusable.finishedAt,
    };
    await writeText(provenancePath, `${JSON.stringify(resumed, null, 2)}\n`);
    return { ...job, status, reason, provenancePath, exitCode: reusable.exitCode };
  }
  await Promise.all([
    mkdir(dirname(job.rawOutput), { recursive: true }),
    mkdir(dirname(stdoutLog), { recursive: true }),
  ]);
  let processResult: ProcessResult | null = null;
  let spawnError: string | null = null;
  try {
    processResult = await run(job.command);
  } catch (error) {
    spawnError = error instanceof Error ? error.message : String(error);
  }
  await Promise.all([
    writeFile(stdoutLog, processResult?.stdout ?? "", "utf8"),
    writeFile(stderrLog, processResult?.stderr ?? `${spawnError ?? "Ismeretlen spawn hiba"}\n`, "utf8"),
  ]);
  const inputAfter = await verifyJobInputs(job, expectedMap);
  const rawExists = await exists(job.rawOutput);
  const outputValid = rawExists && (await validJson(job.rawOutput));
  let status = "SUCCESS";
  let reason: string | null = null;
  if (processResult === null) {
    status = "FAILED_SPAWN";
    reason = `A runner nem indult el: ${spawnError ?? "ismeretlen hiba"}`;
  } else if (processResult.exitCode !== 0) {
    status = "FAILED_EXIT";
    reason = `A runner exit code-ja ${processResult.exitCode}`;
  } else if (!rawExists) {
    status = "FAILED_MISSING_OUTPUT";
    reason = "A runner 0 exit code mellett sem hozta létre a raw outputot";
  } else if (!outputValid) {
    status = "FAILED_INVALID_OUTPUT";
    reason = "A raw output nem érvényes JSON";
  } else if (inputAfter.status !== "PASS") {
    status = "FAILED_INPUT_HASH_AFTER";
    reason = "A job input SHA-256 ellenőrzése futás után sikertelen";
  }
  const provenance: ExecutionProvenance = {
    ...base,
    status,
    reason,
    finishedAt: new Date().toISOString(),
    exitCode: processResult?.exitCode ?? null,
    rawOutputSha256: rawExists ? await sha256File(job.rawOutput) : null,
    stdoutLog,
    stderrLog,
    inputAfter,
    batchPostflight: null,
  };
  await writeText(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);
  return { ...job, status, reason, provenancePath, exitCode: processResult?.exitCode ?? null };
}

async function attachBatchPostflight(job: SearchJob, report: VerificationReport): Promise<SearchJob> {
  if (job.provenancePath === undefined || job.provenancePath === null) return job;
  let updated = job;
  try {
    const value = await readJson(job.provenancePath);
    if (isObject(value)) {
      const invalidate = report.status !== "PASS" && (job.status === "SUCCESS" || job.status === "RESUMED");
      const status = invalidate ? "FAILED_BATCH_SNAPSHOT_AFTER" : job.status;
      const reason = invalidate
        ? "A batch utáni teljes snapshot hash/coverage ellenőrzés sikertelen; a futás érvénytelen"
        : job.reason;
      await writeText(
        job.provenancePath,
        `${JSON.stringify({ ...value, status: invalidate ? status : value["status"], reason: invalidate ? reason : value["reason"], batchPostflight: report }, null, 2)}\n`,
      );
      if (invalidate) updated = { ...job, status, reason };
    }
  } catch {
    return {
      ...job,
      status: "FAILED_PROVENANCE",
      reason: "A batch postflight nem írható a provenance sidecarba",
    };
  }
  return updated;
}

export async function executeSearchJobs(
  jobs: readonly SearchJob[],
  options: ExecutionOptions,
): Promise<readonly SearchJob[]> {
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1)
    throw new Error("A concurrency pozitív egész legyen");
  const verify = options.verify ?? ((path: string) => verifySnapshot(path));
  const batchPreflight = await safeVerify(verify, options.snapshotPath);
  const snapshotSha256 = await sha256File(options.snapshotPath);
  const allInputHashes = await snapshotInputHashes(options.snapshotPath);
  if (batchPreflight.status !== "PASS") {
    return jobs.map((job) =>
      job.status === "READY_DRY_RUN"
        ? {
            ...job,
            status: "FAILED_BATCH_SNAPSHOT_BEFORE",
            reason: "A batch előtti teljes snapshot hash/coverage ellenőrzés sikertelen",
            exitCode: null,
          }
        : job,
    );
  }
  const results = [...jobs];
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const index = cursor++;
      const job = jobs[index];
      if (job === undefined) return;
      results[index] = await runOne(job, options, allInputHashes, batchPreflight, snapshotSha256);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(options.concurrency, Math.max(1, jobs.length)) }, () => worker()),
  );
  const batchPostflight = await safeVerify(verify, options.snapshotPath);
  return await Promise.all(results.map((job) => attachBatchPostflight(job, batchPostflight)));
}
