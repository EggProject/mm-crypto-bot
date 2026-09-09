import {
  assertAllPrivateCandidateReproducibility,
  assertPrivateCandidateReproducibility,
  verifyPrivateReleaseCandidate,
} from "./release-private-candidate-reproducibility";
import { assembleRelease } from "./release-assembler";
import { fixture } from "./release-assembler.test-support";
import { extractVerifiedRelease } from "./release-smoke";

interface Expectation {
  readonly rejects: { toThrow(expected?: string | RegExp): Promise<void> };
  toEqual(expected: unknown): void;
  toHaveLength(expected: number): void;
}
interface TestApi {
  expect(actual: unknown): Expectation;
  test(name: string, run: () => void | Promise<void>): void;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function isTestApi(value: unknown): value is TestApi {
  return isRecord(value) && typeof value["expect"] === "function" && typeof value["test"] === "function";
}
const runtime: unknown = await import(typeof Bun === "undefined" ? "vitest" : "bun:test");
if (!isTestApi(runtime)) throw new Error("The selected test runtime does not expose the required API.");
const expect = (actual: unknown): Expectation => runtime.expect(actual);
const test = (name: string, run: () => void | Promise<void>): void => {
  runtime.test(name, run);
};
const botHelp =
  "mm-crypto-bot command-line interface\n\nUsage: bun run apps/bot/src/index.ts <subcommand> [options]\n\nSubcommands:\n  backtest              Run a quick backtest on a deterministic OHLC fixture\n  config                Validate / show / init the bot config\n  help                  Show this help\n  kill-switch-dry-run   Simulate the kill-switch path without sending any orders\n  kill-switches         Show kill-switch state\n  start                 Start the bot (headless — runs until SIGINT/SIGTERM)\n  status                Show the persisted bot state\n  strategies            List registered strategies + on/off state\n  trades                Show recent closed trades\n\nRun `bun run apps/bot/src/index.ts <subcommand> --help` for subcommand-specific options.\n";

test("verifies two private bot candidates before their isolated smoke runs and removes all owned state", async () => {
  // Catches smoke-before-comparison and leaked extraction or candidate state.
  const current = fixture();
  current.fileSystem.queueProcess(
    { exitCode: 1, stderr: botHelp, stdout: "" },
    { exitCode: 1, stderr: botHelp, stdout: "" },
  );
  await assertPrivateCandidateReproducibility(current.dependencies, "bot");
  expect(current.compilerCalls.map((call) => call.outputPath)).toEqual([
    "/private/mm-crypto-bot-bot-candidate-1/mm-crypto-bot-bot",
    "/private/mm-crypto-bot-bot-candidate-2/mm-crypto-bot-bot",
  ]);
  expect(current.fileSystem.removedDirectories).toEqual([
    "/private/release-extraction-3",
    "/private/release-extraction-4",
    "/private/mm-crypto-bot-bot-candidate-1",
    "/private/mm-crypto-bot-bot-candidate-2",
  ]);
});

test("fails closed for invalid input, assembly failure, verification failure, and mismatch", async () => {
  // Catches coerced application names, unredacted failures, or smoke after mismatch.
  const invalid = fixture();
  await expect(assertPrivateCandidateReproducibility(invalid.dependencies, "BOT")).rejects.toThrow(
    "release private candidate reproducibility assembly failed",
  );
  expect(invalid.compilerCalls).toEqual([]);

  const assembly = fixture();
  const compilerFailure: unknown = "compiler detail";
  assembly.fileSystem.addFile = () => {
    throw compilerFailure;
  };
  await expect(assertPrivateCandidateReproducibility(assembly.dependencies, "bot")).rejects.toThrow(
    "release private candidate reproducibility assembly failed",
  );

  const verification = fixture();
  const readFile = verification.dependencies.fileSystem.readFile.bind(verification.dependencies.fileSystem);
  verification.dependencies.fileSystem.readFile = (filePath) =>
    filePath.endsWith(".zip") ? Promise.resolve(new Uint8Array([0])) : readFile(filePath);
  await expect(assertPrivateCandidateReproducibility(verification.dependencies, "bot")).rejects.toThrow(
    "release private candidate reproducibility verification failed",
  );
  expect(verification.fileSystem.processOperations).toEqual([]);

  const mismatch = fixture();
  let compileCount = 0;
  mismatch.dependencies.compiler.compile = (input) => {
    compileCount += 1;
    mismatch.fileSystem.addFile(input.outputPath, new TextEncoder().encode(compileCount.toString()));
    return Promise.resolve();
  };
  await expect(assertPrivateCandidateReproducibility(mismatch.dependencies, "bot")).rejects.toThrow(
    "release private candidate reproducibility mismatch",
  );
  expect(mismatch.fileSystem.processOperations).toEqual([]);
});

test("maps smoke and candidate cleanup failures after attempting all owned removals", async () => {
  // Catches raw smoke errors or aborting cleanup after its first failure.
  const smoke = fixture();
  smoke.fileSystem.queueProcess({ exitCode: 0, stderr: "", stdout: "" });
  await expect(assertPrivateCandidateReproducibility(smoke.dependencies, "bot")).rejects.toThrow(
    "release private candidate reproducibility smoke failed",
  );
  expect(smoke.fileSystem.removedDirectories).toEqual([
    "/private/release-extraction-3",
    "/private/mm-crypto-bot-bot-candidate-1",
    "/private/mm-crypto-bot-bot-candidate-2",
  ]);

  const cleanup = fixture();
  cleanup.fileSystem.queueProcess(
    { exitCode: 1, stderr: botHelp, stdout: "" },
    { exitCode: 1, stderr: botHelp, stdout: "" },
  );
  const remove = cleanup.dependencies.fileSystem.removePrivateDirectory.bind(cleanup.dependencies.fileSystem);
  let removalCount = 0;
  cleanup.dependencies.fileSystem.removePrivateDirectory = (directory) => {
    removalCount += 1;
    const cleanupFailure: unknown = "cleanup detail";
    if (removalCount === 3) throw cleanupFailure;
    return remove(directory);
  };
  await expect(assertPrivateCandidateReproducibility(cleanup.dependencies, "bot")).rejects.toThrow(
    "release private candidate cleanup failed",
  );
  expect(cleanup.fileSystem.removedDirectories).toEqual([
    "/private/release-extraction-3",
    "/private/release-extraction-4",
    "/private/mm-crypto-bot-bot-candidate-2",
  ]);
});

test("copies only verified candidate values and runs both approved application pairs", async () => {
  // Catches proxy input leakage and a missing aggregate config-search pair.
  const hostile = fixture();
  const proxy = new Proxy(
    {
      directory: "/private/candidate",
      sidecarPath: "/private/candidate/x.sha256",
      zipPath: "/private/candidate/x",
    },
    {
      ownKeys: (): never => {
        throw new Error("candidate trap");
      },
    },
  );
  await expect(verifyPrivateReleaseCandidate(hostile.dependencies, proxy)).rejects.toThrow(
    "release private candidate reproducibility verification failed",
  );
  const all = fixture();
  all.fileSystem.queueProcess(
    { exitCode: 1, stderr: botHelp, stdout: "" },
    { exitCode: 1, stderr: botHelp, stdout: "" },
    { exitCode: 0, stderr: "", stdout: "Usage: mm-crypto-bot-config-search [--status | --help]\n" },
    {
      exitCode: 1,
      stderr: "",
      stdout:
        '{"available":false,"code":"CONFIG_SEARCH_UNAVAILABLE","operation":"config-search","reason":"exact-strategy-run-corridor-unavailable","schema":"mm-crypto-bot.config-search.result/v1"}\n',
    },
    { exitCode: 0, stderr: "", stdout: "Usage: mm-crypto-bot-config-search [--status | --help]\n" },
    {
      exitCode: 1,
      stderr: "",
      stdout:
        '{"available":false,"code":"CONFIG_SEARCH_UNAVAILABLE","operation":"config-search","reason":"exact-strategy-run-corridor-unavailable","schema":"mm-crypto-bot.config-search.result/v1"}\n',
    },
  );
  await assertAllPrivateCandidateReproducibility(all.dependencies);
  expect(all.compilerCalls).toHaveLength(4);
});

test("maps a second bot smoke failure after cleanup attempts for both candidates", async () => {
  // Catches returning early without deleting the first successful smoke candidate.
  const current = fixture();
  current.fileSystem.queueProcess(
    { exitCode: 1, stderr: botHelp, stdout: "" },
    { exitCode: 0, stderr: "", stdout: "" },
  );
  await expect(assertPrivateCandidateReproducibility(current.dependencies, "bot")).rejects.toThrow(
    "release private candidate reproducibility smoke failed",
  );
  expect(current.fileSystem.removedDirectories).toEqual([
    "/private/release-extraction-3",
    "/private/release-extraction-4",
    "/private/mm-crypto-bot-bot-candidate-1",
    "/private/mm-crypto-bot-bot-candidate-2",
  ]);
});

test("maps the second config-search status failure and extraction cleanup to stable smoke outcomes", async () => {
  // Catches skipping config status and failing to continue candidate cleanup after extraction cleanup fails.
  const status = fixture();
  status.fileSystem.queueProcess(
    { exitCode: 0, stderr: "", stdout: "Usage: mm-crypto-bot-config-search [--status | --help]\n" },
    {
      exitCode: 1,
      stderr: "",
      stdout:
        '{"available":false,"code":"CONFIG_SEARCH_UNAVAILABLE","operation":"config-search","reason":"exact-strategy-run-corridor-unavailable","schema":"mm-crypto-bot.config-search.result/v1"}\n',
    },
    { exitCode: 0, stderr: "", stdout: "Usage: mm-crypto-bot-config-search [--status | --help]\n" },
    { exitCode: 1, stderr: "", stdout: "wrong\n" },
  );
  await expect(assertPrivateCandidateReproducibility(status.dependencies, "config-search")).rejects.toThrow(
    "release private candidate reproducibility smoke failed",
  );
  expect(status.fileSystem.removedDirectories).toEqual([
    "/private/release-extraction-3",
    "/private/release-extraction-4",
    "/private/mm-crypto-bot-config-search-candidate-1",
    "/private/mm-crypto-bot-config-search-candidate-2",
  ]);

  const extraction = fixture();
  extraction.fileSystem.queueProcess({ exitCode: 1, stderr: botHelp, stdout: "" });
  extraction.fileSystem.failNextDirectoryRemoval();
  await expect(assertPrivateCandidateReproducibility(extraction.dependencies, "bot")).rejects.toThrow(
    "release private candidate reproducibility smoke failed",
  );
  expect(extraction.fileSystem.removedDirectories).toEqual([
    "/private/mm-crypto-bot-bot-candidate-1",
    "/private/mm-crypto-bot-bot-candidate-2",
  ]);
});

test("redacts a genuinely rejected non-Error compiler promise", async () => {
  // Catches exposing non-Error rejection values from the assembly port.
  const current = fixture();
  const reject = Promise.reject.bind(Promise);
  current.dependencies.compiler.compile = () => reject("compiler rejection");
  await expect(assertPrivateCandidateReproducibility(current.dependencies, "bot")).rejects.toThrow(
    "release private candidate reproducibility assembly failed",
  );
  expect(current.fileSystem.removedDirectories).toEqual(["/private/mm-crypto-bot-bot-candidate-1"]);
});

test("rejects unproven extraction directories without removing or writing through them", async () => {
  // Catches hostile mkdtemp results becoming cleanup-authorized before validation.
  for (const configure of [
    (current: ReturnType<typeof fixture>): void => {
      current.fileSystem.setNextPrivateDirectory("/private/not-owned");
    },
    (current: ReturnType<typeof fixture>): void => {
      current.fileSystem.setNextPrivateDirectory("/private/release-extraction-");
    },
    (current: ReturnType<typeof fixture>): void => {
      current.fileSystem.setNextPrivateDirectoryValue(
        new Proxy(
          { path: "/private/release-extraction-1" },
          {
            getOwnPropertyDescriptor: (): never => {
              throw new Error("extraction descriptor trap");
            },
          },
        ),
      );
    },
    (current: ReturnType<typeof fixture>): void => {
      current.fileSystem.setNextPrivateDirectoryValue(
        new Proxy(
          { path: "/private/release-extraction-1" },
          {
            getOwnPropertyDescriptor: () => ({
              configurable: true,
              enumerable: true,
              value: 1,
              writable: true,
            }),
          },
        ),
      );
    },
  ]) {
    const current = fixture();
    const assembled = await assembleRelease(current.dependencies, "bot");
    const writeCount = current.fileSystem.writeOperations.length;
    configure(current);
    await expect(extractVerifiedRelease(current.dependencies, assembled.candidate)).rejects.toThrow(
      "release extraction failed",
    );
    expect(current.fileSystem.removedDirectories).toEqual([]);
    expect(current.fileSystem.writeOperations).toHaveLength(writeCount);
    expect(current.fileSystem.processOperations).toEqual([]);
  }
});
