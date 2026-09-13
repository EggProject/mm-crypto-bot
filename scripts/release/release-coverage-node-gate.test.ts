interface Expectation {
  toEqual(expected: unknown): void;
}

interface TestRuntime {
  expect(actual: unknown): Expectation;
  test(name: string, run: () => void | Promise<void>): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTestRuntime(value: unknown): value is TestRuntime {
  return isRecord(value) && typeof value["expect"] === "function" && typeof value["test"] === "function";
}

const importedTestRuntime: unknown = await import(typeof Bun === "undefined" ? "vitest" : "bun:test");
if (!isTestRuntime(importedTestRuntime)) {
  throw new Error("The selected test runtime does not expose the required API.");
}
const expect = importedTestRuntime.expect.bind(importedTestRuntime);
const test = importedTestRuntime.test.bind(importedTestRuntime);

import { runReleaseCoverageNodeGate } from "./release-coverage-node-gate";

test("maps levels and forwards the fixed repository root to sealed Node gates", async () => {
  const calls: { readonly gate: string; readonly repoRoot: string }[] = [];
  await runReleaseCoverageNodeGate("unit", {}, "/repo", (_environment, gate, repoRoot) => {
    calls.push({ gate, repoRoot });
    return Promise.resolve();
  });
  await runReleaseCoverageNodeGate("e2e", {}, "/repo", (_environment, gate, repoRoot) => {
    calls.push({ gate, repoRoot });
    return Promise.resolve();
  });
  expect(calls).toEqual([
    { gate: "release-coverage-unit", repoRoot: "/repo" },
    { gate: "release-coverage-e2e", repoRoot: "/repo" },
  ]);
});
