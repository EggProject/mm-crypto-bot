import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "vitest";

import { canonicalJson, formatSha256Sidecar, sha256Hex, type ReleaseManifestV1 } from "./release-contract";
import { runReleaseVerifyCli, verifyPublishedReleaseSet } from "./release-artifact-verifier";
import { deriveReleaseSetDestination, type ReleaseSetInput } from "./release-set-contract";
import { nodeReleasePublicationFileSystem } from "./release-ports";
import { encodeReleaseSetZip } from "./release-set-zip";
import { verifyReleaseSetArchive } from "./release-set-verifier";
import { nodeReleaseArtifactReadPort } from "./verify";
import { encodeStoreZip } from "./zip-store-encoder";

import "./release-artifact-verifier.test";
import "./release-coverage.test";
import "./release-set-assembler.test";
import "./release-set-contract.test";
import "./release-set-publication.test";
import "./release-set-reproducibility.test";
import "./release-set-verifier.test";
import "./release-set-zip.test";
import "./verify.test";

const text = new TextEncoder();
const disk = Object.freeze({
  lstat,
  makeDirectory: mkdir,
  makeTemporaryDirectory: mkdtemp,
  readFile,
  remove: rm,
  writeFile,
});

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
