import { expect, test } from "vitest";

import {
  assertSafeNodeEnvironment,
  assertNodeVersion,
  isNodeGate,
  nodeGateArguments,
  nodeGates,
  parseNodeGateArguments,
  verifiedNodeOutput,
} from "./node-executable-protocol-contract";

test("accepts exactly one known gate argument", () => {
  expect(parseNodeGateArguments(["--gate=release-coverage-unit"])).toBe("release-coverage-unit");
  for (const arguments_ of [
    [],
    ["--gate=unknown"],
    ["gate=release-coverage-unit"],
    [42],
    ["--gate=release-coverage-unit", "x"],
  ]) {
    expect(() => parseNodeGateArguments(arguments_)).toThrow("invalid Node gate arguments");
  }
  expect(isNodeGate("release-coverage-unit")).toBe(true);
  expect(isNodeGate("unknown")).toBe(false);
  expect(isNodeGate(42)).toBe(false);
});

test("maps each known gate to argv that contains no caller-controlled path", () => {
  for (const gate of nodeGates) {
    expect(nodeGateArguments(gate).every((argument) => !argument.startsWith("/"))).toBe(true);
  }
  expect(nodeGateArguments("release-coverage-unit")).toEqual([
    "node_modules/vitest/vitest.mjs",
    "run",
    "--config",
    "scripts/release/vitest.config.ts",
    "--coverage",
  ]);
  expect(nodeGateArguments("vitest-list-all-configs")).toEqual([
    "node_modules/vitest/vitest.mjs",
    "list",
    "--config",
    "scripts/tooling/vitest.pre-commit.config.mjs",
  ]);
  expect(nodeGateArguments("bot-unit-scope")).toEqual(["scripts/coverage-tools/verify-bot-runtime-scope.ts"]);
  expect(nodeGateArguments("ci-test-junit")).toEqual([
    "node_modules/turbo/bin/turbo",
    "run",
    "test",
    "--",
    "--reporter=junit",
    "--reporter-outfile=./junit.xml",
  ]);
  expect(nodeGateArguments("coverage-full-test")).toEqual([
    "node_modules/turbo/bin/turbo",
    "run",
    "test",
    "--force",
  ]);
  expect(nodeGateArguments("staged-eslint")).toEqual([
    "scripts/tooling/staged-file-validation.ts",
    "--mode=lint",
  ]);
  expect(nodeGateArguments("staged-prettier")).toEqual([
    "scripts/tooling/staged-file-validation.ts",
    "--mode=format",
  ]);
  expect(() => {
    void Reflect.apply(nodeGateArguments, undefined, ["unknown"]);
  }).toThrow("invalid Node gate arguments");
});

test("classifies raw verified Node output and exact version without runtime dependencies", () => {
  expect(
    verifiedNodeOutput(
      { error: undefined, signal: undefined, status: 0, stdout: new TextEncoder().encode("v24.21.0\n") },
      true,
    ),
  ).toBe("v24.21.0");
  expect(
    verifiedNodeOutput({ error: undefined, signal: undefined, status: 0, stdout: undefined }, false),
  ).toBe("");
  for (const observation of [
    { error: new Error("ENOENT"), signal: undefined, status: undefined, stdout: undefined },
    { error: undefined, signal: "SIGTERM", status: undefined, stdout: undefined },
    { error: undefined, signal: undefined, status: 1, stdout: undefined },
    { error: undefined, signal: undefined, status: 0, stdout: "wrong" },
  ]) {
    expect(() => verifiedNodeOutput(observation, true)).toThrow("verified Node gate failed");
  }
  expect(() => {
    assertNodeVersion("v24.20.0");
  }).toThrow("unverified Node executable");
  expect(() => {
    assertNodeVersion("v24.21.0");
  }).not.toThrow();
});

test("rejects NODE_OPTIONS and NODE_PATH whenever either is present", () => {
  expect(() => {
    assertSafeNodeEnvironment({});
  }).not.toThrow();
  for (const environment of [
    { NODE_OPTIONS: "" },
    { NODE_OPTIONS: "--require=untrusted" },
    { NODE_PATH: "" },
    { NODE_PATH: "/untrusted/modules" },
  ]) {
    expect(() => {
      assertSafeNodeEnvironment(environment);
    }).toThrow("unverified Node environment");
  }
});
