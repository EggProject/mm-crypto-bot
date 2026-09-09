import type { ReleaseManifestV1 } from "./release-contract";
import { canonicalJson, formatSha256Sidecar, sha256Hex } from "./release-contract";
import {
  runReleaseVerifyCli,
  verifyAllReleaseArchives,
  verifyExistingReleaseArchive,
  type ReleaseArtifactReadPort,
  type ReleaseVerificationOutput,
} from "./release-artifact-verifier";
import { encodeStoreZip } from "./zip-store";

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
  if (!isRecord(candidate)) return false;
  return (
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
const releaseRepoRoot = "/release-repository";
const epoch = 1_788_199_915;

interface ArtifactStatus {
  readonly isRegularFile: () => boolean;
  readonly isSymbolicLink: () => boolean;
}

const regularFile: ArtifactStatus = Object.freeze({ isRegularFile: () => true, isSymbolicLink: () => false });
const directory: ArtifactStatus = Object.freeze({ isRegularFile: () => false, isSymbolicLink: () => false });
const symbolicLink: ArtifactStatus = Object.freeze({
  isRegularFile: () => false,
  isSymbolicLink: () => true,
});

class MissingArtifactError extends Error {
  readonly code = "ENOENT";
}

type FileKind = "directory" | "other" | "regular" | "symbolic-link";
type PortFailure = "non-error" | Error;

class ArtifactFileSystem implements ReleaseArtifactReadPort {
  #files = new Map<string, Uint8Array>();
  #kinds = new Map<string, FileKind>();
  #lstatFailures = new Map<string, PortFailure>();
  #readFailures = new Map<string, PortFailure>();
  #statusFailures = new Map<string, Error>();
  readonly lstatPaths: string[] = [];
  readonly readPaths: string[] = [];

  addFile(path: string, bytes: Uint8Array): void {
    this.#files.set(path, new Uint8Array(bytes));
    this.#kinds.set(path, "regular");
  }

  failLstat(path: string, failure: PortFailure): void {
    this.#lstatFailures.set(path, failure);
  }

  failRead(path: string, failure: PortFailure): void {
    this.#readFailures.set(path, failure);
  }

  failStatus(path: string, failure: Error): void {
    this.#statusFailures.set(path, failure);
  }

  lstat(path: string): Promise<ArtifactStatus> {
    this.lstatPaths.push(path);
    const failure = this.#lstatFailures.get(path);
    this.#lstatFailures.delete(path);
    if (failure === "non-error") return rejectWithNativeNonError();
    if (failure !== undefined) throw failure;
    const statusFailure = this.#statusFailures.get(path);
    this.#statusFailures.delete(path);
    if (statusFailure !== undefined) return Promise.resolve(statusThatThrows(statusFailure));
    const kind = this.#kinds.get(path);
    if (kind === undefined) return Promise.reject(new MissingArtifactError("absent"));
    if (kind === "regular") return Promise.resolve(regularFile);
    if (kind === "directory") return Promise.resolve(directory);
    return Promise.resolve(symbolicLink);
  }

  readFile(path: string): Promise<Uint8Array> {
    this.readPaths.push(path);
    const failure = this.#readFailures.get(path);
    this.#readFailures.delete(path);
    if (failure === "non-error") return rejectWithNativeNonError();
    if (failure !== undefined) throw failure;
    const bytes = this.#files.get(path);
    if (bytes === undefined) return Promise.reject(new MissingArtifactError("absent"));
    return Promise.resolve(new Uint8Array(bytes));
  }

  setKind(path: string, kind: FileKind): void {
    this.#kinds.set(path, kind);
  }
}

function rejectWithNativeNonError(): never {
  const signal = AbortSignal.abort("attacker text");
  signal.throwIfAborted();
  throw new Error("test abort signal did not reject");
}

function statusThatThrows(failure: Error): ArtifactStatus {
  return Object.freeze({
    isRegularFile: (): boolean => {
      throw failure;
    },
    isSymbolicLink: (): boolean => {
      throw failure;
    },
  });
}

function archive(app: "bot" | "config-search"): { readonly sidecar: Uint8Array; readonly zip: Uint8Array } {
  const readme = encoder.encode(`README for ${app}\n`);
  const executable = encoder.encode(`executable ${app}\n`);
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
    sourceDateEpoch: epoch,
    target: { arch: "x64", bunTarget: "bun-linux-x64", os: "linux" },
    toolchain: { bun: "1.3.14", nodeMetadata: "24.19.0" },
    version: "0.1.0",
  };
  const zip = encodeStoreZip(
    [
      { bytes: readme, mode: 0o644, path: "README.md" },
      { bytes: executable, mode: 0o755, path: `bin/mm-crypto-bot-${app}` },
      { bytes: encoder.encode(canonicalJson(manifest)), mode: 0o644, path: "manifest.json" },
    ],
    epoch,
  );
  const basename = `mm-crypto-bot-${app}-0.1.0-bun-linux-x64.zip`;
  const sidecar = encoder.encode(formatSha256Sidecar(sha256Hex(zip), basename));
  return Object.freeze({ sidecar, zip });
}

function artifactPath(app: "bot" | "config-search", suffix: "" | ".sha256"): string {
  const basename = `mm-crypto-bot-${app}-0.1.0-bun-linux-x64.zip`;
  return `${releaseRepoRoot}/releases/${app}/0.1.0/bun-linux-x64/${basename}${suffix}`;
}

function populatedFileSystem(): ArtifactFileSystem {
  const fileSystem = new ArtifactFileSystem();
  for (const app of ["bot", "config-search"] as const) {
    const current = archive(app);
    fileSystem.addFile(artifactPath(app, ""), current.zip);
    fileSystem.addFile(artifactPath(app, ".sha256"), current.sidecar);
  }
  return fileSystem;
}

function output(): {
  readonly stderr: string[];
  readonly stdout: string[];
  readonly writers: ReleaseVerificationOutput;
} {
  const stderr: string[] = [];
  const stdout: string[] = [];
  return Object.freeze({
    stderr,
    stdout,
    writers: Object.freeze({
      writeStderr: (text: string): void => {
        stderr.push(text);
      },
      writeStdout: (text: string): void => {
        stdout.push(text);
      },
    }),
  });
}

describe("existing release artifact verification", () => {
  test("reads both fixed application archives in order and returns isolated frozen manifests", async () => {
    // Catches release-directory enumeration, swapped application order, or returning mutable parsed manifest state.
    const fileSystem = populatedFileSystem();
    const manifests = await verifyAllReleaseArchives({ fileSystem, repositoryRoot: releaseRepoRoot });
    expect(manifests.map((manifest) => manifest.app)).toEqual(["bot", "config-search"]);
    expect(fileSystem.lstatPaths).toEqual([
      artifactPath("bot", ""),
      artifactPath("bot", ".sha256"),
      artifactPath("config-search", ""),
      artifactPath("config-search", ".sha256"),
    ]);
    expect(fileSystem.readPaths).toEqual(fileSystem.lstatPaths);
    expect(Object.isFrozen(manifests)).toBe(true);
    expect(Object.isFrozen(manifests[0])).toBe(true);
    expect(Object.isFrozen(manifests[0]?.payloads)).toBe(true);
  });

  test("returns a frozen manifest through the single-archive public API", async () => {
    // Catches the single-archive wrapper failing to expose the verified manifest result.
    const fileSystem = populatedFileSystem();
    const manifest = await verifyExistingReleaseArchive(
      { fileSystem, repositoryRoot: releaseRepoRoot },
      "bot",
    );
    expect(manifest.app).toBe("bot");
    expect(Object.isFrozen(manifest)).toBe(true);
  });

  test("throws the first aggregate artifact failure through the public API without reading", async () => {
    // Catches the aggregate wrapper swallowing a verified artifact failure or continuing to later reads.
    const fileSystem = populatedFileSystem();
    fileSystem.failLstat(artifactPath("bot", ""), new MissingArtifactError("attacker-controlled-path"));
    await expect(verifyAllReleaseArchives({ fileSystem, repositoryRoot: releaseRepoRoot })).rejects.toThrow(
      "release bot ZIP archive is missing",
    );
    expect(fileSystem.readPaths).toEqual([]);
  });

  test("rejects an unknown application before constructing paths or calling the filesystem", async () => {
    // Catches a programmatic input becoming a release path or filesystem authority.
    const fileSystem = populatedFileSystem();
    await expect(
      verifyExistingReleaseArchive({ fileSystem, repositoryRoot: releaseRepoRoot }, "../bot"),
    ).rejects.toThrow("release application is invalid");
    expect(fileSystem.lstatPaths).toEqual([]);
    expect(fileSystem.readPaths).toEqual([]);
  });

  test("maps missing ZIP and sidecar artifacts without attempting a read", async () => {
    // Catches read-before-lstat and leaking platform failures for absent artifacts.
    for (const suffix of ["", ".sha256"] as const) {
      const fileSystem = populatedFileSystem();
      fileSystem.failLstat(artifactPath("bot", suffix), new MissingArtifactError("attacker-controlled-path"));
      await expect(
        verifyExistingReleaseArchive({ fileSystem, repositoryRoot: releaseRepoRoot }, "bot"),
      ).rejects.toThrow("is missing");
      expect(fileSystem.readPaths).toEqual(suffix === "" ? [] : [artifactPath("bot", "")]);
    }
  });

  test("maps non-ENOENT lstat failures and all nonregular artifacts without reading", async () => {
    // Catches treating unavailable paths, directories, symlinks, or special files as readable release inputs.
    const unavailable = populatedFileSystem();
    unavailable.failLstat(artifactPath("bot", ""), new Error("private operating-system detail"));
    await expect(
      verifyExistingReleaseArchive({ fileSystem: unavailable, repositoryRoot: releaseRepoRoot }, "bot"),
    ).rejects.toThrow("is unavailable");
    expect(unavailable.readPaths).toEqual([]);

    for (const kind of ["directory", "other", "symbolic-link"] as const) {
      const fileSystem = populatedFileSystem();
      fileSystem.setKind(artifactPath("bot", ""), kind);
      await expect(
        verifyExistingReleaseArchive({ fileSystem, repositoryRoot: releaseRepoRoot }, "bot"),
      ).rejects.toThrow("is not a regular file");
      expect(fileSystem.readPaths).toEqual([]);
    }
  });

  test("maps ZIP and sidecar read failures without exposing their cause", async () => {
    // Catches raw filesystem exception disclosure after a successful lstat.
    for (const suffix of ["", ".sha256"] as const) {
      const fileSystem = populatedFileSystem();
      const failingPath = artifactPath("bot", suffix);
      fileSystem.failRead(failingPath, new Error("private read failure"));
      await expect(
        verifyExistingReleaseArchive({ fileSystem, repositoryRoot: releaseRepoRoot }, "bot"),
      ).rejects.toThrow("is unreadable");
    }
  });

  test("maps corrupted archives to the stable archive error without archive contents", async () => {
    // Catches forwarding pure-verifier errors or bytes through the public artifact boundary.
    const fileSystem = populatedFileSystem();
    fileSystem.addFile(artifactPath("bot", ""), new Uint8Array([0, 1, 2]));
    await expect(
      verifyExistingReleaseArchive({ fileSystem, repositoryRoot: releaseRepoRoot }, "bot"),
    ).rejects.toThrow("archive is invalid");
  });

  test("maps a corrupted archive to one exact redacted CLI stderr line", async () => {
    // Catches CLI error handling bypassing the archive verifier's stable failure message.
    const fileSystem = populatedFileSystem();
    fileSystem.addFile(artifactPath("bot", ""), new Uint8Array([0, 1, 2]));
    const currentOutput = output();
    expect(
      await runReleaseVerifyCli([], { fileSystem, repositoryRoot: releaseRepoRoot }, currentOutput.writers),
    ).toBe(1);
    expect(currentOutput.stderr).toEqual(["release verification failed: release bot archive is invalid\n"]);
    expect(currentOutput.stdout).toEqual([]);
  });

  test("returns exact CLI failures with no arguments, no output on success, and no I/O for every argument", async () => {
    // Catches accidental CLI flags, argument-to-path conversion, and stdout noise.
    for (const argv of [["bot"], ["../bot"], ["--path=/private"]] as const) {
      const fileSystem = populatedFileSystem();
      const currentOutput = output();
      expect(
        await runReleaseVerifyCli(
          argv,
          { fileSystem, repositoryRoot: releaseRepoRoot },
          currentOutput.writers,
        ),
      ).toBe(2);
      expect(currentOutput.stderr).toEqual(["release verification accepts no arguments\n"]);
      expect(currentOutput.stdout).toEqual([]);
      expect(fileSystem.lstatPaths).toEqual([]);
    }

    const successfulFileSystem = populatedFileSystem();
    const successfulOutput = output();
    expect(
      await runReleaseVerifyCli(
        [],
        { fileSystem: successfulFileSystem, repositoryRoot: releaseRepoRoot },
        successfulOutput.writers,
      ),
    ).toBe(0);
    expect(successfulOutput.stderr).toEqual([]);
    expect(successfulOutput.stdout).toEqual([]);
  });

  test("redacts Error and non-Error filesystem failures in one CLI stderr line", async () => {
    // Catches attacker-controlled exception text escaping the CLI diagnostic boundary.
    for (const failure of [new Error("secret /absolute/path"), "non-error"] as const) {
      const fileSystem = populatedFileSystem();
      fileSystem.failLstat(artifactPath("bot", ""), failure);
      const currentOutput = output();
      expect(
        await runReleaseVerifyCli([], { fileSystem, repositoryRoot: releaseRepoRoot }, currentOutput.writers),
      ).toBe(1);
      expect(currentOutput.stderr).toEqual([
        "release verification failed: release bot ZIP archive is unavailable\n",
      ]);
      expect(currentOutput.stdout).toEqual([]);
    }
  });

  test("maps throwing filesystem status inspection to an unavailable direct API error without reading", async () => {
    // Catches a lstat status method leaking its cause instead of failing closed before the read.
    const fileSystem = populatedFileSystem();
    fileSystem.failStatus(artifactPath("bot", ""), new Error("secret /absolute/path"));
    await expect(
      verifyExistingReleaseArchive({ fileSystem, repositoryRoot: releaseRepoRoot }, "bot"),
    ).rejects.toThrow("release bot ZIP archive is unavailable");
    expect(fileSystem.readPaths).toEqual([]);
  });
});
