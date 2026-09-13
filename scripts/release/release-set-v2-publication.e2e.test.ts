import { chmod, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "vitest";

import {
  canonicalJson,
  formatSha256Sidecar,
  sha256Hex,
  type ReleaseManifest,
  type ReleaseManifestV1,
  type ReleaseManifestV2,
} from "./release-contract";
import { releaseSetManifestGeneration } from "./release-set-contract";
import { assertReproducibleReleaseSet } from "./release-set-reproducibility";
import { verifyReleaseSetArchive } from "./release-set-verifier";
import type { ReleaseDependencies, ReleaseFileSystemPort } from "./release-ports";
import type { ReleaseSetPublicationDependencies } from "./release-set-publication";
import { parseStoreZip } from "./zip-store";
import { encodeStoreZip } from "./zip-store-encoder";

const text = new TextEncoder();
const epoch = 1_788_199_914;
const localSignature = 0x04_03_4b_50;
const centralSignature = 0x02_01_4b_50;
const endSignature = 0x06_05_4b_50;
const disk = Object.freeze({ chmod, lstat, mkdir, mkdtemp, readFile, remove: rm, writeFile });

interface InnerInput {
  readonly application: "bot" | "config-search";
  readonly manifest: ReleaseManifest;
  readonly sidecarBytes: Uint8Array;
  readonly zipBytes: Uint8Array;
}

function input(app: InnerInput["application"], generation: "v1" | "v2"): InnerInput {
  const readme = text.encode(app);
  const executable = text.encode(`${app}-binary`);
  const base = {
    app,
    commit: "a".repeat(40),
    configuration: {
      embedded: false as const,
      external: true as const,
      runtimeRootEnvironment: "MM_CRYPTO_BOT_RUNTIME_ROOT" as const,
    },
    lockfileSha256: "b".repeat(64),
    payloads: [
      { bytes: readme.length, mode: "0644" as const, path: "README.md" as const, sha256: sha256Hex(readme) },
      {
        bytes: executable.length,
        mode: "0755" as const,
        path: `bin/mm-crypto-bot-${app}` as const,
        sha256: sha256Hex(executable),
      },
    ],
    sourceDateEpoch: epoch,
    target: { arch: "x64" as const, bunTarget: "bun-linux-x64" as const, os: "linux" as const },
    version: "0.1.0" as const,
  };
  const manifest: ReleaseManifest =
    generation === "v1"
      ? ({
          ...base,
          schema: "mm-crypto-bot.release-manifest/v1",
          toolchain: { bun: "1.3.14", nodeMetadata: "24.19.0" },
        } satisfies ReleaseManifestV1)
      : ({
          ...base,
          schema: "mm-crypto-bot.release-manifest/v2",
          toolchain: { bun: "1.4.2", nodeMetadata: "24.21.0" },
        } satisfies ReleaseManifestV2);
  const zipBytes = encodeStoreZip(
    [
      { bytes: readme, mode: 0o644, path: "README.md" },
      { bytes: executable, mode: 0o755, path: `bin/mm-crypto-bot-${app}` },
      { bytes: text.encode(canonicalJson(manifest)), mode: 0o644, path: "manifest.json" },
    ],
    epoch,
  );
  return Object.freeze({
    application: app,
    manifest,
    sidecarBytes: sidecar(zipBytes, app),
    zipBytes,
  });
}

function archive(outerGeneration: "v1" | "v2" | "v3", innerGeneration: "v1" | "v2"): Uint8Array {
  const inputs = [input("bot", innerGeneration), input("config-search", innerGeneration)] as const;
  const first = inputs[0].manifest;
  const apps = [
    {
      app: inputs[0].application,
      sidecar: descriptor(
        "apps/bot/mm-crypto-bot-bot-0.1.0-bun-linux-x64.zip.sha256",
        inputs[0].sidecarBytes,
      ),
      zip: descriptor("apps/bot/mm-crypto-bot-bot-0.1.0-bun-linux-x64.zip", inputs[0].zipBytes),
    },
    {
      app: inputs[1].application,
      sidecar: descriptor(
        "apps/config-search/mm-crypto-bot-config-search-0.1.0-bun-linux-x64.zip.sha256",
        inputs[1].sidecarBytes,
      ),
      zip: descriptor(
        "apps/config-search/mm-crypto-bot-config-search-0.1.0-bun-linux-x64.zip",
        inputs[1].zipBytes,
      ),
    },
  ] as const;
  const manifest = {
    applications: apps,
    commit: first.commit,
    lockfileSha256: first.lockfileSha256,
    schema: `mm-crypto-bot.release-set-manifest/${outerGeneration}`,
    sourceDateEpoch: first.sourceDateEpoch,
    target: first.target,
    toolchain:
      outerGeneration === "v1"
        ? { bun: "1.3.14", nodeMetadata: "24.19.0" }
        : { bun: "1.4.2", nodeMetadata: "24.21.0" },
    version: "0.1.0",
  };
  return storeZip(
    [
      { bytes: inputs[0].zipBytes, path: manifest.applications[0].zip.path },
      { bytes: inputs[0].sidecarBytes, path: manifest.applications[0].sidecar.path },
      { bytes: inputs[1].zipBytes, path: manifest.applications[1].zip.path },
      { bytes: inputs[1].sidecarBytes, path: manifest.applications[1].sidecar.path },
      { bytes: text.encode(canonicalJson(manifest)), path: "release-set-manifest.json" },
    ],
    epoch,
  );
}

function descriptor(path: string, bytes: Uint8Array) {
  return Object.freeze({ bytes: bytes.length, path, sha256: sha256Hex(bytes) });
}

function sidecar(zipBytes: Uint8Array, app: InnerInput["application"]): Uint8Array {
  return text.encode(
    formatSha256Sidecar(sha256Hex(zipBytes), `mm-crypto-bot-${app}-0.1.0-bun-linux-x64.zip`),
  );
}

function storeZip(
  entries: readonly { readonly bytes: Uint8Array; readonly path: string }[],
  sourceEpoch: number,
): Uint8Array {
  const ordered = entries.toSorted(
    (left, right) => Number(left.path > right.path) - Number(left.path < right.path),
  );
  const positioned = ordered.map((entry) => ({ entry, name: text.encode(entry.path), offset: 0 }));
  const localSize = ordered.reduce(
    (total, entry) => total + 30 + text.encode(entry.path).length + entry.bytes.length,
    0,
  );
  const size =
    localSize + ordered.reduce((total, entry) => total + 46 + text.encode(entry.path).length, 0) + 22;
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  const stamp = dos(sourceEpoch);
  let offset = 0;
  for (const positionedEntry of positioned) {
    const { entry, name } = positionedEntry;
    positionedEntry.offset = offset;
    header(view, offset, localSignature, stamp, crc32(entry.bytes), entry.bytes.length, name.length);
    bytes.set(name, offset + 30);
    bytes.set(entry.bytes, offset + 30 + name.length);
    offset += 30 + name.length + entry.bytes.length;
  }
  const centralOffset = offset;
  for (const positionedEntry of positioned) {
    const { entry, name } = positionedEntry;
    centralHeader(
      view,
      offset,
      stamp,
      crc32(entry.bytes),
      entry.bytes.length,
      name.length,
      positionedEntry.offset,
    );
    bytes.set(name, offset + 46);
    offset += 46 + name.length;
  }
  view.setUint32(offset, endSignature, true);
  view.setUint16(offset + 8, ordered.length, true);
  view.setUint16(offset + 10, ordered.length, true);
  view.setUint32(offset + 12, offset - centralOffset, true);
  view.setUint32(offset + 16, centralOffset, true);
  return bytes;
}

function header(
  view: DataView,
  offset: number,
  signature: number,
  stamp: { date: number; time: number },
  checksum: number,
  size: number,
  nameLength: number,
): void {
  view.setUint32(offset, signature, true);
  view.setUint16(offset + 4, 20, true);
  view.setUint16(offset + 6, 0, true);
  view.setUint16(offset + 8, 0, true);
  view.setUint16(offset + 10, stamp.time, true);
  view.setUint16(offset + 12, stamp.date, true);
  view.setUint32(offset + 14, checksum, true);
  view.setUint32(offset + 18, size, true);
  view.setUint32(offset + 22, size, true);
  view.setUint16(offset + 26, nameLength, true);
  view.setUint16(offset + 28, 0, true);
}

function centralHeader(
  view: DataView,
  offset: number,
  stamp: { date: number; time: number },
  checksum: number,
  size: number,
  nameLength: number,
  localOffset: number,
): void {
  view.setUint32(offset, centralSignature, true);
  view.setUint16(offset + 4, 0x03_14, true);
  view.setUint16(offset + 6, 20, true);
  view.setUint16(offset + 8, 0, true);
  view.setUint16(offset + 10, 0, true);
  view.setUint16(offset + 12, stamp.time, true);
  view.setUint16(offset + 14, stamp.date, true);
  view.setUint32(offset + 16, checksum, true);
  view.setUint32(offset + 20, size, true);
  view.setUint32(offset + 24, size, true);
  view.setUint16(offset + 28, nameLength, true);
  view.setUint32(offset + 38, (0o10_0644 << 16) >>> 0, true);
  view.setUint32(offset + 42, localOffset, true);
}

function dos(value: number): { date: number; time: number } {
  const instant = new Date((value - (value % 2)) * 1000);
  return {
    date:
      ((instant.getUTCFullYear() - 1980) << 9) | ((instant.getUTCMonth() + 1) << 5) | instant.getUTCDate(),
    time: (instant.getUTCHours() << 11) | (instant.getUTCMinutes() << 5) | (instant.getUTCSeconds() >> 1),
  };
}

function crc32(bytes: Uint8Array): number {
  let result = 0xff_ff_ff_ff;
  for (const byte of bytes) {
    result ^= byte;
    for (let bit = 0; bit < 8; bit += 1) result = (result >>> 1) ^ (result & 1 ? 0xed_b8_83_20 : 0);
  }
  return (result ^ 0xff_ff_ff_ff) >>> 0;
}

test("accepts an authenticated historic V1 set but emits no V1 publication contract", async () => {
  await expect(verifyReleaseSetArchive({ zipBytes: archive("v1", "v1") })).resolves.toMatchObject({
    manifest: { schema: "mm-crypto-bot.release-set-manifest/v1" },
  });
});

test("rejects both cross-generation outer and authenticated-inner pairings before publication", async () => {
  for (const pairing of [
    ["v1", "v2"],
    ["v2", "v1"],
  ] as const)
    await expect(verifyReleaseSetArchive({ zipBytes: archive(pairing[0], pairing[1]) })).rejects.toThrow(
      "release-set archive is invalid",
    );
  expect(() =>
    releaseSetManifestGeneration(
      "mm-crypto-bot.release-set-manifest/v3",
      "mm-crypto-bot.release-manifest/v3",
    ),
  ).toThrow("generation mismatch");
  await expect(verifyReleaseSetArchive({ zipBytes: archive("v3", "v2") })).rejects.toThrow(
    "release-set archive is invalid",
  );
});

test("rejects a real private V1 archive replacement before a second build, smoke, or publication", async () => {
  const root = await disk.mkdtemp(path.join(tmpdir(), "mm-release-set-v2-private-v1-"));
  const repoRoot = path.join(root, "repo");
  const privateRoot = path.join(root, "private");
  const publicRoot = path.join(root, "public");
  const processCalls: string[] = [];
  try {
    await Promise.all([
      disk.mkdir(privateRoot),
      disk.mkdir(publicRoot),
      disk.mkdir(path.join(repoRoot, "apps", "bot", "src"), { recursive: true }),
      disk.mkdir(path.join(repoRoot, "apps", "config-search", "src"), { recursive: true }),
    ]);
    await Promise.all([
      disk.writeFile(
        path.join(repoRoot, "package.json"),
        '{"engines":{"bun":"1.4.2","node":"24.21.0"},"packageManager":"bun@1.4.2"}\n',
      ),
      disk.writeFile(path.join(repoRoot, ".bun-version"), "1.4.2\n"),
      disk.writeFile(path.join(repoRoot, ".nvmrc"), "24.21.0\n"),
      disk.writeFile(path.join(repoRoot, "bun.lock"), "lockfile\n"),
      disk.writeFile(path.join(repoRoot, "apps", "bot", "package.json"), '{"version":"0.1.0"}\n'),
      disk.writeFile(path.join(repoRoot, "apps", "bot", "src", "index.ts"), "entrypoint\n"),
      disk.writeFile(path.join(repoRoot, "apps", "config-search", "package.json"), '{"version":"0.1.0"}\n'),
      disk.writeFile(path.join(repoRoot, "apps", "config-search", "src", "index.ts"), "entrypoint\n"),
    ]);
    const fileSystem = historicReadFileSystem();
    const releaseDependencies: ReleaseDependencies = {
      compiler: {
        compile: async ({ outputPath }): Promise<void> =>
          disk.writeFile(outputPath, text.encode("compiled\n"), { mode: 0o755 }),
      },
      fileSystem,
      git: {
        headCommit: (): Promise<string> => Promise.resolve("a".repeat(40)),
        headCommitEpoch: (): Promise<string> => Promise.resolve("1788199914"),
        porcelainStatus: (): Promise<string> => Promise.resolve(""),
      },
      process: {
        run: (input) => {
          processCalls.push(input.argv.join(" "));
          return Promise.reject(new Error("smoke must not run"));
        },
      },
      repositoryRoot: repoRoot,
      temporaryRoot: privateRoot,
      toolchain: {
        bunVersion: (): Promise<string> => Promise.resolve("1.4.2"),
        nodeVersion: (): Promise<string> => Promise.resolve("v24.21.0"),
      },
    };
    const publicationDependencies: ReleaseSetPublicationDependencies = {
      privateCandidateFileSystem: fileSystem,
      publicationFileSystem: {
        link: (): Promise<void> => Promise.reject(new Error("publication must not run")),
      },
    };
    await expect(
      assertReproducibleReleaseSet({
        publicationDependencies,
        publicationRoot: publicRoot,
        releaseDependencies,
      }),
    ).rejects.toThrow("release-set reproducibility mismatch");
    expect(processCalls).toEqual([]);
  } finally {
    await disk.remove(root, { force: true, recursive: true });
  }
});

function historicReadFileSystem(): ReleaseFileSystemPort {
  let historic: Uint8Array | undefined;
  return {
    chmod: (filePath, mode) => disk.chmod(filePath, mode),
    inspectPath: async (filePath) => {
      try {
        const status = await disk.lstat(filePath);
        return status.isFile()
          ? "regular-file"
          : status.isDirectory()
            ? "directory"
            : status.isSymbolicLink()
              ? "symbolic-link"
              : "other";
      } catch {
        return "missing";
      }
    },
    lstat: async (filePath) => {
      const status = await disk.lstat(filePath);
      return Object.freeze({
        isRegularFile: (): boolean => status.isFile(),
        isSymbolicLink: (): boolean => status.isSymbolicLink(),
      });
    },
    mkdir: (directory, mode) => disk.mkdir(directory, { mode }),
    mkdtemp: async ({ parentDirectory, prefix }) =>
      Object.freeze({ path: await disk.mkdtemp(path.join(parentDirectory, prefix)) }),
    readFile: async (filePath) => {
      if (filePath.endsWith(".sha256")) {
        const archiveBytes = await disk.readFile(filePath.slice(0, -".sha256".length));
        historic ??= historicArchive(new Uint8Array(archiveBytes));
        return text.encode(
          formatSha256Sidecar(sha256Hex(historic), path.basename(filePath).slice(0, -".sha256".length)),
        );
      }
      const bytes = new Uint8Array(await disk.readFile(filePath));
      if (!filePath.endsWith(".zip")) return bytes;
      historic = historicArchive(bytes);
      return historic;
    },
    removeFile: (filePath) => disk.remove(filePath, { force: false }),
    removePrivateDirectory: ({ path: directory }) =>
      disk.remove(directory, { force: false, recursive: true }),
    writeFile: (filePath, bytes, mode) => disk.writeFile(filePath, bytes, { mode }),
  };
}

function historicArchive(bytes: Uint8Array): Uint8Array {
  const entries = parseStoreZip(bytes).entries;
  const readme = entries.find((entry) => entry.path === "README.md");
  const executable = entries.find((entry) => entry.path === "bin/mm-crypto-bot-bot");
  if (readme === undefined || executable === undefined) throw new Error("candidate layout changed");
  const manifest: ReleaseManifestV1 = {
    app: "bot",
    commit: "a".repeat(40),
    configuration: { embedded: false, external: true, runtimeRootEnvironment: "MM_CRYPTO_BOT_RUNTIME_ROOT" },
    lockfileSha256: "b".repeat(64),
    payloads: [
      { bytes: readme.bytes.length, mode: "0644", path: "README.md", sha256: sha256Hex(readme.bytes) },
      {
        bytes: executable.bytes.length,
        mode: "0755",
        path: "bin/mm-crypto-bot-bot",
        sha256: sha256Hex(executable.bytes),
      },
    ],
    schema: "mm-crypto-bot.release-manifest/v1",
    sourceDateEpoch: epoch,
    target: { arch: "x64", bunTarget: "bun-linux-x64", os: "linux" },
    toolchain: { bun: "1.3.14", nodeMetadata: "24.19.0" },
    version: "0.1.0",
  };
  return encodeStoreZip(
    [
      { bytes: readme.bytes, mode: 0o644, path: "README.md" },
      { bytes: executable.bytes, mode: 0o755, path: "bin/mm-crypto-bot-bot" },
      { bytes: text.encode(canonicalJson(manifest)), mode: 0o644, path: "manifest.json" },
    ],
    epoch,
  );
}
