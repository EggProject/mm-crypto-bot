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
function dependencies(
  writes: string[],
  removals: string[],
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
      mkdtemp: (): Promise<{ readonly path: string }> => Promise.resolve({ path: directory }),
      readFile: (): Promise<Uint8Array> => Promise.resolve(new Uint8Array()),
      removePrivateDirectory: (value): Promise<void> => {
        removals.push(value.path);
        return Promise.resolve();
      },
      removeFile: (): Promise<void> => Promise.resolve(),
      writeFile: (target, bytes): Promise<void> => {
        writes.push(`${target}:${String(bytes.length)}`);
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
  const writes: string[] = [];
  const removals: string[] = [];
  const result = await assembleReleaseSetCandidate(dependencies(writes, removals), [
    input("config-search"),
    input("bot"),
  ]);
  expect(result.directory.path).toBe(`/private/${releaseSetCandidatePrefix}safe`);
  expect(writes).toHaveLength(1);
  expect(removals).toEqual([]);
});
test("rejects an escaped private candidate directory before writing", async () => {
  const writes: string[] = [];
  const removals: string[] = [];
  await expect(
    assembleReleaseSetCandidate(dependencies(writes, removals, "/escape"), [
      input("bot"),
      input("config-search"),
    ]),
  ).rejects.toThrow("escapes private root");
  expect(writes).toEqual([]);
  expect(removals).toEqual([]);
});
test("cleans only its private candidate when writing the outer archive fails", async () => {
  const writes: string[] = [];
  const removals: string[] = [];
  await expect(
    assembleReleaseSetCandidate(dependencies(writes, removals, undefined, true), [
      input("bot"),
      input("config-search"),
    ]),
  ).rejects.toThrow("write failed");
  expect(writes).toHaveLength(1);
  expect(removals).toEqual([`/private/${releaseSetCandidatePrefix}safe`]);
});

test("fails closed when a failed write cannot remove its own private candidate", async () => {
  const writes: string[] = [];
  const removals: string[] = [];
  const current = dependencies(writes, removals, undefined, true);
  current.fileSystem.removePrivateDirectory = (): Promise<void> => Promise.reject(new Error("remove failed"));
  await expect(assembleReleaseSetCandidate(current, [input("bot"), input("config-search")])).rejects.toThrow(
    "release-set private candidate cleanup failed",
  );
  expect(writes).toHaveLength(1);
  expect(removals).toEqual([]);
});
