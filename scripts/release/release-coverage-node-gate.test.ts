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

test("maps release coverage levels to sealed Node gates", async () => {
  const gates: string[] = [];
  await runReleaseCoverageNodeGate("unit", {}, (_environment, gate) => {
    gates.push(gate);
    return Promise.resolve();
  });
  await runReleaseCoverageNodeGate("e2e", {}, (_environment, gate) => {
    gates.push(gate);
    return Promise.resolve();
  });
  expect(gates).toEqual(["release-coverage-unit", "release-coverage-e2e"]);
});
