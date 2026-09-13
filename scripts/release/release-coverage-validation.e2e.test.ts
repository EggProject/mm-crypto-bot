import { describe, expect, test } from "vitest";

import {
  createReleaseCoverageCommand,
  parseReleaseCoverageArguments,
  runReleaseCoverage,
  sanitizeReleaseCoverageEnvironment,
  type ReleaseCoverageChildInput,
  type ReleaseCoverageDependencies,
} from "./release-coverage";

const repoRoot = "/trusted/repository";
const releaseDirectory = `${repoRoot}/scripts/release`;
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
  "release-set-contract.ts",
  "release-set-zip.ts",
  "release-set-assembler.ts",
  "release-set-verifier.ts",
  "release-set-publication.ts",
  "release-set-reproducibility.ts",
  "release-ports.ts",
  "release-coverage-node-gate.ts",
] as const;
const e2eSources = [
  "release-assembler.ts",
  "release-smoke.ts",
  "release-private-candidate-reproducibility.ts",
  "release-set-contract.ts",
  "release-set-zip.ts",
  "release-set-assembler.ts",
  "release-set-verifier.ts",
  "release-set-publication.ts",
  "release-set-reproducibility.ts",
  "release-ports.ts",
  "release-coverage.ts",
  "release-coverage-node-gate.ts",
  "release-artifact-verifier.ts",
  "verify.ts",
] as const;
type ReportName = "unitSummary" | "unitLcov" | "e2eSummary" | "e2eLcov";

interface Fixture {
  readonly calls: ReleaseCoverageChildInput[];
  readonly dependencies: ReleaseCoverageDependencies;
  readonly reads: ReportName[];
  readonly reports: Map<ReportName, string>;
}

function metrics(branchTotal = 1, branchCovered = branchTotal): Record<string, unknown> {
  return {
    branches: { covered: branchCovered, pct: 100, total: branchTotal },
    functions: { covered: 1, pct: 100, total: 1 },
    lines: { covered: 1, pct: 100, total: 1 },
    statements: { covered: 1, pct: 100, total: 1 },
  };
}

function coverageSummary(sources: readonly string[], metric = metrics()): string {
  const sourceEntries = Object.fromEntries(
    sources.map((source) => [`${releaseDirectory}/${source}`, metric]),
  );
  return JSON.stringify({ total: metric, ...sourceEntries });
}

function lcovRecord(source: string, branchTotal = 1, branchCovered = branchTotal): string {
  return [
    `SF:${source}`,
    "LF:1",
    "LH:1",
    "FNF:1",
    "FNH:1",
    `BRF:${String(branchTotal)}`,
    `BRH:${String(branchCovered)}`,
    "end_of_record",
    "",
  ].join("\n");
}

function coverageLcov(sources: readonly string[], branchTotal = 1, branchCovered = branchTotal): string {
  return sources.map((source) => lcovRecord(source, branchTotal, branchCovered)).join("");
}

function fixture(): Fixture {
  const calls: ReleaseCoverageChildInput[] = [];
  const reads: ReportName[] = [];
  const reports = new Map<ReportName, string>([
    ["unitSummary", coverageSummary(unitSources)],
    ["unitLcov", coverageLcov(unitSources)],
    ["e2eSummary", coverageSummary(e2eSources)],
    ["e2eLcov", coverageLcov(e2eSources)],
  ]);
  const read = (name: ReportName): Promise<string> => {
    reads.push(name);
    const report = reports.get(name);
    return report === undefined
      ? Promise.reject(new Error("missing coverage fixture"))
      : Promise.resolve(report);
  };
  return {
    calls,
    dependencies: {
      environment: Object.freeze({ PATH: "/usr/bin" }),
      readE2eCoverageSummary: () => read("e2eSummary"),
      readE2eLcov: () => read("e2eLcov"),
      readUnitCoverageSummary: () => read("unitSummary"),
      readUnitLcov: () => read("unitLcov"),
      repoRoot,
      runChild: (input) => {
        calls.push(input);
        return Promise.resolve(Object.freeze({ signal: undefined, status: 0 }));
      },
    },
    reads,
    reports,
  };
}

function replaceReport(current: Fixture, name: ReportName, report: string): ReleaseCoverageDependencies {
  current.reports.set(name, report);
  return current.dependencies;
}

const unitCommand = ["release-coverage-unit"];
const e2eCommand = ["release-coverage-e2e"];

describe("release coverage validation boundary", () => {
  test("runs the exact 18/14 source unions in unit, e2e, and fail-fast all mode", async () => {
    expect(unitSources).toHaveLength(18);
    expect(e2eSources).toHaveLength(14);
    expect(new Set(unitSources)).toEqual(new Set(unitSources));
    expect(new Set(e2eSources)).toEqual(new Set(e2eSources));

    for (const [level, expectedCommands, expectedReads] of [
      ["unit", [unitCommand], ["unitSummary", "unitLcov"]],
      ["e2e", [e2eCommand], ["e2eSummary", "e2eLcov"]],
      ["all", [unitCommand, e2eCommand], ["unitSummary", "unitLcov", "e2eSummary", "e2eLcov"]],
    ] as const) {
      const current = fixture();
      await createReleaseCoverageCommand([`--level=${level}`], current.dependencies)();
      expect(current.calls.map((call) => call.argv)).toEqual(expectedCommands);
      expect(current.reads).toEqual(expectedReads);
      expect(current.calls.every((call) => call.cwd === repoRoot)).toBe(true);
      expect(current.calls.every((call) => call.env === current.dependencies.environment)).toBe(true);
    }

    const firstFailure = fixture();
    const failureDependencies: ReleaseCoverageDependencies = {
      ...firstFailure.dependencies,
      runChild: (input) => {
        firstFailure.calls.push(input);
        return Promise.resolve({ signal: undefined, status: 1 });
      },
    };
    await expect(runReleaseCoverage("all", failureDependencies)).rejects.toThrow("release coverage failed");
    expect(firstFailure.calls.map((call) => call.argv)).toEqual([unitCommand]);
    expect(firstFailure.reads).toEqual([]);
  });

  test("rejects malformed, foreign, duplicate, missing, and imperfect JSON reports", async () => {
    const complete = coverageSummary(unitSources);
    const required = `${releaseDirectory}/${unitSources[0]}`;
    const zero = coverageSummary(unitSources, {
      branches: { covered: 0, pct: 100, total: 0 },
      functions: { covered: 0, pct: 100, total: 0 },
      lines: { covered: 0, pct: 100, total: 0 },
      statements: { covered: 0, pct: 100, total: 0 },
    });
    const imperfect = complete.replace('"covered":1,"pct":100,"total":1', '"covered":0,"pct":100,"total":1');
    const requiredEntry = `,${JSON.stringify(required)}:${JSON.stringify(metrics())}`;
    const missing = complete.replace(requiredEntry, "");
    const foreign = complete.replace(
      "{",
      () => `{${JSON.stringify(`${releaseDirectory}/foreign.ts`)}:${JSON.stringify(metrics())},`,
    );
    const duplicate = complete.replace(
      "{",
      () => `{${JSON.stringify(unitSources[0])}:${JSON.stringify(metrics())},`,
    );
    for (const report of ["{", zero, imperfect, missing, foreign, duplicate]) {
      const current = fixture();
      await expect(runReleaseCoverage("unit", replaceReport(current, "unitSummary", report))).rejects.toThrow(
        "release coverage failed",
      );
      expect(current.calls).toHaveLength(1);
      expect(current.reads).toEqual(["unitSummary", "unitLcov"]);
    }
  });

  test("permits only branchless B0/0 while statements, functions, and lines remain positive and full", async () => {
    const current = fixture();
    const branchless = coverageSummary(unitSources, metrics(0));
    const branchlessLcov = coverageLcov(unitSources, 0);
    await runReleaseCoverage("unit", replaceReport(current, "unitSummary", branchless));
    expect(current.reads).toEqual(["unitSummary", "unitLcov"]);

    const lcovCurrent = fixture();
    await runReleaseCoverage("unit", replaceReport(lcovCurrent, "unitLcov", branchlessLcov));
    expect(lcovCurrent.reads).toEqual(["unitSummary", "unitLcov"]);

    const zeroLcov = coverageLcov(unitSources).replaceAll(
      "LF:1\nLH:1\nFNF:1\nFNH:1",
      "LF:0\nLH:0\nFNF:0\nFNH:0",
    );
    const failed = fixture();
    await expect(runReleaseCoverage("unit", replaceReport(failed, "unitLcov", zeroLcov))).rejects.toThrow(
      "release coverage failed",
    );
  });

  test("rejects malformed, foreign, duplicate, missing, and imperfect LCOV counters", async () => {
    const complete = coverageLcov(unitSources);
    const missing = complete.replace(lcovRecord(unitSources[0]), "");
    const foreign = `${complete}${lcovRecord("foreign.ts")}`;
    const duplicate = `${complete}${lcovRecord(unitSources[0])}`;
    const imperfect = complete.replace("LH:1", "LH:0");
    for (const report of ["SF:release-contract.ts\n", missing, foreign, duplicate, imperfect]) {
      const current = fixture();
      await expect(runReleaseCoverage("unit", replaceReport(current, "unitLcov", report))).rejects.toThrow(
        "release coverage failed",
      );
    }
  });

  test("removes Node shim selectors and temporary Bun shims without changing other environment values", () => {
    expect(
      sanitizeReleaseCoverageEnvironment(
        {
          KEEP: "preserved",
          NODE: "/tmp/bun-node-selector/node",
          PATH: "/usr/bin:/tmp/bun-node-coverage:/bin",
          npm_execpath: "/tmp/bun-node-coverage/npm",
          npm_node_execpath: "/tmp/bun-node-coverage/node",
          UNDEFINED: undefined,
        },
        "/tmp",
      ),
    ).toEqual({ KEEP: "preserved", PATH: "/usr/bin:/bin" });
  });

  test("rejects invalid public levels, child results, unsafe source paths, and incomplete metrics", async () => {
    for (const argv of [[], [undefined], ["--level=invalid"], ["--level=unit", "extra"]]) {
      expect(() => parseReleaseCoverageArguments(argv)).toThrow("invalid release coverage arguments");
    }
    for (const result of [
      undefined,
      { signal: "SIGTERM", status: 0 },
      { signal: undefined, status: "0" },
      { extra: true, signal: undefined, status: 0 },
    ]) {
      const current = fixture();
      await expect(
        runReleaseCoverage("unit", { ...current.dependencies, runChild: () => Promise.resolve(result) }),
      ).rejects.toThrow("release coverage failed");
      expect(current.reads).toEqual([]);
    }
    const complete = coverageSummary(unitSources);
    const required = `${releaseDirectory}/${unitSources[0]}`;
    for (const summary of [
      complete.replace('"lines":{', '"removed":{'),
      complete.replace(required, "../release-contract.ts"),
      complete.replace(required, "."),
      complete.replace(required, String.raw`dir\\release-contract.ts`),
    ]) {
      const current = fixture();
      const result = runReleaseCoverage("unit", replaceReport(current, "unitSummary", summary));
      await expect(result).rejects.toThrow("release coverage failed");
    }
  });

  test("rejects malformed metric records and LCOV state transitions without accepting partial coverage", async () => {
    const complete = coverageSummary(unitSources);
    const firstSource = unitSources[0];
    const summaryCases = [
      complete.replace('"statements":{"covered":1,"pct":100,"total":1}', '"statements":null'),
      complete.replace('"statements":{"covered":1,"pct":100,"total":1}', '"statements":{}'),
      complete.replace('"lines":{', '"removed":{'),
      complete.replace('"pct":100', '"pct":"100"'),
      complete.replace('"covered":1', '"covered":0'),
      complete.replace('"total":1', '"total":1.5'),
      complete.replace('"covered":1,"pct":100,"total":1', '"covered":-1,"pct":100,"total":-1'),
      complete.replace('"pct":100', '"pct":99'),
    ];
    for (const summary of summaryCases) {
      const current = fixture();
      const result = runReleaseCoverage("unit", replaceReport(current, "unitSummary", summary));
      await expect(result).rejects.toThrow("release coverage failed");
    }
    const completeLcov = coverageLcov(unitSources);
    const lcovCases = [
      `SF:${firstSource}\nunknown\n`,
      `SF:${firstSource}\nSF:${firstSource}\n`,
      `${completeLcov}SF:${firstSource}\nLF:1\nLH:1\nFNF:1\nFNH:1\nBRF:1\nBRH:1\nend_of_record\n`,
      completeLcov.replace("FNH:1\n", ""),
      completeLcov.replace("LF:1", "LF:01"),
      completeLcov.replace("LF:1", "LF:9007199254740992"),
      completeLcov.replace("BRH:1", "BRH:1\nDA:1,01"),
    ];
    for (const lcov of lcovCases) {
      const current = fixture();
      const result = runReleaseCoverage("unit", replaceReport(current, "unitLcov", lcov));
      await expect(result).rejects.toThrow("release coverage failed");
    }
    const headerAndDetails = `TN:\n${completeLcov}`
      .trimEnd()
      .replace("LF:1", "FN:1,covered\nFNDA:1,covered\nDA:1,1\nBRDA:1,0,0,1\nLF:1");
    await runReleaseCoverage("unit", replaceReport(fixture(), "unitLcov", headerAndDetails));
    for (const level of ["UNIT", "", 0, undefined, {}, []]) {
      await expect(runReleaseCoverage(level, fixture().dependencies)).rejects.toThrow(
        "release coverage failed",
      );
    }
  });
});
