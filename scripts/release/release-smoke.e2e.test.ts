import { assembleRelease } from "./release-assembler";
import { fixture } from "./release-assembler.test-support";
import { extractVerifiedRelease, smokeVerifiedRelease } from "./release-smoke";

interface Expectation {
  readonly rejects: { toThrow(expected?: string | RegExp): Promise<void> };
  toBe(expected: unknown): void;
  toHaveLength(expected: number): void;
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
  return (
    isRecord(candidate) &&
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

const configHelp = "Usage: mm-crypto-bot-config-search [--status | --help]\n";
const configStatus =
  '{"available":false,"code":"CONFIG_SEARCH_UNAVAILABLE","operation":"config-search","reason":"exact-strategy-run-corridor-unavailable","schema":"mm-crypto-bot.config-search.result/v1"}\n';
const botHelp = `mm-crypto-bot command-line interface

Usage: bun run apps/bot/src/index.ts <subcommand> [options]

Subcommands:
  backtest              Run a quick backtest on a deterministic OHLC fixture
  config                Validate / show / init the bot config
  help                  Show this help
  kill-switch-dry-run   Simulate the kill-switch path without sending any orders
  kill-switches         Show kill-switch state
  start                 Start the bot (headless — runs until SIGINT/SIGTERM)
  status                Show the persisted bot state
  strategies            List registered strategies + on/off state
  trades                Show recent closed trades

Run \`bun run apps/bot/src/index.ts <subcommand> --help\` for subcommand-specific options.
`;

async function assembled(app: "bot" | "config-search") {
  const current = fixture();
  const result = await assembleRelease(current.dependencies, app);
  return Object.freeze({ ...current, candidate: result.candidate });
}

function queueSuccess(current: Awaited<ReturnType<typeof assembled>>, app: "bot" | "config-search"): void {
  if (app === "bot") {
    current.fileSystem.queueProcess({ exitCode: 1, stderr: botHelp, stdout: "" });
    return;
  }
  current.fileSystem.queueProcess(
    { exitCode: 0, stderr: "", stdout: configHelp },
    { exitCode: 1, stderr: "", stdout: configStatus },
  );
}

describe("release smoke composition", () => {
  test("smokes both deterministic assembled candidates through the typed private boundary", async () => {
    // Catches a smoke path that bypasses the committed assembler and verifier contracts.
    for (const app of ["bot", "config-search"] as const) {
      const current = await assembled(app);
      queueSuccess(current, app);
      await smokeVerifiedRelease(current.dependencies, current.candidate);
      expect(current.fileSystem.processOperations).toHaveLength(app === "bot" ? 1 : 2);
      expect(current.fileSystem.removedDirectories).toHaveLength(1);
    }
  });

  test("rejects every candidate boundary before extraction and validates both candidate files", async () => {
    // Catches accepting exact-shape violations, nested paths, links, or lstat failures.
    const malformed = await assembled("bot");
    const withExtra = { ...malformed.candidate, extra: "reject" };
    await expect(extractVerifiedRelease(malformed.dependencies, withExtra)).rejects.toThrow(
      "private candidate",
    );
    const nested = await assembled("bot");
    await expect(
      extractVerifiedRelease(nested.dependencies, {
        ...nested.candidate,
        directory: "/private/nested/candidate",
      }),
    ).rejects.toThrow("private candidate");
    const wrongSidecar = await assembled("bot");
    await expect(
      extractVerifiedRelease(wrongSidecar.dependencies, {
        ...wrongSidecar.candidate,
        sidecarPath: "/private/release-candidate-1/x",
      }),
    ).rejects.toThrow("private candidate");
    const wrongType = await assembled("bot");
    const candidateWithWrongDirectory = Object.assign({ ...wrongType.candidate }, { directory: 1 });
    await expect(extractVerifiedRelease(wrongType.dependencies, candidateWithWrongDirectory)).rejects.toThrow(
      "private candidate",
    );
    const linked = await assembled("bot");
    linked.fileSystem.setKind(linked.candidate.zipPath, "symbolic-link");
    await expect(extractVerifiedRelease(linked.dependencies, linked.candidate)).rejects.toThrow(
      "private candidate",
    );
    const unavailable = await assembled("bot");
    unavailable.fileSystem.failNextLstat();
    await expect(extractVerifiedRelease(unavailable.dependencies, unavailable.candidate)).rejects.toThrow(
      "private candidate",
    );
    const trapped = await assembled("bot");
    const proxy = new Proxy(
      { ...trapped.candidate },
      {
        ownKeys: (): never => {
          throw new Error("candidate trap");
        },
      },
    );
    await expect(extractVerifiedRelease(trapped.dependencies, proxy)).rejects.toThrow("private candidate");
    const missingDescriptor = await assembled("bot");
    const descriptorProxy = new Proxy(
      { ...missingDescriptor.candidate },
      {
        getOwnPropertyDescriptor(target, key): PropertyDescriptor | undefined {
          if (key === "zipPath") return undefined;
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      },
    );
    await expect(extractVerifiedRelease(missingDescriptor.dependencies, descriptorProxy)).rejects.toThrow(
      "private candidate",
    );
  });

  test("fails closed before extraction for invalid bytes and clears private partial extraction failures", async () => {
    // Catches verifier bypasses, partial writes, and unremoved private extraction trees.
    const corrupted = await assembled("bot");
    corrupted.fileSystem.addFile(corrupted.candidate.zipPath, new Uint8Array([0]));
    await expect(extractVerifiedRelease(corrupted.dependencies, corrupted.candidate)).rejects.toThrow(
      "invalid release",
    );
    expect(corrupted.fileSystem.temporaryDirectoryOperations).toHaveLength(1);
    const partial = await assembled("bot");
    partial.fileSystem.failNextWrite();
    await expect(extractVerifiedRelease(partial.dependencies, partial.candidate)).rejects.toThrow(
      "extraction failed",
    );
    expect(partial.fileSystem.removedDirectories).toHaveLength(1);
    const cleanupFailure = await assembled("bot");
    cleanupFailure.fileSystem.failNextWrite();
    cleanupFailure.fileSystem.failNextDirectoryRemoval();
    await expect(
      extractVerifiedRelease(cleanupFailure.dependencies, cleanupFailure.candidate),
    ).rejects.toThrow("extraction cleanup failed");
    const invalidExtractionDirectory = await assembled("bot");
    const privateDirectory = { path: "/private/release-extraction-1" };
    Object.setPrototypeOf(privateDirectory, { invalid: true });
    invalidExtractionDirectory.fileSystem.setNextPrivateDirectoryValue(privateDirectory);
    await expect(
      extractVerifiedRelease(invalidExtractionDirectory.dependencies, invalidExtractionDirectory.candidate),
    ).rejects.toThrow("extraction failed");
    const escapedExtractionDirectory = await assembled("bot");
    escapedExtractionDirectory.fileSystem.setNextPrivateDirectory("/private/not-owned");
    await expect(
      extractVerifiedRelease(escapedExtractionDirectory.dependencies, escapedExtractionDirectory.candidate),
    ).rejects.toThrow("extraction failed");
    const unavailableTemporaryDirectory = await assembled("bot");
    unavailableTemporaryDirectory.fileSystem.failNextMkdtemp();
    await expect(
      extractVerifiedRelease(
        unavailableTemporaryDirectory.dependencies,
        unavailableTemporaryDirectory.candidate,
      ),
    ).rejects.toThrow("extraction failed");
  });

  test("fails closed for process failure, wrong bot output, both config output contracts, and cleanup", async () => {
    // Catches unguarded execution and every process outcome that is not the closed smoke contract.
    const thrownProcess = await assembled("bot");
    await expect(smokeVerifiedRelease(thrownProcess.dependencies, thrownProcess.candidate)).rejects.toThrow(
      "smoke failed",
    );
    const invalidSmokeCandidate = await assembled("bot");
    invalidSmokeCandidate.fileSystem.addFile(invalidSmokeCandidate.candidate.zipPath, new Uint8Array([0]));
    await expect(
      smokeVerifiedRelease(invalidSmokeCandidate.dependencies, invalidSmokeCandidate.candidate),
    ).rejects.toThrow("invalid release");
    const badBot = await assembled("bot");
    badBot.fileSystem.queueProcess({ exitCode: 1, stderr: "", stdout: "unexpected" });
    await expect(smokeVerifiedRelease(badBot.dependencies, badBot.candidate)).rejects.toThrow("smoke failed");
    const emptyBotStderr = await assembled("bot");
    emptyBotStderr.fileSystem.queueProcess({ exitCode: 1, stderr: "", stdout: "" });
    await expect(smokeVerifiedRelease(emptyBotStderr.dependencies, emptyBotStderr.candidate)).rejects.toThrow(
      "smoke failed",
    );
    const badHelp = await assembled("config-search");
    badHelp.fileSystem.queueProcess({ exitCode: 0, stderr: "unexpected", stdout: configHelp });
    await expect(smokeVerifiedRelease(badHelp.dependencies, badHelp.candidate)).rejects.toThrow(
      "smoke failed",
    );
    const badStatus = await assembled("config-search");
    badStatus.fileSystem.queueProcess(
      { exitCode: 0, stderr: "", stdout: configHelp },
      { exitCode: 1.5, stderr: "", stdout: configStatus },
    );
    await expect(smokeVerifiedRelease(badStatus.dependencies, badStatus.candidate)).rejects.toThrow(
      "smoke failed",
    );
    const unexpectedStatus = await assembled("config-search");
    unexpectedStatus.fileSystem.queueProcess(
      { exitCode: 0, stderr: "", stdout: configHelp },
      { exitCode: 0, stderr: "", stdout: configStatus },
    );
    await expect(
      smokeVerifiedRelease(unexpectedStatus.dependencies, unexpectedStatus.candidate),
    ).rejects.toThrow("smoke failed");
    const trappedProcess = await assembled("bot");
    const resultProxy = new Proxy(
      { exitCode: 1, stderr: "", stdout: "" },
      {
        ownKeys: (): never => {
          throw new Error("process trap");
        },
      },
    );
    trappedProcess.fileSystem.queueProcess(resultProxy);
    await expect(smokeVerifiedRelease(trappedProcess.dependencies, trappedProcess.candidate)).rejects.toThrow(
      "smoke failed",
    );
    const cleanupFailure = await assembled("bot");
    queueSuccess(cleanupFailure, "bot");
    cleanupFailure.fileSystem.failNextDirectoryRemoval();
    await expect(smokeVerifiedRelease(cleanupFailure.dependencies, cleanupFailure.candidate)).rejects.toThrow(
      "smoke cleanup failed",
    );
    expect(cleanupFailure.fileSystem.pathKind(cleanupFailure.candidate.directory)).toBe("directory");
  });
});
