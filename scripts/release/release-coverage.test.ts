import {
  createNodeReleaseCoverageDependencies,
  createNodeReleaseCoverageGateRunner,
  createReleaseCoverageCommand,
  parseReleaseCoverageArguments,
  runReleaseCoverage,
  runReleaseCoverageEntrypoint,
  sanitizeReleaseCoverageEnvironment,
} from "./release-coverage";
import type { ReleaseCoverageDependencies } from "./release-coverage";
interface ChildCall {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
}
interface Expectation {
  readonly rejects: { toThrow(expected?: string | RegExp): Promise<void> };
  readonly resolves: { toEqual(expected: unknown): Promise<void> };
  toBe(expected: unknown): void;
  toBeUndefined(): void;
  toContain(expected: string): void;
  toEqual(expected: unknown): void;
  toHaveLength(expected: number): void;
  toThrow(expected?: string | RegExp): void;
}
interface TestRuntime {
  describe(name: string, run: () => void): void;
  expect(actual: unknown): Expectation;
  test(name: string, run: () => void | Promise<void>): void;
}
interface ExitCodeTarget {
  exitCode: number | string | null | undefined;
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isTestRuntime = (value: unknown): value is TestRuntime => {
  if (!isRecord(value)) return false;
  const exports = new Map(Object.entries(value));
  return (
    typeof exports.get("describe") === "function" &&
    typeof exports.get("expect") === "function" &&
    typeof exports.get("test") === "function"
  );
};
const testRuntime: unknown = await import(typeof Bun === "undefined" ? "vitest" : "bun:test");
if (!isTestRuntime(testRuntime)) {
  throw new Error("The selected test runtime does not expose the required API.");
}
const describe = testRuntime.describe.bind(testRuntime);
const expect = testRuntime.expect.bind(testRuntime);
const test = testRuntime.test.bind(testRuntime);
const releaseDirectory = "/repo/scripts/release";
const repoRoot = "/repo";
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
const fullMetric = '{"total":1,"covered":1,"pct":100}';
const fullSummaryMetrics = `{"statements":${fullMetric},"branches":${fullMetric},"functions":${fullMetric},"lines":${fullMetric}}`;
const unitArgv = ["release-coverage-unit"] as const;
const e2eArgv = ["release-coverage-e2e"] as const;
type ReportName = "unitSummary" | "unitLcov" | "e2eSummary" | "e2eLcov";
interface Fixture {
  readonly calls: ChildCall[];
  readonly dependencies: ReleaseCoverageDependencies;
  readonly reads: ReportName[];
}
function coverageSummary(sources: readonly string[]): string {
  return `{"total":${fullSummaryMetrics},${sources
    .map((source) => `${JSON.stringify(`${releaseDirectory}/${source}`)}:${fullSummaryMetrics}`)
    .join(",")}}`;
}
function insertAfterOpeningBrace(report: string, entry: string): string {
  return report.replace("{", () => `{${entry},`);
}
function replaceText(report: string, matched: string, replacement: string): string {
  return report.replace(matched, () => replacement);
}
function nonErrorFailureReason(): unknown {
  return Object.freeze({ stderr: "secret" });
}
async function throwNonErrorFailure(): Promise<void> {
  await Promise.resolve();
  throw nonErrorFailureReason();
}
function lcov(sources: readonly string[]): string {
  return sources
    .map(
      (source) => `SF:${source}
LF:1
LH:1
FNF:1
FNH:1
BRF:1
BRH:1
end_of_record
`,
    )
    .join("");
}
function fixture(): Fixture {
  const calls: ChildCall[] = [];
  const reads: ReportName[] = [];
  const reports = new Map<ReportName, string>([
    ["unitSummary", coverageSummary(unitSources)],
    ["unitLcov", lcov(unitSources)],
    ["e2eSummary", coverageSummary(e2eSources)],
    ["e2eLcov", lcov(e2eSources)],
  ]);
  const read = (name: ReportName): Promise<string> => {
    reads.push(name);
    const report = reports.get(name);
    return report === undefined
      ? Promise.reject(new Error("missing fixture report"))
      : Promise.resolve(report);
  };
  return {
    calls,
    dependencies: {
      environment: {},
      readE2eCoverageSummary: () => read("e2eSummary"),
      readE2eLcov: () => read("e2eLcov"),
      readUnitCoverageSummary: () => read("unitSummary"),
      readUnitLcov: () => read("unitLcov"),
      repoRoot,
      runChild: (input) => {
        calls.push(input);
        return Promise.resolve({ signal: undefined, status: 0 });
      },
    },
    reads,
  };
}
function replaceReport(current: Fixture, reportName: ReportName, replacement: string): Fixture {
  const reader = (): Promise<string> => {
    current.reads.push(reportName);
    return Promise.resolve(replacement);
  };
  const dependencies: ReleaseCoverageDependencies =
    reportName === "unitSummary"
      ? { ...current.dependencies, readUnitCoverageSummary: reader }
      : reportName === "unitLcov"
        ? { ...current.dependencies, readUnitLcov: reader }
        : reportName === "e2eSummary"
          ? { ...current.dependencies, readE2eCoverageSummary: reader }
          : { ...current.dependencies, readE2eLcov: reader };
  return { ...current, dependencies };
}
describe("release coverage argument parser", () => {
  test("accepts each exact supported level", () => {
    expect(parseReleaseCoverageArguments(["--level=unit"])).toBe("unit");
    expect(parseReleaseCoverageArguments(["--level=e2e"])).toBe("e2e");
    expect(parseReleaseCoverageArguments(["--level=all"])).toBe("all");
  });
  test("rejects every malformed argument shape", () => {
    for (const argv of [
      [],
      [undefined],
      ["--level=unit", "--level=e2e"],
      ["unit"],
      ["--other=unit"],
      ["--level"],
      ["--level=UNIT"],
      ["--level=unit=extra"],
      ["--level=unit", "extra"],
    ]) {
      expect(() => parseReleaseCoverageArguments(argv)).toThrow("invalid release coverage arguments");
    }
  });
});
describe("release coverage orchestrator", () => {
  test("runs each level with exact commands and fixed report reader order", async () => {
    for (const [level, expectedArgv, expectedReads] of [
      ["unit", [unitArgv], ["unitSummary", "unitLcov"]],
      ["e2e", [e2eArgv], ["e2eSummary", "e2eLcov"]],
      ["all", [unitArgv, e2eArgv], ["unitSummary", "unitLcov", "e2eSummary", "e2eLcov"]],
    ] as const) {
      const current = fixture();
      await runReleaseCoverage(level, current.dependencies);
      expect(current.calls.map((call) => [...call.argv])).toEqual(expectedArgv.map((argv) => [...argv]));
      expect(current.reads).toEqual(expectedReads);
      for (const call of current.calls) {
        expect(call.cwd).toBe(repoRoot);
      }
    }
  });
  test("rejects invalid JavaScript levels before child or fixed report activity", async () => {
    for (const level of ["UNIT", "", 0, undefined, {}, []]) {
      const current = fixture();
      await expect(runReleaseCoverage(level, current.dependencies)).rejects.toThrow(
        "release coverage failed",
      );
      expect(current.calls).toEqual([]);
      expect(current.reads).toEqual([]);
    }
  });
  test("stops before reports for throw, nonzero, signal, absent, and malformed child results", async () => {
    for (const outcome of [
      () => Promise.reject(new Error("hostile child failure")),
      () => Promise.resolve({ signal: undefined, status: 1 }),
      () => Promise.resolve({ signal: "SIGTERM", status: 0 }),
      () => Promise.resolve(undefined),
      () => Promise.resolve({ signal: undefined, status: "0" }),
      () => Promise.resolve({ extra: true, signal: undefined, status: 0 }),
    ]) {
      const current = fixture();
      const dependencies = { ...current.dependencies, runChild: () => outcome() };
      await expect(runReleaseCoverage("unit", dependencies)).rejects.toThrow("release coverage failed");
      expect(current.reads).toEqual([]);
    }
  });
  test("stops all mode at the first invalid summary", async () => {
    const current = replaceReport(fixture(), "unitSummary", "not json");
    await expect(runReleaseCoverage("all", current.dependencies)).rejects.toThrow("release coverage failed");
    expect(current.calls).toHaveLength(1);
    expect(current.reads).toEqual(["unitSummary", "unitLcov"]);
  });
  test("rejects malformed, partial, foreign, duplicate, unsafe, and imperfect JSON summaries", async () => {
    const complete = coverageSummary(unitSources);
    const requiredSource = `${releaseDirectory}/release-contract.ts`;
    const cases = [
      "{",
      complete.replace(`,${JSON.stringify(requiredSource)}:${fullSummaryMetrics}`, ""),
      insertAfterOpeningBrace(complete, `"/repo/scripts/release/foreign.ts":${fullSummaryMetrics}`),
      insertAfterOpeningBrace(complete, `"release-contract.ts":${fullSummaryMetrics}`),
      replaceText(complete, `,"lines":${fullMetric}`, ""),
      replaceText(complete, fullMetric, '{"total":1,"covered":1}'),
      replaceText(complete, '"pct":100', '"pct":"100"'),
      replaceText(complete, '"covered":1', '"covered":0'),
      replaceText(complete, '"total":1', '"total":1.5'),
      replaceText(complete, '"total":1,"covered":1,"pct":100', '"total":-1,"covered":-1,"pct":100'),
      replaceText(complete, '"pct":100', '"pct":99'),
      replaceText(complete, requiredSource, "../release-contract.ts"),
      replaceText(complete, requiredSource, "."),
      complete.replace(requiredSource, String.raw`dir\\release-contract.ts`),
    ];
    for (const summary of cases) {
      const current = replaceReport(fixture(), "unitSummary", summary);
      await expect(runReleaseCoverage("unit", current.dependencies)).rejects.toThrow(
        "release coverage failed",
      );
    }
  });
  test("accepts Vitest metadata outside the required S/B/F/L metrics", async () => {
    const summary = replaceText(
      coverageSummary(unitSources),
      fullSummaryMetrics,
      `{"statements":${fullMetric},"branches":${fullMetric},"functions":${fullMetric},"lines":${fullMetric},"branchesTrue":{"total":0,"covered":0,"skipped":0,"pct":"Unknown"}}`,
    );
    await runReleaseCoverage("unit", replaceReport(fixture(), "unitSummary", summary).dependencies);
  });
  test("rejects malformed, foreign, duplicate, incomplete, and unequal LCOV counters", async () => {
    const complete = lcov(unitSources);
    for (const report of [
      `SF:release-contract.ts
LF:1
LH:1
FNF:1
FNH:1
BRF:1
BRH:1
`,
      `SF:release-contract.ts
SF:zip-store.ts
`,
      "end_of_record\n",
      `${complete}SF:foreign.ts\nLF:1\nLH:1\nFNF:1\nFNH:1\nBRF:1\nBRH:1\nend_of_record\n`,
      `${complete}SF:release-contract.ts\nLF:1\nLH:1\nFNF:1\nFNH:1\nBRF:1\nBRH:1\nend_of_record\n`,
      complete.replace("FNH:1\n", ""),
      complete.replace("LH:1", "LH:0"),
      complete.replace("SF:release-contract.ts", "SF:../release-contract.ts"),
      complete.replace("LF:1", "LF:01"),
      complete.replace("LF:1", "LF:9007199254740992"),
      complete.replace("BRH:1", "BRH:1\nDA:1,01"),
    ]) {
      const current = replaceReport(fixture(), "unitLcov", report);
      await expect(runReleaseCoverage("unit", current.dependencies)).rejects.toThrow(
        "release coverage failed",
      );
    }
  });
  test("accepts completed standard LCOV records with optional headers and details", async () => {
    const report = lcov(unitSources)
      .trimEnd()
      .replaceAll("SF:", "TN:\nSF:")
      .replace("LF:1", "FN:1,covered\nFNDA:1,covered\nDA:1,1\nBRDA:1,0,0,1\nLF:1");
    await runReleaseCoverage("unit", replaceReport(fixture(), "unitLcov", report).dependencies);
  });
});
test("release Vitest configs retain exact root reports, source scopes, reporters, and thresholds", async () => {
  const [unitModule, e2eModule] = await Promise.all([
    import("./vitest.config"),
    import("./vitest.e2e.config"),
  ]);
  for (const [configModule, sources, directory] of [
    [unitModule, unitSources, "../../coverage/release/unit"],
    [e2eModule, e2eSources, "../../coverage/release/e2e"],
  ] as const) {
    const defaultConfig: unknown = configModule.default;
    if (!isRecord(defaultConfig)) {
      throw new Error("Expected a Vitest configuration module");
    }
    const testConfig = new Map(Object.entries(defaultConfig)).get("test");
    if (!isRecord(testConfig)) {
      throw new Error("Expected a Vitest test coverage configuration");
    }
    const coverage = new Map(Object.entries(testConfig)).get("coverage");
    if (!isRecord(coverage)) {
      throw new Error("Expected a Vitest coverage configuration");
    }
    const coverageValues = new Map(Object.entries(coverage));
    expect(coverageValues.get("provider")).toBe("v8");
    expect(coverageValues.get("include")).toEqual(sources);
    expect(coverageValues.get("reporter")).toEqual(["text", "json-summary", "lcov"]);
    expect(coverageValues.get("reportsDirectory")).toBe(directory);
    expect(coverageValues.get("thresholds")).toEqual({
      branches: 100,
      functions: 100,
      lines: 100,
      perFile: true,
      statements: 100,
    });
  }
});
test("sanitizes Bun Node shim environment without reordering unaffected entries", () => {
  const environment = {
    NODE: "/bad/node",
    PATH: "/first:/tmp/bun-node-123:/second:/var/tmp/bun-node-xyz:/third",
    KEEP: "exact",
    npm_execpath: "/bad/npm",
    npm_node_execpath: "/bad/node",
  };
  expect(sanitizeReleaseCoverageEnvironment(environment, "/tmp")).toEqual({
    KEEP: "exact",
    PATH: "/first:/second:/var/tmp/bun-node-xyz:/third",
  });
});
test("Node adapter uses fixed report readers and sanitized environment", async () => {
  const dependencies = createNodeReleaseCoverageDependencies(
    repoRoot,
    { NODE: "bad", PATH: process.env["PATH"] ?? "" },
    "/tmp",
    () => Promise.resolve({ signal: undefined, status: 0 }),
  );
  expect(dependencies.environment).toEqual({ PATH: process.env["PATH"] ?? "" });
  await invokeReader(dependencies.readUnitCoverageSummary);
  await invokeReader(dependencies.readUnitLcov);
  await invokeReader(dependencies.readE2eCoverageSummary);
  await invokeReader(dependencies.readE2eLcov);
});
test("sealed release child runner accepts only approved coverage tags", async () => {
  const calls: { readonly level: string; readonly repoRoot_: string }[] = [];
  const runner = createNodeReleaseCoverageGateRunner((level, _environment, repoRoot_) => {
    calls.push({ level, repoRoot_ });
    return Promise.resolve();
  });
  await expect(runner({ argv: ["unknown"], cwd: repoRoot, env: {} })).rejects.toThrow(
    "invalid coverage child command",
  );
  await expect(runner({ argv: ["release-coverage-unit"], cwd: repoRoot, env: {} })).resolves.toEqual({
    signal: undefined,
    status: 0,
  });
  await expect(runner({ argv: ["release-coverage-e2e"], cwd: repoRoot, env: {} })).resolves.toEqual({
    signal: undefined,
    status: 0,
  });
  expect(calls).toEqual([
    { level: "unit", repoRoot_: repoRoot },
    { level: "e2e", repoRoot_: repoRoot },
  ]);
  expect(typeof createNodeReleaseCoverageGateRunner()).toBe("function");
});
async function invokeReader(reader: () => Promise<string>): Promise<void> {
  try {
    await reader();
  } catch {
    return;
  }
}
test("release coverage command factory runs the real parser and orchestrator", async () => {
  const current = fixture();
  await createReleaseCoverageCommand(["--level=unit"], current.dependencies)();
  expect(current.calls).toHaveLength(1);
});
describe("release coverage CLI adapter", () => {
  test("covers imported and executable adapter paths", async () => {
    const output: string[] = [];
    const target: ExitCodeTarget = { exitCode: undefined };
    expect(
      await runReleaseCoverageEntrypoint({
        argv: ["--level=unit"],
        exitCodeTarget: target,
        isMain: false,
        runCommand: () => Promise.resolve(),
        writeStderr: (line) => {
          output.push(line);
        },
      }),
    ).toBeUndefined();
    expect(
      await runReleaseCoverageEntrypoint({
        argv: ["--level=unit"],
        exitCodeTarget: target,
        isMain: true,
        runCommand: () => Promise.resolve(),
        writeStderr: (line) => {
          output.push(line);
        },
      }),
    ).toBe(0);
  });
  test("redacts Error and non-Error executable failures", async () => {
    for (const runCommand of [
      () => Promise.reject(new Error("/hostile/private/path")),
      throwNonErrorFailure,
    ]) {
      const output: string[] = [];
      const target: ExitCodeTarget = { exitCode: undefined };
      await runReleaseCoverageEntrypoint({
        argv: ["--level=unit"],
        exitCodeTarget: target,
        isMain: true,
        runCommand,
        writeStderr: (line) => {
          output.push(line);
        },
      });
      expect(target.exitCode).toBe(1);
      expect(output).toEqual(["release coverage failed\n"]);
    }
  });
});
