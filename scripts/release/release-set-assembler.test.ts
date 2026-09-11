import { expect, test } from "vitest";

import { canonicalJson, formatSha256Sidecar, sha256Hex, type ReleaseManifestV1 } from "./release-contract";
import { releaseSetCandidatePrefix, type ReleaseSetInput } from "./release-set-contract";
import { assembleReleaseSetCandidate } from "./release-set-assembler";
import type { ReleaseDependencies } from "./release-ports";
import { encodeStoreZip } from "./zip-store-encoder";

const text = new TextEncoder();
function input(app: "bot" | "config-search"): ReleaseSetInput {
  const readme = text.encode(app);
  const executable = text.encode(`${app}-binary`);
  const manifest: ReleaseManifestV1 = {
    app,
    commit: "a".repeat(40),
    configuration: { embedded: false, external: true, runtimeRootEnvironment: "MM_CRYPTO_BOT_RUNTIME_ROOT" },
    lockfileSha256: "b".repeat(64),
    payloads: [
      { bytes: readme.length, mode: "0644", path: "README.md", sha256: sha256Hex(readme) },
      {
        bytes: executable.length,
        mode: "0755",
        path: `bin/mm-crypto-bot-${app}`,
        sha256: sha256Hex(executable),
      },
    ],
    schema: "mm-crypto-bot.release-manifest/v1",
    sourceDateEpoch: 1_788_199_914,
    target: { arch: "x64", bunTarget: "bun-linux-x64", os: "linux" },
    toolchain: { bun: "1.3.14", nodeMetadata: "24.19.0" },
    version: "0.1.0",
  };
  const zipBytes = encodeStoreZip(
    [
      { bytes: readme, mode: 0o644, path: "README.md" },
      { bytes: executable, mode: 0o755, path: `bin/mm-crypto-bot-${app}` },
      { bytes: text.encode(canonicalJson(manifest)), mode: 0o644, path: "manifest.json" },
    ],
    manifest.sourceDateEpoch,
  );
  return {
    application: app,
    innerManifest: manifest,
    sidecarBytes: text.encode(
      formatSha256Sidecar(sha256Hex(zipBytes), `mm-crypto-bot-${app}-0.1.0-bun-linux-x64.zip`),
    ),
    zipBytes,
  };
}
interface FileSystemOperationLedger {
  readonly mkdtempCalls: string[];
  readonly removals: string[];
  readonly writes: string[];
}

function createFileSystemOperationLedger(): FileSystemOperationLedger {
  return { mkdtempCalls: [], removals: [], writes: [] };
}

function dependencies(
  ledger: FileSystemOperationLedger,
  directory = `/private/${releaseSetCandidatePrefix}safe`,
  shouldWriteFail = false,
): ReleaseDependencies {
  return {
    compiler: { compile: (): Promise<void> => Promise.resolve() },
    fileSystem: {
      chmod: (): Promise<void> => Promise.resolve(),
      inspectPath: (): Promise<"missing"> => Promise.resolve("missing"),
      lstat: (): Promise<{ readonly isRegularFile: () => boolean; readonly isSymbolicLink: () => boolean }> =>
        Promise.resolve({ isRegularFile: () => true, isSymbolicLink: () => false }),
      mkdir: (): Promise<void> => Promise.resolve(),
      mkdtemp: (request): Promise<{ readonly path: string }> => {
        ledger.mkdtempCalls.push(`${request.parentDirectory}:${request.prefix}`);
        return Promise.resolve({ path: directory });
      },
      readFile: (): Promise<Uint8Array> => Promise.resolve(new Uint8Array()),
      removePrivateDirectory: (value): Promise<void> => {
        ledger.removals.push(value.path);
        return Promise.resolve();
      },
      removeFile: (): Promise<void> => Promise.resolve(),
      writeFile: (target, bytes): Promise<void> => {
        ledger.writes.push(`${target}:${String(bytes.length)}`);
        return shouldWriteFail ? Promise.reject(new Error("write failed")) : Promise.resolve();
      },
    },
    git: {
      headCommit: (): Promise<string> => Promise.resolve("a".repeat(40)),
      headCommitEpoch: (): Promise<string> => Promise.resolve("1788199914"),
      porcelainStatus: (): Promise<string> => Promise.resolve(""),
    },
    process: {
      run: (): Promise<{ readonly exitCode: number; readonly stderr: string; readonly stdout: string }> =>
        Promise.resolve({ exitCode: 0, stderr: "", stdout: "" }),
    },
    repositoryRoot: "/repo",
    temporaryRoot: "/private",
    toolchain: {
      bunVersion: (): Promise<string> => Promise.resolve("1.3.14"),
      nodeVersion: (): Promise<string> => Promise.resolve("v24.19.0"),
    },
  };
}
test("writes exactly one independently validated outer archive below its private candidate", async () => {
  const ledger = createFileSystemOperationLedger();
  const result = await assembleReleaseSetCandidate(dependencies(ledger), [
    input("config-search"),
    input("bot"),
  ]);
  expect(result.directory.path).toBe(`/private/${releaseSetCandidatePrefix}safe`);
  expect(ledger.mkdtempCalls).toHaveLength(1);
  expect(ledger.writes).toHaveLength(1);
  expect(ledger.removals).toEqual([]);
});
test("rejects an escaped private candidate directory before writing", async () => {
  const ledger = createFileSystemOperationLedger();
  await expect(
    assembleReleaseSetCandidate(dependencies(ledger, "/escape"), [input("bot"), input("config-search")]),
  ).rejects.toThrow("escapes private root");
  expect(ledger.writes).toEqual([]);
  expect(ledger.removals).toEqual([]);
});
test("cleans only its private candidate when writing the outer archive fails", async () => {
  const ledger = createFileSystemOperationLedger();
  await expect(
    assembleReleaseSetCandidate(dependencies(ledger, undefined, true), [
      input("bot"),
      input("config-search"),
    ]),
  ).rejects.toThrow("write failed");
  expect(ledger.writes).toHaveLength(1);
  expect(ledger.removals).toEqual([`/private/${releaseSetCandidatePrefix}safe`]);
});

test("fails closed when a failed write cannot remove its own private candidate", async () => {
  const ledger = createFileSystemOperationLedger();
  const current = dependencies(ledger, undefined, true);
  current.fileSystem.removePrivateDirectory = (): Promise<void> => Promise.reject(new Error("remove failed"));
  await expect(assembleReleaseSetCandidate(current, [input("bot"), input("config-search")])).rejects.toThrow(
    "release-set private candidate cleanup failed",
  );
  expect(ledger.writes).toHaveLength(1);
  expect(ledger.removals).toEqual([]);
});

test("rejects a caller manifest that diverges from its authenticated inner archive before private I/O", async () => {
  const ledger = createFileSystemOperationLedger();
  const bot = input("bot");
  const divergentBot = {
    ...bot,
    innerManifest: { ...bot.innerManifest, commit: "c".repeat(40) },
  };
  await expect(
    assembleReleaseSetCandidate(dependencies(ledger), [divergentBot, input("config-search")]),
  ).rejects.toThrow("release-set authenticated manifest mismatch");
  expect(ledger.mkdtempCalls).toEqual([]);
  expect(ledger.writes).toEqual([]);
  expect(ledger.removals).toEqual([]);
});

test("rejects accessor-backed release-set inputs before reading their mutable values", async () => {
  const ledger = createFileSystemOperationLedger();
  const bot = input("bot");
  let wasAccessorRead = false;
  const accessorBackedBot = {
    application: bot.application,
    innerManifest: bot.innerManifest,
    sidecarBytes: bot.sidecarBytes,
    get zipBytes(): Uint8Array {
      wasAccessorRead = true;
      return bot.zipBytes;
    },
  };
  await expect(
    assembleReleaseSetCandidate(dependencies(ledger), [accessorBackedBot, input("config-search")]),
  ).rejects.toThrow(TypeError);
  expect(wasAccessorRead).toBe(false);
  expect(ledger.mkdtempCalls).toEqual([]);
  expect(ledger.writes).toEqual([]);
  expect(ledger.removals).toEqual([]);
});

test("rejects malformed own-data input records before private I/O", async () => {
  const bot = input("bot");
  const { zipBytes, ...missingZipBytes } = bot;
  for (const malformed of [
    undefined,
    { ...bot, application: "invalid" },
    missingZipBytes,
    { ...missingZipBytes, unrelated: zipBytes },
  ]) {
    const ledger = createFileSystemOperationLedger();
    await expect(
      Reflect.apply(assembleReleaseSetCandidate, undefined, [
        dependencies(ledger),
        [malformed, input("config-search")],
      ]),
    ).rejects.toThrow(TypeError);
    expect(ledger.mkdtempCalls).toEqual([]);
    expect(ledger.writes).toEqual([]);
    expect(ledger.removals).toEqual([]);
  }
});

test("rejects source byte mutation that occurs after verification begins and before private I/O", async () => {
  const ledger = createFileSystemOperationLedger();
  const bot = input("bot");
  const pending = assembleReleaseSetCandidate(dependencies(ledger), [bot, input("config-search")]);
  bot.zipBytes.fill(0);
  await expect(pending).rejects.toThrow(TypeError);
  expect(ledger.mkdtempCalls).toEqual([]);
  expect(ledger.writes).toEqual([]);
  expect(ledger.removals).toEqual([]);
});
