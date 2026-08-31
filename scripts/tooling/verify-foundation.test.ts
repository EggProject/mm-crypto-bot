/* eslint-disable unicorn/no-null -- Bun subprocess results represent absent exit and signal codes as null. */

import path from "node:path";
import { pathToFileURL } from "node:url";

interface TestExpectation {
  toBe(expected: unknown): void;
  toBeUndefined(): void;
  toEqual(expected: unknown): void;
}

interface TestRuntimeApi {
  expect(actual: unknown): TestExpectation;
  test(name: string, run: () => Promise<void>): void;
}

const isRecord = (candidate: unknown): candidate is Record<string, unknown> =>
  typeof candidate === "object" && candidate !== null;

const isTestRuntimeApi = (candidate: unknown): candidate is TestRuntimeApi => {
  if (!isRecord(candidate)) {
    return false;
  }

  const { expect, test } = candidate;
  return typeof expect === "function" && typeof test === "function";
};

const testRuntime: unknown = await import(typeof Bun === "undefined" ? "vitest" : "bun:test");
if (!isTestRuntimeApi(testRuntime)) {
  throw new Error("The selected test runtime does not expose expect and test functions.");
}

const expect = (actual: unknown): TestExpectation => testRuntime.expect(actual);

const test = (name: string, run: () => Promise<void>): void => {
  testRuntime.test(name, run);
};

import {
  FoundationVerificationFailure,
  createBunFoundationVerificationRunner,
  foundationVerificationGates,
  runFoundationVerification,
  runFoundationVerificationCli,
  runFoundationVerificationEntrypoint,
  type BunFoundationVerificationSpawn,
  type FoundationVerificationGate,
  type FoundationVerificationGateResult,
} from "./verify-foundation.ts";

const successfulResult: FoundationVerificationGateResult = { exitCode: 0, signalCode: null };

const expectRejectedWith = async <Result>(run: () => Promise<Result>, expected: Error): Promise<void> => {
  let actualError: unknown;

  try {
    await run();
  } catch (error: unknown) {
    actualError = error;
  }

  expect(actualError).toEqual(expected);
};

const createRecordingSpawn =
  (
    calls: { readonly cmd: string[]; readonly stderr: string; readonly stdout: string }[],
  ): BunFoundationVerificationSpawn =>
  (options) => {
    calls.push(options);
    return {
      exited: Promise.resolve(0),
      exitCode: 0,
      signalCode: null,
    };
  };

test("foundation verification runs every available gate in the required order", async () => {
  const calls: FoundationVerificationGate[] = [];

  await runFoundationVerification((gate) => {
    calls.push(gate);
    return Promise.resolve(successfulResult);
  });

  expect(calls).toEqual([
    "format:check",
    "lint",
    "typecheck",
    "test:tooling",
    "build",
    "test",
    "coverage:bot:unit",
    "coverage:bot:e2e",
    "coverage:scope",
    "coverage:full",
  ]);
  expect(calls).toEqual([...foundationVerificationGates]);
});

test("foundation verification stops after a numeric failure and preserves its result", async () => {
  const calls: FoundationVerificationGate[] = [];

  await expectRejectedWith(
    () =>
      runFoundationVerification((gate) => {
        calls.push(gate);
        return Promise.resolve(gate === "lint" ? { exitCode: 9, signalCode: null } : successfulResult);
      }),
    new FoundationVerificationFailure("lint", { exitCode: 9, signalCode: null }),
  );

  expect(calls).toEqual(["format:check", "lint"]);
});

test("foundation verification fails closed when a gate is terminated by a signal", async () => {
  await expectRejectedWith(
    () =>
      runFoundationVerification((gate) =>
        Promise.resolve(gate === "lint" ? { exitCode: null, signalCode: "SIGTERM" } : successfulResult),
      ),
    new FoundationVerificationFailure("lint", { exitCode: null, signalCode: "SIGTERM" }),
  );
});

test("foundation verification fails closed when a gate has no exit or signal code", async () => {
  await expectRejectedWith(
    () =>
      runFoundationVerification((gate) =>
        Promise.resolve(gate === "lint" ? { exitCode: null, signalCode: null } : successfulResult),
      ),
    new FoundationVerificationFailure("lint", { exitCode: null, signalCode: null }),
  );
});

test("Bun adapter spawns only the required Bun command with inherited streams", async () => {
  const calls: { readonly cmd: string[]; readonly stderr: string; readonly stdout: string }[] = [];

  const result = await createBunFoundationVerificationRunner(createRecordingSpawn(calls))("lint");

  expect(result).toEqual(successfulResult);
  expect(calls).toEqual([
    {
      cmd: ["bun", "run", "lint"],
      stderr: "inherit",
      stdout: "inherit",
    },
  ]);
});

test("CLI exits successfully without diagnostics when every gate succeeds", async () => {
  const diagnostics: string[] = [];

  const exitCode = await runFoundationVerificationCli(
    () => Promise.resolve(successfulResult),
    (message) => {
      diagnostics.push(message);
    },
  );

  expect(exitCode).toBe(0);
  expect(diagnostics).toEqual([]);
});

test("CLI preserves a numeric child failure code and writes its diagnostic", async () => {
  const diagnostics: string[] = [];

  const exitCode = await runFoundationVerificationCli(
    (gate) => Promise.resolve(gate === "lint" ? { exitCode: 9, signalCode: null } : successfulResult),
    (message) => {
      diagnostics.push(message);
    },
  );

  expect(exitCode).toBe(9);
  expect(diagnostics).toEqual(["Foundation verification gate failed (exit=9, signal=none): lint"]);
});

test("CLI maps a signal failure to one and writes its diagnostic", async () => {
  const diagnostics: string[] = [];

  const exitCode = await runFoundationVerificationCli(
    (gate) => Promise.resolve(gate === "lint" ? { exitCode: null, signalCode: "SIGTERM" } : successfulResult),
    (message) => {
      diagnostics.push(message);
    },
  );

  expect(exitCode).toBe(1);
  expect(diagnostics).toEqual(["Foundation verification gate failed (exit=none, signal=SIGTERM): lint"]);
});

test("CLI maps an indeterminate child failure to one and writes its diagnostic", async () => {
  const diagnostics: string[] = [];

  const exitCode = await runFoundationVerificationCli(
    (gate) => Promise.resolve(gate === "lint" ? { exitCode: null, signalCode: null } : successfulResult),
    (message) => {
      diagnostics.push(message);
    },
  );

  expect(exitCode).toBe(1);
  expect(diagnostics).toEqual(["Foundation verification gate failed (exit=none, signal=none): lint"]);
});

test("CLI writes the exact default diagnostic to stderr for a numeric child failure", async () => {
  if (typeof Bun === "undefined") {
    const exitCode = await runFoundationVerificationCli((gate) =>
      Promise.resolve(gate === "lint" ? { exitCode: 9, signalCode: null } : successfulResult),
    );

    expect(exitCode).toBe(9);
    return;
  }

  const moduleUrl = pathToFileURL(path.join(import.meta.dirname, "verify-foundation.ts")).href;
  const source = [
    `import { runFoundationVerificationCli } from ${JSON.stringify(moduleUrl)};`,
    'const exitCode = await runFoundationVerificationCli((gate) => Promise.resolve(gate === "lint" ? { exitCode: 9, signalCode: null } : { exitCode: 0, signalCode: null }));',
    "process.exitCode = exitCode;",
  ].join("\n");
  const child = Bun.spawn({ cmd: ["bun", "--eval", source], stderr: "pipe", stdout: "pipe" });
  const [exitCode, stderr, stdout] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);

  expect(exitCode).toBe(9);
  expect(stderr).toBe("Foundation verification gate failed (exit=9, signal=none): lint\n");
  expect(stdout).toBe("");
});

test("CLI preserves an unexpected runner error", async () => {
  const unexpectedError = new Error("unexpected foundation runner error");

  await expectRejectedWith(
    () => runFoundationVerificationCli(() => Promise.reject(unexpectedError)),
    unexpectedError,
  );
});

test("entrypoint returns without running the command outside direct execution", async () => {
  let invocationCount = 0;
  const exitCodeTarget: { exitCode?: number } = {};

  await runFoundationVerificationEntrypoint(
    false,
    () => {
      invocationCount += 1;
      return Promise.resolve(0);
    },
    exitCodeTarget,
  );

  expect(invocationCount).toBe(0);
  expect(exitCodeTarget.exitCode).toBeUndefined();
});

test("entrypoint assigns the verification command exit code to its injected target", async () => {
  const exitCodeTarget: { exitCode?: number } = {};

  await runFoundationVerificationEntrypoint(true, () => Promise.resolve(9), exitCodeTarget);

  expect(exitCodeTarget.exitCode).toBe(9);
});
