import { expect, test } from "vitest";
import { canonicalJson, formatSha256Sidecar, sha256Hex, type ReleaseManifestV1 } from "./release-contract";
import { deriveReleaseSetDestination } from "./release-set-contract";
import { runReleaseVerifyCli, verifyPublishedReleaseSet } from "./release-artifact-verifier";
import { encodeReleaseSetZip } from "./release-set-zip";
import { encodeStoreZip } from "./zip-store-encoder";

const root = "/trusted-publication";
const regular = Object.freeze({ isRegularFile: (): boolean => true, isSymbolicLink: (): boolean => false });
const text = new TextEncoder();

function validInput(app: "bot" | "config-search") {
  const readme = text.encode(app);
  const executable = text.encode(`${app}-binary`);
  const innerManifest: ReleaseManifestV1 = {
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
  } as const;
}

const validOuterArchive = encodeReleaseSetZip([validInput("bot"), validInput("config-search")]);

test("uses only the derived outer release-set pathname", async () => {
  const reads: string[] = [];
  await expect(
    verifyPublishedReleaseSet({
      fileSystem: {
        lstat: (name) => {
          reads.push(name);
          return Promise.resolve(regular);
        },
        readFile: (name) => {
          reads.push(name);
          return Promise.resolve(new Uint8Array());
        },
      },
      repositoryRoot: root,
    }),
  ).rejects.toThrow("release set archive is invalid");
  expect(reads).toEqual([deriveReleaseSetDestination(root), deriveReleaseSetDestination(root)]);
});
test("rejects arguments and redacts verification failures", async () => {
  const stderr: string[] = [];
  const output = {
    writeStderr: (line: string): void => {
      stderr.push(line);
    },
    writeStdout: (): void => undefined,
  };
  expect(
    await runReleaseVerifyCli(
      ["bad"],
      {
        fileSystem: {
          lstat: () => Promise.resolve(regular),
          readFile: () => Promise.resolve(new Uint8Array()),
        },
        repositoryRoot: root,
      },
      output,
    ),
  ).toBe(2);
  expect(
    await runReleaseVerifyCli(
      [],
      {
        fileSystem: {
          lstat: () => Promise.reject(new Error("secret")),
          readFile: () => Promise.resolve(new Uint8Array()),
        },
        repositoryRoot: root,
      },
      output,
    ),
  ).toBe(1);
  expect(stderr).toEqual([
    "release verification accepts no arguments\n",
    "release verification failed: release set archive is invalid\n",
  ]);
});

test("returns the verified manifest and CLI success only for a regular outer archive", async () => {
  const output: string[] = [];
  const dependencies = {
    fileSystem: {
      lstat: () => Promise.resolve(regular),
      readFile: () => Promise.resolve(validOuterArchive.zipBytes),
    },
    repositoryRoot: root,
  };
  expect(await verifyPublishedReleaseSet(dependencies)).toEqual(validOuterArchive.manifest);
  expect(
    await runReleaseVerifyCli([], dependencies, {
      writeStderr: (line): void => {
        output.push(line);
      },
      writeStdout: (line): void => {
        output.push(line);
      },
    }),
  ).toBe(0);
  expect(output).toEqual([]);
});

test("redacts directory and symbolic-link publication targets without reading them", async () => {
  for (const status of [
    { isRegularFile: (): boolean => false, isSymbolicLink: (): boolean => false },
    { isRegularFile: (): boolean => false, isSymbolicLink: (): boolean => true },
  ]) {
    let reads = 0;
    await expect(
      verifyPublishedReleaseSet({
        fileSystem: {
          lstat: () => Promise.resolve(status),
          readFile: () => {
            reads += 1;
            return Promise.resolve(new Uint8Array());
          },
        },
        repositoryRoot: root,
      }),
    ).rejects.toThrow("release set archive is invalid");
    expect(reads).toBe(0);
  }
});
