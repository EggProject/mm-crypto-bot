import {
  assertAllPrivateCandidateReproducibility,
  assertPrivateCandidateReproducibility,
  verifyPrivateReleaseCandidate,
} from "./release-private-candidate-reproducibility";
import { fixture } from "./release-assembler.test-support";

interface Expectation {
  readonly rejects: { toThrow(expected?: string | RegExp): Promise<void> };
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toHaveLength(expected: number): void;
}

const botHelp =
  "mm-crypto-bot command-line interface\n\nUsage: bun run apps/bot/src/index.ts <subcommand> [options]\n\nSubcommands:\n  backtest              Run a quick backtest on a deterministic OHLC fixture\n  config                Validate / show / init the bot config\n  help                  Show this help\n  kill-switch-dry-run   Simulate the kill-switch path without sending any orders\n  kill-switches         Show kill-switch state\n  start                 Start the bot (headless — runs until SIGINT/SIGTERM)\n  status                Show the persisted bot state\n  strategies            List registered strategies + on/off state\n  trades                Show recent closed trades\n\nRun `bun run apps/bot/src/index.ts <subcommand> --help` for subcommand-specific options.\n";
const configHelp = "Usage: mm-crypto-bot-config-search [--status | --help]\n";
const configStatus =
  '{"available":false,"code":"CONFIG_SEARCH_UNAVAILABLE","operation":"config-search","reason":"exact-strategy-run-corridor-unavailable","schema":"mm-crypto-bot.config-search.result/v1"}\n';

function queueSuccess(current: ReturnType<typeof fixture>, app: "bot" | "config-search"): void {
  if (app === "bot") {
    current.fileSystem.queueProcess({ exitCode: 1, stderr: botHelp, stdout: "" });
    return;
  }
  current.fileSystem.queueProcess(
    { exitCode: 0, stderr: "", stdout: configHelp },
    { exitCode: 1, stderr: "", stdout: configStatus },
  );
}

interface TestApi {
  expect(actual: unknown): Expectation;
  test(name: string, run: () => void | Promise<void>): void;
}

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  return typeof candidate === "object" && candidate !== null;
}

function isTestApi(candidate: unknown): candidate is TestApi {
  return (
    isRecord(candidate) &&
    typeof candidate["expect"] === "function" &&
    typeof candidate["test"] === "function"
  );
}

const testRuntime: unknown = await import(typeof Bun === "undefined" ? "vitest" : "bun:test");
if (!isTestApi(testRuntime)) throw new Error("The selected test runtime does not expose the required API.");
const expect = (actual: unknown): Expectation => testRuntime.expect(actual);
const test = (name: string, run: () => void | Promise<void>): void => {
  testRuntime.test(name, run);
};

test("assembles, verifies, compares, smokes, then removes two private bot candidates", async () => {
  // Catches a non-private, one-build, unverified, or uncleared reproducibility path.
  const current = fixture();
  queueSuccess(current, "bot");
  queueSuccess(current, "bot");

  await assertPrivateCandidateReproducibility(current.dependencies, "bot");

  expect(current.compilerCalls).toHaveLength(2);
  expect(current.fileSystem.removedDirectories).toHaveLength(4);
});

test("runs an isolated pair for each application in the approved order", async () => {
  // Catches mixing both applications into one candidate set or skipping config-search.
  const current = fixture();
  queueSuccess(current, "bot");
  queueSuccess(current, "bot");
  queueSuccess(current, "config-search");
  queueSuccess(current, "config-search");
  await assertAllPrivateCandidateReproducibility(current.dependencies);
  expect(current.compilerCalls.map((call) => call.entryPoint)).toEqual([
    "/repo/apps/bot/src/index.ts",
    "/repo/apps/bot/src/index.ts",
    "/repo/apps/config-search/src/index.ts",
    "/repo/apps/config-search/src/index.ts",
  ]);
  expect(current.fileSystem.removedDirectories).toHaveLength(8);
});

test("maps different valid compiler payloads to mismatch without smoke and removes both candidates", async () => {
  // Catches comparing only sidecars or smoking non-identical compiler outputs.
  const current = fixture();
  let compilerCall = 0;
  current.dependencies.compiler.compile = (input) => {
    compilerCall += 1;
    current.fileSystem.addFile(
      input.outputPath,
      new TextEncoder().encode(`payload-${compilerCall.toString()}\n`),
    );
    return Promise.resolve();
  };
  await expect(assertPrivateCandidateReproducibility(current.dependencies, "bot")).rejects.toThrow(
    "release private candidate reproducibility mismatch",
  );
  expect(current.fileSystem.processOperations).toEqual([]);
  expect(current.fileSystem.removedDirectories).toHaveLength(2);
  expect(current.fileSystem.pathKind("/repo/releases/bot/0.1.0/bun-linux-x64")).toBe("missing");
});

test("maps verification and smoke failures to stable outcomes and still removes every candidate", async () => {
  // Catches archive failure entering smoke or a failed smoke leaving candidates behind.
  const corrupt = fixture();
  const readFile = corrupt.dependencies.fileSystem.readFile.bind(corrupt.dependencies.fileSystem);
  corrupt.dependencies.fileSystem.readFile = (filePath) =>
    filePath.endsWith(".zip") ? Promise.resolve(new Uint8Array([0])) : readFile(filePath);
  await expect(assertPrivateCandidateReproducibility(corrupt.dependencies, "bot")).rejects.toThrow(
    "release private candidate reproducibility verification failed",
  );
  expect(corrupt.fileSystem.processOperations).toEqual([]);
  expect(corrupt.fileSystem.removedDirectories).toHaveLength(2);

  const smoke = fixture();
  smoke.fileSystem.queueProcess({ exitCode: 0, stderr: "", stdout: "" });
  await expect(assertPrivateCandidateReproducibility(smoke.dependencies, "bot")).rejects.toThrow(
    "release private candidate reproducibility smoke failed",
  );
  expect(smoke.fileSystem.removedDirectories).toHaveLength(3);
});

test("fails closed before activity for an invalid app and redacts hostile candidate input", async () => {
  // Catches coercing application selectors or leaking candidate proxy traps.
  const invalid = fixture();
  await expect(assertPrivateCandidateReproducibility(invalid.dependencies, "BOT")).rejects.toThrow(
    "release private candidate reproducibility assembly failed",
  );
  expect(invalid.compilerCalls).toEqual([]);
  expect(invalid.fileSystem.temporaryDirectoryOperations).toEqual([]);

  const hostile = fixture();
  const candidate = {
    directory: "/private/candidate",
    sidecarPath: "/private/candidate/release.zip.sha256",
    zipPath: "/private/candidate/release.zip",
  };
  const proxy = new Proxy(candidate, {
    getOwnPropertyDescriptor: (): never => {
      throw new Error("private candidate trap");
    },
  });
  await expect(verifyPrivateReleaseCandidate(hostile.dependencies, proxy)).rejects.toThrow(
    "release private candidate reproducibility verification failed",
  );
  expect(hostile.fileSystem.readOperations).toEqual([]);
});

test("maps assembly and candidate cleanup failures without exposing their causes", async () => {
  // Catches raw dependency rejections and stopping after the first candidate removal failure.
  const assembly = fixture();
  assembly.dependencies.compiler.compile = () => Promise.reject(new Error("compiler cause"));
  await expect(assertPrivateCandidateReproducibility(assembly.dependencies, "bot")).rejects.toThrow(
    "release private candidate reproducibility assembly failed",
  );
  const cleanup = fixture();
  queueSuccess(cleanup, "bot");
  queueSuccess(cleanup, "bot");
  const remove = cleanup.dependencies.fileSystem.removePrivateDirectory.bind(cleanup.dependencies.fileSystem);
  let removalCount = 0;
  cleanup.dependencies.fileSystem.removePrivateDirectory = (directory) => {
    removalCount += 1;
    if (removalCount === 3) return Promise.reject(new Error("cleanup cause"));
    return remove(directory);
  };
  await expect(assertPrivateCandidateReproducibility(cleanup.dependencies, "bot")).rejects.toThrow(
    "release private candidate cleanup failed",
  );
  expect(removalCount).toEqual(4);
});
