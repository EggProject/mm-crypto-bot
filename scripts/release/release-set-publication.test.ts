import { expect, test } from "vitest";
import { link as linkFile, lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { canonicalJson, formatSha256Sidecar, sha256Hex, type ReleaseManifestV1 } from "./release-contract";
import {
  releaseSetArchiveBasename,
  releaseSetCandidatePrefix,
  type ReleaseSetInput,
  type ReleaseSetPrivateCandidate,
} from "./release-set-contract";
import { publishReleaseSet } from "./release-set-publication";
import { encodeReleaseSetZip } from "./release-set-zip";
import { nodeReleasePublicationFileSystem } from "./release-ports";
import { encodeStoreZip } from "./zip-store-encoder";

const text = new TextEncoder();
const privateRoot = "/private";
const publicationRoot = "/publication";
const regular = Object.freeze({ isRegularFile: (): boolean => true, isSymbolicLink: (): boolean => false });
const directory = Object.freeze({
  isRegularFile: (): boolean => false,
  isSymbolicLink: (): boolean => false,
});
const symlink = Object.freeze({ isRegularFile: (): boolean => false, isSymbolicLink: (): boolean => true });
const disk = Object.freeze({ lstat, mkdtemp, readFile, removeDirectory: rm, writeFile });

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

const archive = encodeReleaseSetZip([input("bot"), input("config-search")]);

function candidate(
  directoryPath = `${privateRoot}/${releaseSetCandidatePrefix}safe`,
): ReleaseSetPrivateCandidate {
  return Object.freeze({
    archivePath: `${directoryPath}/${releaseSetArchiveBasename}`,
    basename: releaseSetArchiveBasename,
    directory: Object.freeze({ path: directoryPath }),
    manifest: archive.manifest,
  });
}

function dependencies(input: {
  readonly bytes?: Uint8Array;
  readonly cleanupFails?: boolean;
  readonly linkError?: Error;
  readonly status?: typeof regular;
}) {
  const calls: string[] = [];
  return {
    calls,
    dependencies: {
      privateCandidateFileSystem: {
        lstat: (name: string) => {
          calls.push(`lstat:${name}`);
          return Promise.resolve(input.status ?? regular);
        },
        readFile: (name: string) => {
          calls.push(`read:${name}`);
          return Promise.resolve(input.bytes ?? archive.zipBytes);
        },
        removePrivateDirectory: (value: { readonly path: string }) => {
          calls.push(`remove:${value.path}`);
          return input.cleanupFails ? Promise.reject(new Error("private cleanup failed")) : Promise.resolve();
        },
      },
      publicationFileSystem: {
        link: (source: string, destination: string) => {
          calls.push(`link:${source}:${destination}`);
          return input.linkError === undefined ? Promise.resolve() : Promise.reject(input.linkError);
        },
      },
    },
  };
}

function nodeError(code?: string): Error {
  const error = new Error("injected public filesystem failure");
  if (code !== undefined) Object.defineProperty(error, "code", { value: code });
  return error;
}

test("rejects every forged candidate relationship before filesystem or public-link activity", async () => {
  const valid = candidate();
  for (const forged of [
    { ...valid, directory: { path: `/other/${releaseSetCandidatePrefix}safe` } },
    { ...valid, directory: { path: `${privateRoot}/${releaseSetCandidatePrefix}` } },
    { ...valid, basename: "other.zip" },
    { ...valid, archivePath: `${valid.directory.path}/other.zip` },
  ]) {
    const current = dependencies({});
    expect(
      await Reflect.apply(publishReleaseSet, undefined, [
        { candidate: forged, privateRoot, publicationRoot },
        current.dependencies,
      ]),
    ).toEqual({ kind: "publication-failed" });
    expect(current.calls).toEqual([]);
  }
});

test("rejects non-regular private candidates without reading or publishing them", async () => {
  for (const status of [directory, symlink]) {
    const current = dependencies({ status });
    const release = candidate();
    expect(
      await publishReleaseSet({ candidate: release, privateRoot, publicationRoot }, current.dependencies),
    ).toEqual({
      kind: "publication-failed",
    });
    expect(current.calls).toEqual([`lstat:${release.archivePath}`, `remove:${release.directory.path}`]);
  }
});

test("links the verified private archive to the sole destination before private cleanup", async () => {
  const current = dependencies({});
  const release = candidate();
  expect(
    await publishReleaseSet({ candidate: release, privateRoot, publicationRoot }, current.dependencies),
  ).toEqual({
    kind: "published",
  });
  expect(current.calls).toEqual([
    `lstat:${release.archivePath}`,
    `read:${release.archivePath}`,
    `link:${release.archivePath}:/publication/0.1.0/bun-linux-x64/${releaseSetArchiveBasename}`,
    `remove:${release.directory.path}`,
  ]);
});

test("fails closed and cleans only the private candidate when verification rejects its bytes", async () => {
  const current = dependencies({ bytes: new Uint8Array([0]) });
  const release = candidate();
  expect(
    await publishReleaseSet({ candidate: release, privateRoot, publicationRoot }, current.dependencies),
  ).toEqual({
    kind: "publication-failed",
  });
  expect(current.calls).toEqual([
    `lstat:${release.archivePath}`,
    `read:${release.archivePath}`,
    `remove:${release.directory.path}`,
  ]);
});

test("preserves destination sentinels by classifying EEXIST and EXDEV link failures", async () => {
  for (const [error, kind] of [
    [nodeError("EEXIST"), "destination-exists"],
    [nodeError("EXDEV"), "cross-device"],
    [nodeError(), "publication-failed"],
    [nodeError("ENOENT"), "publication-failed"],
  ] as const) {
    const current = dependencies({ linkError: error });
    expect(
      await publishReleaseSet({ candidate: candidate(), privateRoot, publicationRoot }, current.dependencies),
    ).toEqual({ kind });
    expect(current.calls.at(-1)).toBe(`remove:${candidate().directory.path}`);
  }
});

test("reports successful publication when post-link private cleanup fails without touching the destination", async () => {
  const current = dependencies({ cleanupFails: true });
  expect(
    await publishReleaseSet({ candidate: candidate(), privateRoot, publicationRoot }, current.dependencies),
  ).toEqual({
    kind: "published-cleanup-failed",
  });
  expect(current.calls.filter((entry) => entry.startsWith("link:"))).toHaveLength(1);
});

test("retains the original redacted failure when cleanup fails before publication or for an unknown link error", async () => {
  const nonRegular = dependencies({ status: directory, cleanupFails: true });
  expect(
    await publishReleaseSet(
      { candidate: candidate(), privateRoot, publicationRoot },
      nonRegular.dependencies,
    ),
  ).toEqual({
    kind: "publication-failed",
  });
  const foreignError = dependencies({ linkError: nodeError("EIO") });
  expect(
    await publishReleaseSet(
      { candidate: candidate(), privateRoot, publicationRoot },
      foreignError.dependencies,
    ),
  ).toEqual({
    kind: "publication-failed",
  });
});

test("Node/Bun publication adapter creates exactly one hard link and preserves an existing destination", async () => {
  const directoryPath = await disk.mkdtemp(path.join(tmpdir(), "mm-release-set-publication-"));
  const source = path.join(directoryPath, "private-source.zip");
  const destination = path.join(directoryPath, "public-release-set.zip");
  await disk.writeFile(source, new Uint8Array([1, 2, 3]));
  try {
    await nodeReleasePublicationFileSystem.link(source, destination);
    const [sourceStatus, destinationStatus] = await Promise.all([
      disk.lstat(source),
      disk.lstat(destination),
    ]);
    expect(sourceStatus.ino).toBe(destinationStatus.ino);
    expect(new Uint8Array(await disk.readFile(destination))).toEqual(new Uint8Array([1, 2, 3]));
    await expect(nodeReleasePublicationFileSystem.link(source, destination)).rejects.toMatchObject({
      code: "EEXIST",
    });
    expect(new Uint8Array(await disk.readFile(destination))).toEqual(new Uint8Array([1, 2, 3]));
  } finally {
    await disk.removeDirectory(directoryPath, { force: true, recursive: true });
  }
});

test("Node/Bun publication adapter is a frozen create-only native link capability", () => {
  expect(Object.isFrozen(nodeReleasePublicationFileSystem)).toBe(true);
  expect(Object.keys(nodeReleasePublicationFileSystem)).toEqual(["link"]);
  expect(Reflect.get(nodeReleasePublicationFileSystem, "link")).toBe(linkFile);
});
