import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  generateCombinationMatrix,
  matrixToCsv,
  PRODUCTION_COMPONENTS,
} from "../scripts/generate-combination-matrix.js";
import { normalizeDocument, normalizeFiles, type NormalizedResult } from "../scripts/normalize-results.js";
import {
  buildRunnableManifest,
  buildSearchManifest,
  parseRunSearchArgs,
  type SearchJob,
} from "../scripts/run-search.js";
import { executeSearchJobs } from "../scripts/search-execution.js";
import { parseNdjson, resultsToCsv, resultsToMarkdown } from "../scripts/summarize-results.js";
import { verifySnapshot } from "../scripts/verify-data.js";

const REPO_ROOT = resolve(import.meta.dir, "..", "..");
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("production kombinációs mátrix", () => {
  it("pontosan 31 egyedi, nem üres maskot ad", () => {
    const rows = generateCombinationMatrix();
    expect(PRODUCTION_COMPONENTS).toHaveLength(5);
    expect(rows).toHaveLength(31);
    expect(new Set(rows.map((row) => row.mask)).size).toBe(31);
    expect(rows.every((row) => row.enabled.length > 0)).toBe(true);
    expect(rows.every((row) => row.reason.length > 0)).toBe(true);
  });

  it("a státuszprecedencia minden maskot őszintén osztályoz", () => {
    const rows = generateCombinationMatrix();
    expect(rows.filter((row) => row.status === "UNSUPPORTED_DATA")).toHaveLength(16);
    expect(rows.filter((row) => row.status === "SUPPORTED_REAL_DATA")).toHaveLength(4);
    expect(rows.filter((row) => row.status === "BLOCKED_MISSING_DATA")).toHaveLength(1);
    expect(rows.filter((row) => row.status === "FUNCTIONAL_REPLAY_ONLY")).toHaveLength(1);
    expect(rows.filter((row) => row.status === "UNSUPPORTED_SIGNAL_REPLAY")).toHaveLength(1);
    expect(rows.filter((row) => row.status === "UNSUPPORTED_JOINT_RUNNER")).toHaveLength(8);
    const dpc = rows.find((row) => row.mask === "10000");
    expect(dpc?.status).toBe("SUPPORTED_REAL_DATA");
    expect(dpc?.validSymbols).toEqual(["BTC/USDT", "ETH/USDT", "SOL/USDT"]);
    const dpcRegime = rows.find((row) => row.mask === "10001");
    expect(dpcRegime?.status).toBe("SUPPORTED_REAL_DATA");
    expect(dpcRegime?.validSymbols).toEqual(["BTC/USDT", "ETH/USDT", "SOL/USDT"]);
    expect(dpcRegime?.invalidSymbols).toEqual([]);
    for (const mask of ["10010", "10011"]) {
      const row = rows.find((candidate) => candidate.mask === mask);
      expect(row?.status).toBe("SUPPORTED_REAL_DATA");
      expect(row?.validSymbols).toEqual(["SOL/USDT"]);
      expect(row?.invalidSymbols).toEqual(["BTC/USDT", "ETH/USDT"]);
    }
    expect(rows.find((row) => row.mask === "00011")?.status).toBe("UNSUPPORTED_JOINT_RUNNER");
    expect(rows.find((row) => row.mask === "01000")?.status).toBe("BLOCKED_MISSING_DATA");
    expect(rows.find((row) => row.mask === "00010")?.status).toBe("FUNCTIONAL_REPLAY_ONLY");
    expect(rows.find((row) => row.mask === "00001")?.status).toBe("UNSUPPORTED_SIGNAL_REPLAY");
  });

  it("a CSV-ben minden mask egy adatsor", () => {
    const csv = matrixToCsv(generateCombinationMatrix());
    expect(csv.trimEnd().split("\n")).toHaveLength(32);
    expect(csv.split("\n")[0]).toContain("mask");
    expect(csv.split("\n")[0]).toContain("valid_symbols");
    expect(csv.split("\n")[0]).toContain("invalid_symbols");
    expect(csv).toContain("reason");
  });
});

describe("dry-run job manifest", () => {
  it("mind a 31 maskot képviseli, és a támogatott maskokat a helyes runnerre irányítja", async () => {
    const manifest = await buildSearchManifest(resolve(REPO_ROOT, "search-best-config/grids.json"));
    const jobs = manifest["jobs"];
    const masks = manifest["representedMasks"];
    expect(manifest["combinationCount"]).toBe(31);
    expect(Array.isArray(masks) ? new Set(masks).size : 0).toBe(31);
    expect(Array.isArray(jobs)).toBe(true);
    if (!Array.isArray(jobs)) throw new Error("jobs nem tömb");
    expect(jobs).toHaveLength(267);
    const ready = jobs.filter(
      (job) => typeof job === "object" && job !== null && Reflect.get(job, "status") === "READY_DRY_RUN",
    );
    expect(ready).toHaveLength(240);
    expect(ready.every((job) => Array.isArray(Reflect.get(job, "command")))).toBe(true);
    const nonReady = jobs.filter(
      (job) => typeof job === "object" && job !== null && Reflect.get(job, "status") !== "READY_DRY_RUN",
    );
    expect(nonReady).toHaveLength(27);
    expect(nonReady.every((job) => Reflect.get(job, "command") === null)).toBe(true);

    const readyForMask = (mask: string) => ready.filter((job) => Reflect.get(job, "componentMask") === mask);
    const commandsForMask = (mask: string) =>
      readyForMask(mask).map((job) => Reflect.get(job, "command") as readonly string[]);
    expect(readyForMask("10000")).toHaveLength(90);
    expect(
      commandsForMask("10000").every(
        (command) =>
          command.includes("packages/backtest-tools/src/cli/run-donchian-pivot-composition.ts") &&
          !command.some((part) => part.startsWith("--mask=")),
      ),
    ).toBe(true);

    expect(readyForMask("10001")).toHaveLength(90);
    expect(
      commandsForMask("10001").every(
        (command) =>
          command.includes("search-best-config/scripts/run-overlay-adapter.ts") &&
          command.includes("--mask=dpc-regime"),
      ),
    ).toBe(true);
    expect(new Set(readyForMask("10001").map((job) => Reflect.get(job, "parameters").symbol))).toEqual(
      new Set(["BTC/USDT", "ETH/USDT", "SOL/USDT"]),
    );

    expect(readyForMask("10010")).toHaveLength(30);
    expect(
      commandsForMask("10010").every(
        (command) =>
          command.includes("search-best-config/scripts/run-overlay-adapter.ts") &&
          command.includes("--mask=dpc-solflip") &&
          command.includes("--symbol=SOL/USDT"),
      ),
    ).toBe(true);
    expect(new Set(readyForMask("10010").map((job) => Reflect.get(job, "parameters").symbol))).toEqual(
      new Set(["SOL/USDT"]),
    );

    expect(readyForMask("10011")).toHaveLength(30);
    expect(
      commandsForMask("10011").every(
        (command) =>
          command.includes("search-best-config/scripts/run-overlay-adapter.ts") &&
          command.includes("--mask=dpc-solflip-regime") &&
          command.includes("--symbol=SOL/USDT"),
      ),
    ).toBe(true);
    expect(new Set(readyForMask("10011").map((job) => Reflect.get(job, "parameters").symbol))).toEqual(
      new Set(["SOL/USDT"]),
    );
  });

  it("az öt elérhető runner véges IS gridjét generálja", async () => {
    const tempDir = await mkdtemp(resolve(tmpdir(), "search-best-config-manifest-"));
    tempDirs.push(tempDir);
    const manifest = await buildRunnableManifest(
      resolve(REPO_ROOT, "search-best-config/grids.json"),
      ["is"],
      [
        "donchian_pivot_composition",
        "donchian_range_channel",
        "pivot_point_grid",
        "ohlc_trend",
        "funding_flip_kill_switch",
      ],
      tempDir,
    );
    const jobs = manifest["jobs"];
    expect(Array.isArray(jobs)).toBe(true);
    if (!Array.isArray(jobs)) throw new Error("jobs nem tömb");
    expect(jobs).toHaveLength(369);
    const counts = new Map<string, number>();
    for (const job of jobs) {
      const id = String(Reflect.get(job as object, "strategyId"));
      counts.set(id, (counts.get(id) ?? 0) + 1);
      expect(Reflect.get(job as object, "status")).toBe("READY_DRY_RUN");
      expect(Array.isArray(Reflect.get(job as object, "command"))).toBe(true);
    }
    expect(counts.get("donchian_pivot_composition")).toBe(30);
    expect(counts.get("donchian_range_channel")).toBe(27);
    expect(counts.get("pivot_point_grid")).toBe(15);
    expect(counts.get("ohlc_trend")).toBe(216);
    expect(counts.get("funding_flip_kill_switch")).toBe(81);
  });

  it("az execute CLI flag-eket és aliasokat szigorúan értelmezi", () => {
    const parsed = parseRunSearchArgs([
      "--execute",
      "--strategy=drc,solflip",
      "--phase=is,oos",
      "--concurrency=3",
      "--resume=false",
      "--output-dir=/tmp/search-test",
    ]);
    expect(parsed.execute).toBe(true);
    expect(parsed.strategies).toEqual(["donchian_range_channel", "funding_flip_kill_switch"]);
    expect(parsed.phases).toEqual(["is", "oos"]);
    expect(parsed.concurrency).toBe(3);
    expect(parsed.resume).toBe(false);
    expect(() => parseRunSearchArgs(["--concurrency=0"])).toThrow(/concurrency/);
    expect(() => parseRunSearchArgs(["--unknown=true"])).toThrow(/Ismeretlen/);
  });

  it("a SOLFlip véges 3×3×3×3 gridje mindhárom spliten 243 replay sort ad", async () => {
    const tempDir = await mkdtemp(resolve(tmpdir(), "search-best-config-solflip-grid-"));
    tempDirs.push(tempDir);
    const manifest = await buildRunnableManifest(
      resolve(REPO_ROOT, "search-best-config/grids.json"),
      ["is", "validation", "oos"],
      ["funding_flip_kill_switch"],
      tempDir,
    );
    const jobs = manifest["jobs"];
    expect(Array.isArray(jobs) ? jobs.length : 0).toBe(243);
    expect(
      Array.isArray(jobs) && jobs.every((job) => Reflect.get(job as object, "status") === "READY_DRY_RUN"),
    ).toBe(true);
  });

  it("az overlay help+valós minimál smoke után 80 runnable és 40 invalid IS sort ad", async () => {
    const tempDir = await mkdtemp(resolve(tmpdir(), "search-best-config-overlay-grid-"));
    tempDirs.push(tempDir);
    const manifest = await buildRunnableManifest(
      resolve(REPO_ROOT, "search-best-config/grids.json"),
      ["is"],
      ["overlay_combination"],
      tempDir,
    );
    const jobs = manifest["jobs"];
    expect(Array.isArray(jobs) ? jobs.length : 0).toBe(120);
    if (!Array.isArray(jobs)) throw new Error("jobs nem tömb");
    expect(jobs.filter((job) => Reflect.get(job as object, "status") === "READY_DRY_RUN")).toHaveLength(80);
    expect(jobs.filter((job) => Reflect.get(job as object, "status") === "INVALID_MASK")).toHaveLength(40);
    expect(jobs.filter((job) => Reflect.get(job as object, "status") === "UNSUPPORTED_ADAPTER")).toHaveLength(
      0,
    );
  }, 15_000);
});

describe("resume-képes execute", () => {
  function fixtureJob(
    rawOutput: string,
    runId = "mock-success",
    command: readonly string[] = ["mock", "success"],
  ): SearchJob {
    return {
      runId,
      componentMask: "fixture",
      enabledComponents: ["fixture"],
      strategyId: "fixture",
      status: "READY_DRY_RUN",
      reason: null,
      parameters: { symbol: "BTC/USDT" },
      split: { id: "is", start: "2024-01-01", end: "2024-01-02" },
      command,
      rawOutput,
      inputFiles: [],
      metrics: {},
    };
  }

  async function fixtureContext(): Promise<{ readonly tempDir: string; readonly snapshot: string }> {
    const tempDir = await mkdtemp(resolve(tmpdir(), "search-best-config-execute-"));
    tempDirs.push(tempDir);
    const snapshot = resolve(tempDir, "snapshot.json");
    await writeFile(
      snapshot,
      JSON.stringify({ schemaVersion: 1, snapshotId: "fixture", datasets: [] }),
      "utf8",
    );
    return { tempDir, snapshot };
  }

  const passReport = () =>
    Promise.resolve({
      snapshotId: "fixture",
      status: "PASS" as const,
      filesChecked: 0,
      rowsChecked: 0,
      rows: [],
    });

  it("raw outputot, logot és teljes provenance sidecart ír, majd hash alapján resume-ol", async () => {
    const { tempDir, snapshot } = await fixtureContext();
    const rawOutput = resolve(tempDir, "raw", "mock-success.json");
    const job = fixtureJob(rawOutput);
    let verifyCalls = 0;
    let runCalls = 0;
    const options = {
      outputDir: tempDir,
      snapshotPath: snapshot,
      concurrency: 1,
      resume: true,
      codeRevision: "abc123",
      dirtyDiffSha256: "dirty123",
      verify: async () => {
        verifyCalls += 1;
        return passReport();
      },
      run: async () => {
        runCalls += 1;
        await mkdir(resolve(tempDir, "raw"), { recursive: true });
        await writeFile(rawOutput, JSON.stringify({ strategy: "fixture", result: {} }), "utf8");
        return { exitCode: 0, stdout: "ok\n", stderr: "" };
      },
    };
    const first = await executeSearchJobs([job], options);
    expect(first[0]?.status).toBe("SUCCESS");
    expect(first[0]?.exitCode).toBe(0);
    expect(verifyCalls).toBe(2);
    const provenancePath = first[0]?.provenancePath;
    expect(typeof provenancePath).toBe("string");
    const provenance = JSON.parse(await readFile(String(provenancePath), "utf8")) as Record<string, unknown>;
    expect(provenance["codeRevision"]).toBe("abc123");
    expect(provenance["dirtyDiffSha256"]).toBe("dirty123");
    expect(provenance["exitCode"]).toBe(0);
    expect(typeof provenance["rawOutputSha256"]).toBe("string");
    expect(Array.isArray(provenance["inputHashes"])).toBe(true);

    verifyCalls = 0;
    const resumed = await executeSearchJobs([job], {
      ...options,
      run: async () => {
        throw new Error("resume alatt nem futhat runner");
      },
    });
    expect(resumed[0]?.status).toBe("RESUMED");
    expect(runCalls).toBe(1);
    expect(verifyCalls).toBe(2);
  });

  it("a nem nulla exitet és a hiányzó outputot külön FAILED sorban őrzi meg", async () => {
    const { tempDir, snapshot } = await fixtureContext();
    const exitJob = fixtureJob(resolve(tempDir, "raw", "failed-exit.json"), "failed-exit", ["mock", "exit"]);
    const missingJob = fixtureJob(resolve(tempDir, "raw", "missing.json"), "missing", ["mock", "missing"]);
    let verifyCalls = 0;
    const rows = await executeSearchJobs([exitJob, missingJob], {
      outputDir: tempDir,
      snapshotPath: snapshot,
      concurrency: 2,
      resume: false,
      codeRevision: "abc123",
      dirtyDiffSha256: "dirty123",
      verify: async () => {
        verifyCalls += 1;
        return passReport();
      },
      run: async (command) =>
        command[1] === "exit"
          ? { exitCode: 9, stdout: "", stderr: "boom" }
          : { exitCode: 0, stdout: "no output", stderr: "" },
    });
    expect(rows.map((row) => row.status)).toEqual(["FAILED_EXIT", "FAILED_MISSING_OUTPUT"]);
    expect(rows.map((row) => row.exitCode)).toEqual([9, 0]);
    expect(verifyCalls).toBe(2);
    expect(rows.every((row) => typeof row.provenancePath === "string")).toBe(true);
  });

  it("snapshot preflight hibánál nem indítja el a runnert", async () => {
    const { tempDir, snapshot } = await fixtureContext();
    const job = fixtureJob(resolve(tempDir, "raw", "blocked.json"), "blocked");
    let runCalls = 0;
    const rows = await executeSearchJobs([job], {
      outputDir: tempDir,
      snapshotPath: snapshot,
      concurrency: 1,
      resume: false,
      codeRevision: null,
      dirtyDiffSha256: "dirty",
      verify: async () => ({
        snapshotId: "fixture",
        status: "FAIL",
        filesChecked: 1,
        rowsChecked: 0,
        rows: [],
      }),
      run: async () => {
        runCalls += 1;
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });
    expect(rows[0]?.status).toBe("FAILED_BATCH_SNAPSHOT_BEFORE");
    expect(runCalls).toBe(0);
  });

  it("a job saját input hash eltérését runner-indítás előtt megfogja", async () => {
    const { tempDir, snapshot } = await fixtureContext();
    const input = resolve(tempDir, "fixture-input.csv");
    await writeFile(input, "changed", "utf8");
    await writeFile(
      snapshot,
      JSON.stringify({
        schemaVersion: 1,
        snapshotId: "fixture",
        datasets: [{ files: [{ path: input, sha256: "not-the-real-hash" }] }],
      }),
      "utf8",
    );
    const job = {
      ...fixtureJob(resolve(tempDir, "raw", "hash-fail.json"), "hash-fail"),
      inputFiles: [input],
    };
    let runCalls = 0;
    const rows = await executeSearchJobs([job], {
      outputDir: tempDir,
      snapshotPath: snapshot,
      concurrency: 1,
      resume: false,
      codeRevision: "abc",
      dirtyDiffSha256: "dirty",
      verify: passReport,
      run: async () => {
        runCalls += 1;
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });
    expect(rows[0]?.status).toBe("FAILED_INPUT_HASH_BEFORE");
    expect(runCalls).toBe(0);
  });

  it("a batch postflight hiba a már sikeres sort is érvényteleníti", async () => {
    const { tempDir, snapshot } = await fixtureContext();
    const rawOutput = resolve(tempDir, "raw", "postflight.json");
    const job = fixtureJob(rawOutput, "postflight");
    let verifyCalls = 0;
    const rows = await executeSearchJobs([job], {
      outputDir: tempDir,
      snapshotPath: snapshot,
      concurrency: 1,
      resume: false,
      codeRevision: "abc",
      dirtyDiffSha256: "dirty",
      verify: async () => {
        verifyCalls += 1;
        return verifyCalls === 1
          ? passReport()
          : { snapshotId: "fixture", status: "FAIL" as const, filesChecked: 0, rowsChecked: 0, rows: [] };
      },
      run: async () => {
        await mkdir(resolve(tempDir, "raw"), { recursive: true });
        await writeFile(rawOutput, JSON.stringify({ result: {} }), "utf8");
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });
    expect(rows[0]?.status).toBe("FAILED_BATCH_SNAPSHOT_AFTER");
    expect(verifyCalls).toBe(2);
  });
});

describe("eredménynormalizálás", () => {
  it("a DPC összes metrikáját százalékpontra normalizálja, DD-vel", () => {
    const rows = normalizeDocument(
      {
        strategy: "donchian-pivot-composition",
        args: {
          symbol: "BTC/USDT",
          minConsensus: 1,
          maxPositionPctEquity: 0.12,
          startTime: "2026-01-01T00:00:00.000Z",
          endTime: "2026-07-09T00:00:00.000Z",
        },
        monthlyReturn: 0.2,
        result: {
          totalReturn: 1.5,
          annualizedReturn: 2.5,
          maxDrawdown: 0.047,
          sharpeRatio: 3,
          sortinoRatio: 4,
          profitFactor: 2,
          winRate: 0.6,
          totalTrades: 123,
          killSwitchTriggered: false,
        },
      },
      "sample.json",
    );
    expect(rows).toHaveLength(1);
    const metrics = rows[0]?.metrics;
    expect(metrics?.totalReturnPct).toBe(150);
    expect(metrics?.monthlyReturnPct).toBe(20);
    expect(metrics?.maxDrawdownPct).toBeCloseTo(4.7);
    expect(metrics?.sharpe).toBe(3);
    expect(metrics?.sortino).toBe(4);
    expect(metrics?.profitFactor).toBe(2);
    expect(metrics?.winRatePct).toBe(60);
    expect(metrics?.totalTrades).toBe(123);
    expect(metrics?.killSwitchTriggered).toBe(false);
    expect(rows[0]?.split.name).toBe("oos");
    expect(rows[0]?.status).toBe("LEGACY_UNVERIFIED_PROVENANCE");
  });

  it("a JSON-ban null-lá vált végtelen profit factort a raw trade-okból visszaállítja", () => {
    const row = normalizeDocument(
      {
        strategy: "ohlc-trend",
        monthlyReturn: 0.01,
        result: {
          totalReturn: 0.1,
          annualizedReturn: 0.2,
          maxDrawdown: 0.01,
          sharpeRatio: 1,
          sortinoRatio: 2,
          profitFactor: null,
          winRate: 1,
          totalTrades: 2,
          trades: [{ pnlUsd: 10 }, { pnlUsd: 5 }],
        },
      },
      "infinite-pf.json",
    )[0];
    expect(row?.metrics.profitFactor).toBe("Infinity");
  });

  it("a ritka carry adatot sikertelen coverage-ként tartja meg", () => {
    const row = normalizeDocument(
      {
        args: { symbol: "btc" },
        windowDays: 90,
        dydxHourlyCount: 72,
        result: { monthlyCarry: 0.01, maxDrawdown: 0.02, dataSufficientDays: 3 },
      },
      "carry.json",
    )[0];
    expect(row?.strategyId).toBe("dydx_cex_carry");
    expect(row?.status).toBe("FAILED_DATA_COVERAGE");
    expect(row?.coverage["hourlyCoverageRatio"]).toBeCloseTo(72 / 2160);
    expect(row?.metrics.maxDrawdownPct).toBe(2);
  });

  it("a szintetikus Cascade artifactot nem nevezi valós backtestnek", () => {
    const row = normalizeDocument(
      {
        dataSource: "documented synthetic substitute",
        detectorResult: {},
      },
      "cascade.json",
    )[0];
    expect(row?.strategyId).toBe("cascade_fade");
    expect(row?.status).toBe("UNSUPPORTED_SYNTHETIC");
    expect(row?.metrics.maxDrawdownPct).toBeNull();
  });

  it("a job manifest minden jobját külön sorban őrzi meg", () => {
    const rows = normalizeDocument(
      {
        codeRevision: "abc",
        jobs: [
          { runId: "a", strategyId: "x", status: "SKIP", reason: "nincs", metrics: {} },
          { runId: "b", strategyId: "y", status: "READY_DRY_RUN", metrics: {} },
        ],
      },
      "jobs.json",
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.runId)).toEqual(["a", "b"]);
    expect(rows.every((row) => row.codeRevision === "abc")).toBe(true);
  });

  it("hibás JSON esetén is létrehoz egy FAILED_PARSE sort", async () => {
    const tempDir = await mkdtemp(resolve(tmpdir(), "search-best-config-normalize-"));
    tempDirs.push(tempDir);
    await writeFile(resolve(tempDir, "bad.json"), "{", "utf8");
    await writeFile(resolve(tempDir, "good.json"), JSON.stringify({ strategy: "x", result: {} }), "utf8");
    const rows = await normalizeFiles(tempDir);
    expect(rows).toHaveLength(2);
    expect(rows.some((row) => row.status === "FAILED_PARSE")).toBe(true);
    expect(rows.some((row) => row.strategyId === "x")).toBe(true);
  });

  it("az execute manifestből az overlay teljes metrikáját és provenance-ét egy sorba egyesíti", async () => {
    const tempDir = await mkdtemp(resolve(tmpdir(), "search-best-config-overlay-normalize-"));
    tempDirs.push(tempDir);
    const raw = resolve(tempDir, "raw", "overlay.json");
    const provenance = `${raw}.provenance.json`;
    await mkdir(resolve(tempDir, "raw"), { recursive: true });
    await writeFile(
      raw,
      JSON.stringify({
        mask: "dpc-regime",
        args: { symbol: "BTC/USDT" },
        inputProvenance: { ohlcv: { coverageRatio: 1 } },
        derivedMetrics: { monthlyReturn: 0.02, totalFeesUsd: 12, netPnlUsd: 100 },
        overlayMetrics: { regimeModifiedEntries: 7, lookaheadViolations: 0 },
        result: {
          totalReturn: 0.1,
          annualizedReturn: 0.25,
          maxDrawdown: 0.04,
          sharpeRatio: 1.2,
          sortinoRatio: 1.5,
          profitFactor: 1.4,
          winRate: 0.55,
          totalTrades: 12,
          killSwitchTriggered: false,
        },
      }),
      "utf8",
    );
    await writeFile(
      provenance,
      JSON.stringify({
        codeRevision: "abc",
        dirtyDiffSha256: "dirty",
        inputHashes: [{ path: "data.csv", sha256: "hash" }],
        exitCode: 0,
      }),
      "utf8",
    );
    await writeFile(
      resolve(tempDir, "run-manifest.json"),
      JSON.stringify({
        dryRun: false,
        codeRevision: "abc",
        jobs: [
          {
            runId: "overlay-is",
            strategyId: "overlay_combination",
            componentMask: "dpc-regime",
            status: "SUCCESS",
            reason: null,
            parameters: { symbol: "BTC/USDT" },
            split: { id: "is", start: "2024-01-01", end: "2025-07-01" },
            rawOutput: raw,
            provenancePath: provenance,
            inputFiles: ["data.csv"],
            metrics: {},
          },
        ],
      }),
      "utf8",
    );
    const rows = await normalizeFiles(tempDir);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("SUCCESS");
    expect(rows[0]?.metrics.totalReturnPct).toBe(10);
    expect(rows[0]?.metrics.monthlyReturnPct).toBe(2);
    expect(rows[0]?.metrics.maxDrawdownPct).toBe(4);
    expect(rows[0]?.extendedMetrics["derivedMetrics"]).toEqual({
      monthlyReturn: 0.02,
      totalFeesUsd: 12,
      netPnlUsd: 100,
    });
    expect(rows[0]?.extendedMetrics["overlayMetrics"]).toEqual({
      regimeModifiedEntries: 7,
      lookaheadViolations: 0,
    });
    expect(rows[0]?.provenance["dirtyDiffSha256"]).toBe("dirty");
    expect(rows[0]?.dataInputs).toEqual([{ path: "data.csv", sha256: "hash" }]);
  });

  it("SUCCESS, RESUMED, INVALID és FAILED jobból pontosan egy-egy teljes táblasor marad", async () => {
    const tempDir = await mkdtemp(resolve(tmpdir(), "search-best-config-status-table-"));
    tempDirs.push(tempDir);
    await mkdir(resolve(tempDir, "raw"), { recursive: true });
    const result = {
      totalReturn: 0.12,
      annualizedReturn: 0.24,
      maxDrawdown: 0.03,
      sharpeRatio: 1.1,
      sortinoRatio: 1.4,
      profitFactor: 1.6,
      winRate: 0.58,
      totalTrades: 20,
      killSwitchTriggered: false,
    };
    const runnable = [
      { runId: "success", strategyId: "donchian_range_channel", status: "SUCCESS" },
      { runId: "resumed", strategyId: "ohlc_trend", status: "RESUMED" },
    ] as const;
    const jobs: Record<string, unknown>[] = [];
    for (const item of runnable) {
      const rawOutput = resolve(tempDir, "raw", `${item.runId}.json`);
      const provenancePath = `${rawOutput}.provenance.json`;
      await writeFile(
        rawOutput,
        JSON.stringify({ strategy: item.strategyId, monthlyReturn: 0.01, result }),
        "utf8",
      );
      await writeFile(
        provenancePath,
        JSON.stringify({
          codeRevision: "abc",
          dirtyDiffSha256: "dirty",
          inputHashes: [{ path: "input.csv", sha256: "hash" }],
          exitCode: 0,
        }),
        "utf8",
      );
      jobs.push({
        ...item,
        componentMask: "fixture",
        reason: null,
        parameters: { symbol: "BTC/USDT" },
        split: { id: "is", start: "2024-01-01", end: "2025-07-01" },
        rawOutput,
        provenancePath,
        inputFiles: ["input.csv"],
        metrics: {},
      });
    }
    jobs.push(
      {
        runId: "invalid",
        strategyId: "overlay_combination",
        componentMask: "dpc-solflip",
        status: "INVALID_MASK",
        reason: "SOL only",
        parameters: { symbol: "BTC/USDT" },
        split: { id: "is", start: "2024-01-01", end: "2025-07-01" },
        rawOutput: null,
        metrics: {},
      },
      {
        runId: "failed",
        strategyId: "pivot_point_grid",
        componentMask: "fixture",
        status: "FAILED_EXIT",
        reason: "exit 9",
        parameters: { symbol: "BTC/USDT" },
        split: { id: "is", start: "2024-01-01", end: "2025-07-01" },
        rawOutput: null,
        exitCode: 9,
        metrics: {},
      },
    );
    await writeFile(
      resolve(tempDir, "run-manifest.json"),
      JSON.stringify({ dryRun: false, codeRevision: "abc", jobs }),
      "utf8",
    );
    const rows = await normalizeFiles(tempDir);
    expect(rows).toHaveLength(4);
    expect(rows.map((row) => row.status)).toEqual(["SUCCESS", "RESUMED", "INVALID_MASK", "FAILED_EXIT"]);
    for (const row of rows.slice(0, 2)) {
      expect(
        Object.values(row.metrics)
          .slice(0, 9)
          .every((value) => value !== null),
      ).toBe(true);
      expect(row.metrics.totalReturnPct).toBe(12);
      expect(row.metrics.monthlyReturnPct).toBe(1);
      expect(row.metrics.annualizedReturnPct).toBe(24);
      expect(row.metrics.maxDrawdownPct).toBe(3);
      expect(row.provenance["dirtyDiffSha256"]).toBe("dirty");
    }
    expect(rows.slice(2).every((row) => Object.values(row.metrics).every((value) => value === null))).toBe(
      true,
    );
    expect(resultsToCsv(rows).trimEnd().split("\n")).toHaveLength(5);
    expect(resultsToMarkdown(rows)).toContain("Sorok száma: 4");
  });
});

describe("teljes táblák", () => {
  const rows: readonly NormalizedResult[] = normalizeDocument(
    {
      jobs: [
        {
          schemaVersion: 1,
          runId: "one",
          strategyId: "dpc",
          status: "PASS",
          metrics: {
            totalReturnPct: 10,
            monthlyReturnPct: 2,
            annualizedReturnPct: 20,
            maxDrawdownPct: 4,
            sharpe: 1,
            sortino: 2,
            profitFactor: 1.5,
            winRatePct: 55,
            totalTrades: 20,
            killSwitchTriggered: false,
          },
        },
        {
          schemaVersion: 1,
          runId: "two",
          strategyId: "plugin",
          status: "FUNCTIONAL_REPLAY_ONLY",
          reason: "PnL nincs",
          metrics: {},
        },
      ],
    },
    "fixture.json",
  );

  it("a CSV nem veszít sort és minden metrikaoszlopot tartalmaz", () => {
    const csv = resultsToCsv(rows);
    expect(csv.trimEnd().split("\n")).toHaveLength(3);
    for (const header of [
      "maxDrawdownPct",
      "sharpe",
      "sortino",
      "profitFactor",
      "winRatePct",
      "totalTrades",
      "killSwitchTriggered",
      "extendedMetrics",
      "provenance",
    ]) {
      expect(csv.split("\n")[0]).toContain(header);
    }
  });

  it("a már normalizált sor eredeti rawOutput hivatkozását megőrzi", () => {
    const normalizedAgain = normalizeDocument(rows[0], "normalized.ndjson#line-1");
    expect(normalizedAgain[0]?.rawOutput).toBe("fixture.json#jobs[0]");
  });

  it("a Markdown nem veszít sort és jelzi a sorszámot", () => {
    const markdown = resultsToMarkdown(rows);
    expect(markdown).toContain("Sorok száma: 2");
    expect(markdown).toContain("| one |");
    expect(markdown).toContain("| two |");
    expect(markdown).toContain("maxDrawdownPct");
  });

  it("a hibás NDJSON sort is megőrzi", () => {
    const ndjson = `${JSON.stringify(rows[0])}\n{\n`;
    const parsed = parseNdjson(ndjson, "fixture.ndjson");
    expect(parsed).toHaveLength(2);
    expect(parsed[1]?.status).toBe("FAILED_PARSE");
  });
});

describe("valós adatsnapshot", () => {
  it("minden fagyasztott fájl hash/coverage ellenőrzése PASS", async () => {
    const report = await verifySnapshot(resolve(REPO_ROOT, "search-best-config/data-snapshot.json"));
    expect(report.status).toBe("PASS");
    expect(report.filesChecked).toBe(19);
    expect(report.rowsChecked).toBe(1_155_353);
    expect(report.rows.every((row) => row.issues.length === 0)).toBe(true);
  }, 15_000);
});
