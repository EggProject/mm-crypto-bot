import { expect, test } from "vitest";

import { runReleaseCoverage, type ReleaseCoverageDependencies } from "./release-coverage";

const releaseDirectory = "/repo/scripts/release";
const sources = [
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
] as const;
const fullJsonMetrics =
  '{"statements":{"total":1,"covered":1,"pct":100},"branches":{"total":1,"covered":1,"pct":100},"functions":{"total":1,"covered":1,"pct":100},"lines":{"total":1,"covered":1,"pct":100}}';
const branchlessJsonMetrics =
  '{"statements":{"total":1,"covered":1,"pct":100},"branches":{"total":0,"covered":0,"pct":100},"functions":{"total":1,"covered":1,"pct":100},"lines":{"total":1,"covered":1,"pct":100}}';
const partialBranchJsonMetrics =
  '{"statements":{"total":1,"covered":1,"pct":100},"branches":{"total":1,"covered":0,"pct":100},"functions":{"total":1,"covered":1,"pct":100},"lines":{"total":1,"covered":1,"pct":100}}';
const zeroJsonMetrics =
  '{"statements":{"total":0,"covered":0,"pct":100},"branches":{"total":0,"covered":0,"pct":100},"functions":{"total":0,"covered":0,"pct":100},"lines":{"total":0,"covered":0,"pct":100}}';
const fullLcovCounters = "LF:1\nLH:1\nFNF:1\nFNH:1\nBRF:1\nBRH:1";
const branchlessLcovCounters = "LF:1\nLH:1\nFNF:1\nFNH:1\nBRF:0\nBRH:0";
const partialBranchLcovCounters = "LF:1\nLH:1\nFNF:1\nFNH:1\nBRF:1\nBRH:0";
const zeroLcovCounters = "LF:0\nLH:0\nFNF:0\nFNH:0\nBRF:0\nBRH:0";

function summary(releasePortsMetrics = branchlessJsonMetrics): string {
  return `{"total":${fullJsonMetrics},${sources
    .map((source) => {
      const metrics = source === "release-ports.ts" ? releasePortsMetrics : fullJsonMetrics;
      return `${JSON.stringify(`${releaseDirectory}/${source}`)}:${metrics}`;
    })
    .join(",")}}`;
}

function lcov(releasePortsCounters = branchlessLcovCounters): string {
  return sources
    .map((source) => {
      const counters = source === "release-ports.ts" ? releasePortsCounters : fullLcovCounters;
      return `SF:${source}\n${counters}\nend_of_record\n`;
    })
    .join("");
}

function dependencies(summaryText: string, lcovText: string): ReleaseCoverageDependencies {
  return {
    environment: {},
    readE2eCoverageSummary: () => Promise.resolve(summaryText),
    readE2eLcov: () => Promise.resolve(lcovText),
    readUnitCoverageSummary: () => Promise.resolve(summaryText),
    readUnitLcov: () => Promise.resolve(lcovText),
    repoRoot: "/repo",
    runChild: () => Promise.resolve({ signal: undefined, status: 0 }),
  };
}

function unitCoverage(summaryText = summary(), lcovText = lcov()): Promise<void> {
  return runReleaseCoverage("unit", dependencies(summaryText, lcovText));
}

test("accepts a branchless source only when its other JSON and LCOV metrics are positive and complete", async () => {
  await expect(unitCoverage()).resolves.toBeUndefined();
});

test("rejects a wholly zero source even when its branch metrics are branchless", async () => {
  await expect(unitCoverage(summary(zeroJsonMetrics))).rejects.toThrow("release coverage failed");
  await expect(unitCoverage(undefined, lcov(zeroLcovCounters))).rejects.toThrow("release coverage failed");
});

test("rejects incomplete positive branch totals in JSON and LCOV", async () => {
  await expect(unitCoverage(summary(partialBranchJsonMetrics))).rejects.toThrow("release coverage failed");
  await expect(unitCoverage(undefined, lcov(partialBranchLcovCounters))).rejects.toThrow(
    "release coverage failed",
  );
});
