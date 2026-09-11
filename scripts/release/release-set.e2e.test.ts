import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "vitest";

import { canonicalJson, formatSha256Sidecar, sha256Hex, type ReleaseManifestV1 } from "./release-contract";
import { runReleaseVerifyCli, verifyPublishedReleaseSet } from "./release-artifact-verifier";
import {
  canonicalReleaseSetInputs,
  createReleaseSetManifest,
  deriveReleaseSetDestination,
  type ReleaseSetInput,
} from "./release-set-contract";
import { nodeReleasePublicationFileSystem } from "./release-ports";
import type { ReleaseDependencies, ReleasePrivateDirectory } from "./release-ports";
import { assembleReleaseSetCandidate } from "./release-set-assembler";
import { encodeReleaseSetZip } from "./release-set-zip";
import { verifyReleaseSetArchive } from "./release-set-verifier";
import { nodeReleaseArtifactReadPort } from "./verify";
import { encodeStoreZip } from "./zip-store-encoder";

const text = new TextEncoder();
const disk = Object.freeze({
  lstat,
  makeDirectory: mkdir,
  makeTemporaryDirectory: mkdtemp,
  readFile,
  remove: rm,
  writeFile,
});

function createReleaseSetAssemblyDependencies(directory: string): ReleaseDependencies {
  return {
    compiler: { compile: (): Promise<void> => Promise.resolve() },
    fileSystem: {
      chmod: (): Promise<void> => Promise.resolve(),
      inspectPath: (): Promise<"missing"> => Promise.resolve("missing"),
      lstat: (): Promise<{ readonly isRegularFile: () => boolean; readonly isSymbolicLink: () => boolean }> =>
        Promise.resolve({ isRegularFile: (): boolean => true, isSymbolicLink: (): boolean => false }),
      mkdir: (): Promise<void> => Promise.resolve(),
      mkdtemp: (): Promise<ReleasePrivateDirectory> => Promise.resolve({ path: directory }),
      readFile: (): Promise<Uint8Array> => Promise.resolve(new Uint8Array()),
      removeFile: (): Promise<void> => Promise.resolve(),
      removePrivateDirectory: (): Promise<void> => Promise.resolve(),
      writeFile: (): Promise<void> => Promise.resolve(),
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
      nodeVersion: (): Promise<string> => Promise.resolve("24.19.0"),
    },
  };
}

function input(app: "bot" | "config-search"): ReleaseSetInput {
  const readme = text.encode(app);
  const executable = text.encode(`${app}-binary`);
  const innerManifest: ReleaseManifestV1 = {
    app: app,
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
      { bytes: text.encode(canonicalJson(innerManifest)), mode: 0o644, path: "manifest.json" },
    ],
    innerManifest.sourceDateEpoch,
  );
  return {
    application: app,
    innerManifest,
    sidecarBytes: text.encode(
      formatSha256Sidecar(sha256Hex(zipBytes), `mm-crypto-bot-${app}-0.1.0-bun-linux-x64.zip`),
    ),
    zipBytes,
  };
}

test("publishes one verified release set by hard link, survives private deletion, and exposes only the outer public verifier", async () => {
  const temporaryRoot = await disk.makeTemporaryDirectory(path.join(tmpdir(), "mm-release-set-e2e-"));
  const privateCandidate = path.join(temporaryRoot, "release-set-candidate-e2e");
  const publicRoot = path.join(temporaryRoot, "public");
  const archive = encodeReleaseSetZip([input("bot"), input("config-search")]);
  const source = path.join(privateCandidate, "release-set.zip");
  const destination = deriveReleaseSetDestination(publicRoot);
  await disk.makeDirectory(privateCandidate, { recursive: true });
  await disk.makeDirectory(path.dirname(destination), { recursive: true });
  await disk.writeFile(source, archive.zipBytes);
  try {
    await nodeReleasePublicationFileSystem.link(source, destination);
    const [sourceStatus, destinationStatus] = await Promise.all([
      disk.lstat(source),
      disk.lstat(destination),
    ]);
    expect(sourceStatus.ino).toBe(destinationStatus.ino);
    expect(new Uint8Array(await disk.readFile(destination))).toEqual(archive.zipBytes);

    expect(
      await verifyReleaseSetArchive({ zipBytes: await nodeReleaseArtifactReadPort.readFile(destination) }),
    ).toEqual({
      manifest: archive.manifest,
      verified: true,
      zipBytes: archive.zipBytes,
    });
    expect(
      await verifyPublishedReleaseSet({
        fileSystem: nodeReleaseArtifactReadPort,
        repositoryRoot: publicRoot,
      }),
    ).toEqual(archive.manifest);

    const stderr: string[] = [];
    expect(
      await runReleaseVerifyCli(
        [],
        { fileSystem: nodeReleaseArtifactReadPort, repositoryRoot: publicRoot },
        {
          writeStderr: (line): void => {
            stderr.push(line);
          },
          writeStdout: (): void => undefined,
        },
      ),
    ).toBe(0);
    expect(stderr).toEqual([]);

    await disk.remove(privateCandidate, { force: true, recursive: true });
    expect(new Uint8Array(await disk.readFile(destination))).toEqual(archive.zipBytes);

    const secondCandidate = path.join(temporaryRoot, "release-set-candidate-second");
    const secondSource = path.join(secondCandidate, "release-set.zip");
    await disk.makeDirectory(secondCandidate, { recursive: true });
    await disk.writeFile(secondSource, new Uint8Array([9]));
    await expect(nodeReleasePublicationFileSystem.link(secondSource, destination)).rejects.toMatchObject({
      code: "EEXIST",
    });
    expect(new Uint8Array(await disk.readFile(destination))).toEqual(archive.zipBytes);

    await disk.remove(destination, { force: true });
    expect(
      await runReleaseVerifyCli(
        [],
        { fileSystem: nodeReleaseArtifactReadPort, repositoryRoot: publicRoot },
        {
          writeStderr: (line): void => {
            stderr.push(line);
          },
          writeStdout: (): void => undefined,
        },
      ),
    ).toBe(1);
    expect(stderr).toEqual(["release verification failed: release set archive is invalid\n"]);
  } finally {
    await disk.remove(temporaryRoot, { force: true, recursive: true });
  }
});

test("rejects invalid release-set inputs and identity drift before archive publication", () => {
  const bot = input("bot");
  const search = input("config-search");
  expect(canonicalReleaseSetInputs([search, bot])).toEqual([bot, search]);
  for (const invalid of [
    [bot],
    [bot, bot],
    [bot, { ...search, sidecarBytes: [] }],
    [bot, { ...search, innerManifest: { ...search.innerManifest, app: "bot" } }],
  ]) {
    expect(() => {
      Reflect.apply(createReleaseSetManifest, undefined, [invalid]);
    }).toThrow();
  }
  for (const changed of [
    { commit: "c".repeat(40) },
    { lockfileSha256: "d".repeat(64) },
    { sourceDateEpoch: 1_788_199_916 },
    { version: "0.1.1" },
    { target: { arch: "x64", bunTarget: "wrong", os: "linux" } },
    { toolchain: { bun: "1.3.15", nodeMetadata: "24.19.0" } },
  ] as const) {
    expect(() => {
      Reflect.apply(createReleaseSetManifest, undefined, [
        [bot, { ...search, innerManifest: { ...search.innerManifest, ...changed } }],
      ]);
    }).toThrow("release-set identity mismatch");
  }
});

test("rejects every malformed private outer-candidate directory before writing", async () => {
  for (const directory of ["/escape", "/private/not-a-candidate", "/private/release-set-candidate-"]) {
    await expect(
      assembleReleaseSetCandidate(createReleaseSetAssemblyDependencies(directory), [
        input("bot"),
        input("config-search"),
      ]),
    ).rejects.toThrow("release-set candidate directory escapes private root");
  }
});
