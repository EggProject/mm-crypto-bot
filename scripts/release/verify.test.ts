import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { deriveReleaseSetDestination } from "./release-set-contract";
import { runReleaseVerifyCli, type ReleaseArtifactReadPort } from "./release-artifact-verifier";
import {
  defaultReleaseVerifyCliDependencies,
  nodeReleaseArtifactReadPort,
  runReleaseVerifyEntrypoint,
} from "./verify";

interface Expectation {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
}

interface TestApi {
  describe(name: string, run: () => void): void;
  expect(actual: unknown): Expectation;
  test(name: string, run: () => void | Promise<void>): void;
}

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  return typeof candidate === "object" && candidate !== null;
}

function isTestApi(candidate: unknown): candidate is TestApi {
  if (!isRecord(candidate)) return false;
  return (
    typeof candidate["describe"] === "function" &&
    typeof candidate["expect"] === "function" &&
    typeof candidate["test"] === "function"
  );
}

const testRuntime: unknown = await import(typeof Bun === "undefined" ? "vitest" : "bun:test");
if (!isTestApi(testRuntime)) throw new Error("The selected test runtime does not expose the required API.");
const describe = (name: string, run: () => void): void => {
  testRuntime.describe(name, run);
};
const expect = (actual: unknown): Expectation => testRuntime.expect(actual);
const test = (name: string, run: () => void | Promise<void>): void => {
  testRuntime.test(name, run);
};

const temporaryDirectory = "/tmp/mm-crypto-bot-task-4b-node-adapter-test";

describe("release verify executable adapter", () => {
  test("constructs the default CLI command for the sole release-set archive below repository releases", async () => {
    const expectedRoot = path.join(fileURLToPath(new URL("../../", import.meta.url)), "releases");
    const paths: string[] = [];
    const fileSystem: ReleaseArtifactReadPort = {
      lstat: (artifactPath: string) => {
        paths.push(artifactPath);
        return Promise.reject(new Error("fixture rejects the generated pathname"));
      },
      readFile: (): Promise<Uint8Array> => Promise.reject(new Error("unreachable fixture read")),
    };
    const stderr: string[] = [];
    const result = await runReleaseVerifyCli(
      [],
      { fileSystem, repositoryRoot: defaultReleaseVerifyCliDependencies.repositoryRoot },
      { writeStderr: (value: string): void => void stderr.push(value), writeStdout: (): void => undefined },
    );

    expect(defaultReleaseVerifyCliDependencies.repositoryRoot).toBe(expectedRoot);
    expect(paths).toEqual([deriveReleaseSetDestination(expectedRoot)]);
    expect(result).toBe(1);
    expect(stderr).toEqual(["release verification failed: release set archive is invalid\n"]);
  });

  test("does nothing when imported instead of executed as the main module", async () => {
    // Catches importing the adapter changing global process exit state or invoking release verification.
    const exitCodeTarget: { exitCode: number | undefined } = { exitCode: undefined };
    let calls = 0;
    await runReleaseVerifyEntrypoint({
      exitCodeTarget,
      isMain: false,
      runCommand: (): Promise<0 | 1 | 2> => {
        calls += 1;
        return Promise.resolve(0);
      },
    });
    expect(calls).toBe(0);
    expect(exitCodeTarget).toEqual({ exitCode: undefined });
  });

  test("writes each command result to the injected process exit-code target", async () => {
    // Catches process.exit use or failure to preserve the CLI status for a caller-controlled target.
    for (const expectedExitCode of [0, 1, 2] as const) {
      const exitCodeTarget: { exitCode: number | undefined } = { exitCode: undefined };
      await runReleaseVerifyEntrypoint({
        exitCodeTarget,
        isMain: true,
        runCommand: (): Promise<0 | 1 | 2> => Promise.resolve(expectedExitCode),
      });
      expect(exitCodeTarget).toEqual({ exitCode: expectedExitCode });
    }
  });

  test("uses the default Node filesystem adapter only for an owned private temporary directory", async () => {
    // Catches the Node adapter returning mutable file contents or misclassifying a regular file.
    await rm(temporaryDirectory, { force: true, recursive: true });
    await mkdir(temporaryDirectory, { recursive: true });
    const path = `${temporaryDirectory}/artifact.zip`;
    await writeFile(path, new Uint8Array([1, 2, 3]));
    try {
      const metadata = await nodeReleaseArtifactReadPort.lstat(path);
      const bytes = await nodeReleaseArtifactReadPort.readFile(path);
      bytes[0] = 9;
      expect(metadata.isRegularFile()).toBe(true);
      expect(metadata.isSymbolicLink()).toBe(false);
      expect(await nodeReleaseArtifactReadPort.readFile(path)).toEqual(new Uint8Array([1, 2, 3]));
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
