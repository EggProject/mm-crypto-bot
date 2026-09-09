import { canonicalJson, formatSha256Sidecar, sha256Hex, type ReleaseManifestV1 } from "./release-contract";
import { fixture, temporaryRoot } from "./release-assembler.test-support";
import { extractVerifiedRelease, smokeVerifiedRelease } from "./release-smoke";
import { encodeStoreZip } from "./zip-store-encoder";

interface AsyncExpectation {
  toThrow(expected?: string | RegExp): Promise<void>;
}

interface Expectation {
  readonly rejects: AsyncExpectation;
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
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

const encoder = new TextEncoder();
const epoch = 1_788_199_915;
const unavailableJson =
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

function archive(app: "bot" | "config-search") {
  const readme = encoder.encode(`README for ${app}\n`);
  const executable = encoder.encode(`executable ${app}\n`);
  const executablePath = `bin/mm-crypto-bot-${app}` as const;
  const manifest: ReleaseManifestV1 = {
    app,
    commit: "a".repeat(40),
    configuration: { embedded: false, external: true, runtimeRootEnvironment: "MM_CRYPTO_BOT_RUNTIME_ROOT" },
    lockfileSha256: "b".repeat(64),
    payloads: [
      { bytes: readme.length, mode: "0644", path: "README.md", sha256: sha256Hex(readme) },
      { bytes: executable.length, mode: "0755", path: executablePath, sha256: sha256Hex(executable) },
    ],
    schema: "mm-crypto-bot.release-manifest/v1",
    sourceDateEpoch: epoch,
    target: { arch: "x64", bunTarget: "bun-linux-x64", os: "linux" },
    toolchain: { bun: "1.3.14", nodeMetadata: "24.19.0" },
    version: "0.1.0",
  };
  const zipBytes = encodeStoreZip(
    [
      { bytes: readme, mode: 0o644, path: "README.md" },
      { bytes: executable, mode: 0o755, path: executablePath },
      { bytes: encoder.encode(canonicalJson(manifest)), mode: 0o644, path: "manifest.json" },
    ],
    epoch,
  );
  const zipBasename = `mm-crypto-bot-${app}-0.1.0-bun-linux-x64.zip`;
  const sidecar = formatSha256Sidecar(sha256Hex(zipBytes), zipBasename);
  return Object.freeze({
    sidecarBytes: encoder.encode(sidecar),
    zipBytes,
    zipBasename,
  });
}

function candidate(app: "bot" | "config-search") {
  const current = fixture();
  const archiveBytes = archive(app);
  const directory = `${temporaryRoot}/release-candidate-1`;
  const zipPath = `${directory}/${archiveBytes.zipBasename}`;
  current.fileSystem.addDirectory(directory);
  current.fileSystem.addFile(zipPath, archiveBytes.zipBytes);
  current.fileSystem.addFile(`${zipPath}.sha256`, archiveBytes.sidecarBytes);
  return Object.freeze({
    artifact: Object.freeze({ directory, sidecarPath: `${zipPath}.sha256`, zipPath }),
    ...current,
  });
}

describe("verified release smoke", () => {
  test("extracts only verified fixed payload paths with fixed modes and an isolated frozen result", async () => {
    // Catches extracting unverified paths, modes, or mutable manifest state.
    const current = candidate("bot");
    const extracted = await extractVerifiedRelease(current.dependencies, current.artifact);
    expect(current.fileSystem.temporaryDirectoryOperations).toEqual([
      { parentDirectory: temporaryRoot, prefix: "release-extraction-" },
    ]);
    expect(current.fileSystem.directoryOperations).toEqual([
      { mode: 0o755, path: `${extracted.rootDirectory}/bin` },
    ]);
    expect(current.fileSystem.writeOperations.map((operation) => operation.path)).toEqual([
      `${extracted.rootDirectory}/README.md`,
      `${extracted.rootDirectory}/manifest.json`,
      extracted.executablePath,
    ]);
    expect(current.fileSystem.writeModes).toEqual([0o644, 0o644, 0o755]);
    expect(Object.isFrozen(extracted)).toBe(true);
    expect(Object.isFrozen(extracted.manifest)).toBe(true);
    expect(extracted.rootDirectory.startsWith(`${temporaryRoot}/release-extraction-`)).toBe(true);
  });

  test("rejects invalid candidate boundaries before reads or extraction", async () => {
    // Catches accepting a non-private, nested, or non-exact candidate path.
    const current = candidate("bot");
    await expect(
      extractVerifiedRelease(current.dependencies, {
        ...current.artifact,
        directory: `${temporaryRoot}/nested/candidate`,
      }),
    ).rejects.toThrow("invalid release private candidate");
    expect(current.fileSystem.readOperations).toEqual([]);
    expect(current.fileSystem.temporaryDirectoryOperations).toEqual([]);
  });

  test("lstats candidate files before copying bytes and rejects links or non-files", async () => {
    // Catches reading through a symlink or accepting a directory as a candidate payload.
    const current = candidate("bot");
    current.fileSystem.setKind(current.artifact.zipPath, "symbolic-link");
    await expect(extractVerifiedRelease(current.dependencies, current.artifact)).rejects.toThrow(
      "invalid release private candidate",
    );
    expect(current.fileSystem.readOperations).toEqual([]);
    expect(current.fileSystem.temporaryDirectoryOperations).toEqual([]);
  });

  test("verifies copied bytes before creating an extraction directory", async () => {
    // Catches creating or writing extraction state before archive verification.
    const current = candidate("bot");
    current.fileSystem.addFile(current.artifact.sidecarPath, encoder.encode("invalid\n"));
    await expect(extractVerifiedRelease(current.dependencies, current.artifact)).rejects.toThrow(
      "invalid release",
    );
    expect(current.fileSystem.temporaryDirectoryOperations).toEqual([]);
    expect(current.fileSystem.writeOperations).toEqual([]);
  });

  test("runs only fixed, network-isolated argv and environment contracts for both applications", async () => {
    // Catches inherited environment, shell-like argv, or a missing config-search smoke form.
    const bot = candidate("bot");
    bot.fileSystem.queueProcess({ exitCode: 1, stderr: botHelp, stdout: "" });
    await smokeVerifiedRelease(bot.dependencies, bot.artifact);
    const config = candidate("config-search");
    config.fileSystem.queueProcess(
      { exitCode: 0, stderr: "", stdout: "Usage: mm-crypto-bot-config-search [--status | --help]\n" },
      { exitCode: 1, stderr: "", stdout: unavailableJson },
    );
    await smokeVerifiedRelease(config.dependencies, config.artifact);
    for (const call of [...bot.fileSystem.processOperations, ...config.fileSystem.processOperations]) {
      expect(call.argv.slice(0, 4)).toEqual(["unshare", "--user", "--map-root-user", "--net"]);
      expect(call.env).toEqual({ HOME: call.cwd, LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin", TZ: "UTC" });
    }
    expect(config.fileSystem.processOperations.map((call) => call.argv)).toEqual([
      [
        "unshare",
        "--user",
        "--map-root-user",
        "--net",
        config.fileSystem.processOperations[0]?.argv[4],
        "--help",
      ],
      [
        "unshare",
        "--user",
        "--map-root-user",
        "--net",
        config.fileSystem.processOperations[1]?.argv[4],
        "--status",
      ],
    ]);
  });

  test("fails closed on every unexpected process result and removes only the owned extraction", async () => {
    // Catches process-output acceptance, raw process error disclosure, or candidate deletion.
    const current = candidate("bot");
    current.fileSystem.queueProcess({ exitCode: 0, stderr: "untrusted detail", stdout: "unexpected" });
    await expect(smokeVerifiedRelease(current.dependencies, current.artifact)).rejects.toThrow(
      "release smoke failed",
    );
    expect(current.fileSystem.removedDirectories).toHaveLength(1);
    expect(current.fileSystem.pathKind(current.artifact.directory)).toBe("directory");
  });

  test("rejects bot help results whose stderr is empty or differs from the public contract", async () => {
    // Catches accepting a bot process result without the exact deterministic help stderr.
    const emptyStderr = candidate("bot");
    emptyStderr.fileSystem.queueProcess({ exitCode: 1, stderr: "", stdout: "" });
    await expect(smokeVerifiedRelease(emptyStderr.dependencies, emptyStderr.artifact)).rejects.toThrow(
      "release smoke failed",
    );
    const wrongStderr = candidate("bot");
    wrongStderr.fileSystem.queueProcess({ exitCode: 1, stderr: "wrong help\n", stdout: "" });
    await expect(smokeVerifiedRelease(wrongStderr.dependencies, wrongStderr.artifact)).rejects.toThrow(
      "release smoke failed",
    );
  });

  test("redacts candidate descriptor traps and ZIP or sidecar read failures before extraction", async () => {
    // Catches leaking attacker-controlled proxy or filesystem read failure details.
    const trappedCandidate = candidate("bot");
    const proxy = new Proxy(trappedCandidate.artifact, {
      getOwnPropertyDescriptor: (): never => {
        throw new Error("candidate descriptor trap");
      },
    });
    await expect(extractVerifiedRelease(trappedCandidate.dependencies, proxy)).rejects.toThrow(
      "invalid release private candidate",
    );
    expect(trappedCandidate.fileSystem.temporaryDirectoryOperations).toEqual([]);
    const missingDescriptor = candidate("bot");
    const descriptorProxy = new Proxy(
      { ...missingDescriptor.artifact },
      {
        getOwnPropertyDescriptor(target, key): PropertyDescriptor | undefined {
          if (key === "zipPath") return undefined;
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      },
    );
    await expect(extractVerifiedRelease(missingDescriptor.dependencies, descriptorProxy)).rejects.toThrow(
      "invalid release private candidate",
    );
    const zipReadFailure = candidate("bot");
    zipReadFailure.fileSystem.failNextRead();
    await expect(
      extractVerifiedRelease(zipReadFailure.dependencies, zipReadFailure.artifact),
    ).rejects.toThrow("invalid release private candidate");
    expect(zipReadFailure.fileSystem.temporaryDirectoryOperations).toEqual([]);
    const sidecarReadFailure = candidate("bot");
    sidecarReadFailure.fileSystem.failSecondRead();
    await expect(
      extractVerifiedRelease(sidecarReadFailure.dependencies, sidecarReadFailure.artifact),
    ).rejects.toThrow("invalid release private candidate");
    expect(sidecarReadFailure.fileSystem.readOperations).toEqual([
      sidecarReadFailure.artifact.zipPath,
      sidecarReadFailure.artifact.sidecarPath,
    ]);
    expect(sidecarReadFailure.fileSystem.temporaryDirectoryOperations).toEqual([]);
  });

  test("redacts process result proxy and descriptor failures", async () => {
    // Catches leaking a hostile process result's traps during smoke-result validation.
    const current = candidate("bot");
    const proxy = new Proxy(
      { exitCode: 1, stderr: "", stdout: "" },
      {
        ownKeys: (): never => {
          throw new Error("process result trap");
        },
      },
    );
    current.fileSystem.queueProcess(proxy);
    await expect(smokeVerifiedRelease(current.dependencies, current.artifact)).rejects.toThrow(
      "release smoke failed",
    );
    const missingDescriptor = candidate("bot");
    const descriptorProxy = new Proxy(
      { exitCode: 1, stderr: "", stdout: "" },
      {
        getOwnPropertyDescriptor(target, key): PropertyDescriptor | undefined {
          if (key === "stdout") return undefined;
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      },
    );
    missingDescriptor.fileSystem.queueProcess(descriptorProxy);
    await expect(
      smokeVerifiedRelease(missingDescriptor.dependencies, missingDescriptor.artifact),
    ).rejects.toThrow("release smoke failed");
  });

  test("fails closed when cleanup fails", async () => {
    // Catches treating an unremoved extraction directory as a successful smoke.
    const current = candidate("bot");
    current.fileSystem.queueProcess({ exitCode: 1, stderr: "", stdout: "" });
    current.fileSystem.failNextDirectoryRemoval();
    await expect(smokeVerifiedRelease(current.dependencies, current.artifact)).rejects.toThrow(
      "release smoke cleanup failed",
    );
  });
});
