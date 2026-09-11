import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "vitest";

import { canonicalJson, formatSha256Sidecar, sha256Hex, type ReleaseManifestV1 } from "./release-contract";
import {
  runReleaseVerifyCli,
  verifyPublishedReleaseSet,
  type ReleaseArtifactReadPort,
} from "./release-artifact-verifier";
import {
  deriveReleaseSetDestination,
  releaseSetArchiveBasename,
  type ReleaseSetInput,
} from "./release-set-contract";
import { encodeReleaseSetZip } from "./release-set-zip";
import { publishReleaseSet, type ReleaseSetPublicationDependencies } from "./release-set-publication";
import { verifyReleaseSetArchive } from "./release-set-verifier";
import { runReleaseVerifyEntrypoint } from "./verify";
import { encodeStoreZip } from "./zip-store-encoder";

const text = new TextEncoder();
const disk = Object.freeze({ lstat, mkdir, mkdtemp, readFile, remove: rm, symlink, writeFile });

function input(app: "bot" | "config-search", commit = "a".repeat(40)): ReleaseSetInput {
  const readme = text.encode(app);
  const executable = text.encode(`${app}-binary`);
  const innerManifest: ReleaseManifestV1 = {
    app,
    commit,
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

function offsets(bytes: Uint8Array): readonly number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const result: number[] = [];
  let offset = view.getUint32(bytes.length - 6, true);
  for (let index = 0; index < 5; index += 1) {
    result.push(offset);
    offset += 46 + view.getUint16(offset + 28, true);
  }
  return result;
}

function mutate(bytes: Uint8Array, change: (view: DataView, central: readonly number[]) => void): Uint8Array {
  const result = new Uint8Array(bytes);
  change(new DataView(result.buffer), offsets(result));
  return result;
}

function localOffset(bytes: Uint8Array, central: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(central + 42, true);
}

function crc32(bytes: Uint8Array): number {
  let value = 0xff_ff_ff_ff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xed_b8_83_20 : 0);
  }
  return (value ^ 0xff_ff_ff_ff) >>> 0;
}

function replaceManifest(bytes: Uint8Array, manifestBytes: Uint8Array): Uint8Array {
  const central = offsets(bytes)[4];
  if (central === undefined) throw new Error("missing outer manifest entry");
  const local = localOffset(bytes, central);
  const original = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const payloadOffset = local + 30 + original.getUint16(local + 26, true);
  const payloadLength = original.getUint32(central + 24, true);
  const difference = manifestBytes.length - payloadLength;
  const result = new Uint8Array(bytes.length + difference);
  result.set(bytes.slice(0, payloadOffset));
  result.set(manifestBytes, payloadOffset);
  result.set(bytes.slice(payloadOffset + payloadLength), payloadOffset + manifestBytes.length);
  const view = new DataView(result.buffer);
  const checksum = crc32(manifestBytes);
  view.setUint32(local + 14, checksum, true);
  view.setUint32(local + 18, manifestBytes.length, true);
  view.setUint32(local + 22, manifestBytes.length, true);
  const shiftedCentral = central + difference;
  view.setUint32(shiftedCentral + 16, checksum, true);
  view.setUint32(shiftedCentral + 20, manifestBytes.length, true);
  view.setUint32(shiftedCentral + 24, manifestBytes.length, true);
  view.setUint32(result.byteLength - 6, original.getUint32(bytes.byteLength - 6, true) + difference, true);
  return result;
}

function withGapBeforeCentralDirectory(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const central = view.getUint32(bytes.byteLength - 6, true);
  const result = new Uint8Array(bytes.byteLength + 1);
  result.set(bytes.slice(0, central));
  result.set(bytes.slice(central), central + 1);
  new DataView(result.buffer).setUint32(result.byteLength - 6, central + 1, true);
  return result;
}

function readPort(): ReleaseArtifactReadPort & { readonly reads: () => number } {
  let reads = 0;
  return Object.freeze({
    lstat: async (artifactPath: string) => {
      const metadata = await disk.lstat(artifactPath);
      return Object.freeze({
        isRegularFile: (): boolean => metadata.isFile(),
        isSymbolicLink: (): boolean => metadata.isSymbolicLink(),
      });
    },
    readFile: async (artifactPath: string) => {
      reads += 1;
      return new Uint8Array(await disk.readFile(artifactPath));
    },
    reads: (): number => reads,
  });
}

test("verifies a real outer archive through the public verifier, CLI, and entrypoint", async () => {
  const root = await disk.mkdtemp(path.join(tmpdir(), "mm-release-set-archive-e2e-"));
  const publicationRoot = path.join(root, "publication");
  const destination = deriveReleaseSetDestination(publicationRoot);
  const current = encodeReleaseSetZip([input("bot"), input("config-search")]);
  try {
    await disk.mkdir(path.dirname(destination), { recursive: true });
    await disk.writeFile(destination, current.zipBytes);
    const fileSystem = readPort();
    expect(await verifyPublishedReleaseSet({ fileSystem, repositoryRoot: publicationRoot })).toEqual(
      current.manifest,
    );
    const stderr: string[] = [];
    const output = {
      writeStderr: (line: string): void => {
        stderr.push(line);
      },
      writeStdout: (): void => undefined,
    };
    expect(await runReleaseVerifyCli([], { fileSystem, repositoryRoot: publicationRoot }, output)).toBe(0);
    const exitCodeTarget: { exitCode: number | undefined } = { exitCode: undefined };
    expect(
      await runReleaseVerifyEntrypoint({
        exitCodeTarget,
        isMain: true,
        runCommand: (): Promise<0 | 1 | 2> =>
          runReleaseVerifyCli([], { fileSystem, repositoryRoot: publicationRoot }, output),
      }),
    ).toBe(0);
    expect(exitCodeTarget.exitCode).toBe(0);
    expect(stderr).toEqual([]);
    const destinationBytes = new Uint8Array(await disk.readFile(destination));
    expect(await verifyReleaseSetArchive({ zipBytes: destinationBytes })).toEqual({
      manifest: current.manifest,
      verified: true,
      zipBytes: current.zipBytes,
    });
  } finally {
    await disk.remove(root, { force: true, recursive: true });
  }
});

test("fails closed for adversarial outer ZIP mutations across public and archive boundaries", async () => {
  const current = encodeReleaseSetZip([input("bot"), input("config-search")]);
  const first = offsets(current.zipBytes)[0];
  if (first === undefined) throw new Error("missing first outer entry");
  const local = localOffset(current.zipBytes, first);
  const eocd = current.zipBytes.length - 22;
  const alteredManifest = { ...current.manifest, commit: "c".repeat(40) };
  const badSidecar = input("bot");
  const corruptSidecar = {
    ...badSidecar,
    sidecarBytes: text.encode(
      formatSha256Sidecar("f".repeat(64), "mm-crypto-bot-bot-0.1.0-bun-linux-x64.zip"),
    ),
  };
  const reversedManifest = { ...current.manifest, applications: current.manifest.applications.toReversed() };
  const broken = [
    mutate(current.zipBytes, (view) => {
      view.setUint16(local + 10, 0, true);
    }),
    mutate(current.zipBytes, (view) => {
      view.setUint16(first + 12, 0, true);
    }),
    mutate(current.zipBytes, (view) => {
      view.setUint32(first + 42, 1, true);
    }),
    mutate(current.zipBytes, (view) => {
      view.setUint32(eocd + 16, current.zipBytes.length, true);
    }),
    mutate(current.zipBytes, (view) => {
      view.setUint8(local + 30 + view.getUint16(local + 26, true), 0);
    }),
    mutate(current.zipBytes, (view) => {
      view.setUint8(first + 46 + 5, "x".codePointAt(0) ?? 0);
    }),
    replaceManifest(current.zipBytes, text.encode(canonicalJson(alteredManifest))),
    replaceManifest(current.zipBytes, text.encode(canonicalJson(reversedManifest))),
    encodeReleaseSetZip([corruptSidecar, input("config-search")]).zipBytes,
  ];
  for (const zipBytes of broken)
    await expect(verifyReleaseSetArchive({ zipBytes })).rejects.toThrow("release-set archive is invalid");
});

test("redacts missing, directory, symlink, nonregular, and malformed public release-set targets without unsafe reads", async () => {
  const root = await disk.mkdtemp(path.join(tmpdir(), "mm-release-set-archive-e2e-"));
  const publicationRoot = path.join(root, "publication");
  const destination = deriveReleaseSetDestination(publicationRoot);
  const fileSystem = readPort();
  const output: string[] = [];
  try {
    await disk.mkdir(path.dirname(destination), { recursive: true });
    const expectRedactedFailure = async (): Promise<void> => {
      await expect(
        verifyPublishedReleaseSet({ fileSystem, repositoryRoot: publicationRoot }),
      ).rejects.toThrow("release set archive is invalid");
      expect(
        await runReleaseVerifyCli(
          [],
          { fileSystem, repositoryRoot: publicationRoot },
          {
            writeStderr: (line: string): void => {
              output.push(line);
            },
            writeStdout: (): void => undefined,
          },
        ),
      ).toBe(1);
    };
    await expectRedactedFailure();
    expect(fileSystem.reads()).toBe(0);
    await disk.mkdir(destination);
    const beforeDirectory = fileSystem.reads();
    await expectRedactedFailure();
    expect(fileSystem.reads()).toBe(beforeDirectory);
    await disk.remove(destination, { recursive: true });
    await disk.symlink(path.join(root, "outside"), destination);
    const beforeSymlink = fileSystem.reads();
    await expectRedactedFailure();
    expect(fileSystem.reads()).toBe(beforeSymlink);
    await disk.remove(destination);
    await disk.writeFile(destination, new Uint8Array([0]));
    await expectRedactedFailure();
    expect(output).toEqual([
      "release verification failed: release set archive is invalid\n",
      "release verification failed: release set archive is invalid\n",
      "release verification failed: release set archive is invalid\n",
      "release verification failed: release set archive is invalid\n",
    ]);
  } finally {
    await disk.remove(root, { force: true, recursive: true });
  }
});

test("fails closed when an already verified public archive is replaced with malformed bytes", async () => {
  const root = await disk.mkdtemp(path.join(tmpdir(), "mm-release-set-archive-e2e-"));
  const publicationRoot = path.join(root, "publication");
  const destination = deriveReleaseSetDestination(publicationRoot);
  const current = encodeReleaseSetZip([input("bot"), input("config-search")]);
  try {
    await disk.mkdir(path.dirname(destination), { recursive: true });
    await disk.writeFile(destination, current.zipBytes);
    await expect(
      verifyPublishedReleaseSet({ fileSystem: readPort(), repositoryRoot: publicationRoot }),
    ).resolves.toEqual(current.manifest);
    const malformed = mutate(current.zipBytes, (view) => {
      view.setUint32(current.zipBytes.length - 22, 0, true);
    });
    await disk.writeFile(destination, malformed);
    await expect(
      verifyPublishedReleaseSet({ fileSystem: readPort(), repositoryRoot: publicationRoot }),
    ).rejects.toThrow("release set archive is invalid");
    await disk.writeFile(destination, current.zipBytes);
    expect(
      await verifyPublishedReleaseSet({ fileSystem: readPort(), repositoryRoot: publicationRoot }),
    ).toEqual(current.manifest);
    expect(path.basename(destination)).toBe(releaseSetArchiveBasename);
  } finally {
    await disk.remove(root, { force: true, recursive: true });
  }
});

test("rejects invalid outer timestamps, manifests, DOS epochs, and CLI arguments", async () => {
  const current = encodeReleaseSetZip([input("bot"), input("config-search")]);
  const timestampMismatch = mutate(current.zipBytes, (view, central) => {
    for (const offset of central) {
      view.setUint16(offset + 12, 0, true);
      view.setUint16(localOffset(current.zipBytes, offset) + 10, 0, true);
    }
  });
  const invalidManifests = [
    [],
    { ...current.manifest, target: { ...current.manifest.target, arch: "arm" } },
    { ...current.manifest, ignored: 0 },
    {
      ...current.manifest,
      applications: current.manifest.applications.map((record, index) =>
        index === 0 ? { ...record, zip: { ...record.zip, sha256: "a".repeat(64) } } : record,
      ),
    },
    {
      ...current.manifest,
      applications: current.manifest.applications.map((record, index) =>
        index === 0
          ? { ...record, zip: { ...record.zip, sha256: `g${record.zip.sha256.slice(1)}` } }
          : record,
      ),
    },
  ];
  for (const zipBytes of [
    timestampMismatch,
    mutate(current.zipBytes, (view, central) => {
      const first = central[0];
      if (first === undefined) throw new Error("missing first outer entry");
      const local = localOffset(current.zipBytes, first);
      view.setUint8(first + 46 + 5, "x".codePointAt(0) ?? 0);
      view.setUint8(local + 30 + 5, "x".codePointAt(0) ?? 0);
    }),
    replaceManifest(current.zipBytes, text.encode(` ${canonicalJson(current.manifest)}`)),
    withGapBeforeCentralDirectory(current.zipBytes),
    mutate(current.zipBytes, (view, central) => {
      const first = central[0];
      if (first === undefined) throw new Error("missing first outer entry");
      view.setUint16(first + 28, 0xff_ff, true);
    }),
    ...invalidManifests.map((manifest) =>
      replaceManifest(current.zipBytes, text.encode(canonicalJson(manifest))),
    ),
  ]) {
    await expect(verifyReleaseSetArchive({ zipBytes })).rejects.toThrow("release-set archive is invalid");
  }
  await expect(Reflect.apply(verifyReleaseSetArchive, undefined, [{ zipBytes: [] }])).rejects.toThrow(
    "release-set archive is invalid",
  );
  const oldBot = { ...input("bot"), innerManifest: { ...input("bot").innerManifest, sourceDateEpoch: 1 } };
  const oldSearch = {
    ...input("config-search"),
    innerManifest: { ...input("config-search").innerManifest, sourceDateEpoch: 1 },
  };
  expect(() => encodeReleaseSetZip([oldBot, oldSearch])).toThrow("outside ZIP DOS range");
  const output: string[] = [];
  expect(
    await runReleaseVerifyCli(
      ["unexpected"],
      { fileSystem: readPort(), repositoryRoot: "/not-used" },
      {
        writeStderr: (line): void => {
          output.push(line);
        },
        writeStdout: (): void => undefined,
      },
    ),
  ).toBe(2);
  expect(output).toEqual(["release verification accepts no arguments\n"]);
});

test("rejects missing and hostile publication inputs without filesystem or public-link activity", async () => {
  let calls = 0;
  const dependencies: ReleaseSetPublicationDependencies = {
    privateCandidateFileSystem: {
      lstat: (): Promise<{
        readonly isRegularFile: () => boolean;
        readonly isSymbolicLink: () => boolean;
      }> => {
        calls += 1;
        return Promise.resolve({ isRegularFile: (): boolean => true, isSymbolicLink: (): boolean => false });
      },
      readFile: (): Promise<Uint8Array> => Promise.resolve(new Uint8Array()),
      removePrivateDirectory: (): Promise<void> => Promise.resolve(),
    },
    publicationFileSystem: { link: (): Promise<void> => Promise.resolve() },
  };
  for (const input of [
    undefined,
    1,
    {},
    { candidate: { archivePath: "archive" }, privateRoot: "/private", publicationRoot: "/public" },
    { candidate: { archivePath: 1 }, privateRoot: "/private", publicationRoot: "/public" },
    {
      candidate: { archivePath: "archive", basename: releaseSetArchiveBasename },
      privateRoot: "/private",
      publicationRoot: "/public",
    },
    new Proxy(
      {},
      {
        getOwnPropertyDescriptor: (): never => {
          throw new Error("hostile descriptor");
        },
      },
    ),
  ]) {
    expect(await Reflect.apply(publishReleaseSet, undefined, [input, dependencies])).toEqual({
      kind: "publication-failed",
    });
  }
  expect(calls).toBe(0);
});
