import { chmod, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { assembleRelease } from "./release-assembler";
import {
  releaseSetArchiveBasename,
  releaseSetCandidatePrefix,
  type ReleaseSetInput,
} from "./release-set-contract";
import { assembleReleaseSetCandidate } from "./release-set-assembler";
import {
  publishReleaseSet,
  type ReleasePublicationOutcome,
  type ReleaseSetPublicationDependencies,
} from "./release-set-publication";
import { assertReproducibleReleaseSet } from "./release-set-reproducibility";
import { verifyReleaseSetArchive } from "./release-set-verifier";
import { verifyPrivateReleaseCandidate } from "./release-private-candidate-reproducibility";
import type {
  ReleaseCommandResult,
  ReleaseDependencies,
  ReleaseFileSystemPort,
  ReleasePathKind,
  ReleasePrivateDirectory,
  ReleasePublicationFileSystemPort,
} from "./release-ports";
const disk = Object.freeze({ chmod, lstat, mkdir, mkdtemp, readFile, remove: rm, writeFile });
const encoder = new TextEncoder();
const botHelp =
  "mm-crypto-bot command-line interface\n\nUsage: bun run apps/bot/src/index.ts <subcommand> [options]\n\nSubcommands:\n  backtest              Run a quick backtest on a deterministic OHLC fixture\n  config                Validate / show / init the bot config\n  help                  Show this help\n  kill-switch-dry-run   Simulate the kill-switch path without sending any orders\n  kill-switches         Show kill-switch state\n  start                 Start the bot (headless — runs until SIGINT/SIGTERM)\n  status                Show the persisted bot state\n  strategies            List registered strategies + on/off state\n  trades                Show recent closed trades\n\nRun `bun run apps/bot/src/index.ts <subcommand> --help` for subcommand-specific options.\n";
const configHelp = "Usage: mm-crypto-bot-config-search [--status | --help]\n";
const configStatus =
  '{"available":false,"code":"CONFIG_SEARCH_UNAVAILABLE","operation":"config-search","reason":"exact-strategy-run-corridor-unavailable","schema":"mm-crypto-bot.config-search.result/v1"}\n';
type CandidateKind = "directory" | "symbolic-link";
class DiskReleaseFileSystem implements ReleaseFileSystemPort {
  readonly ledger: string[] = [];
  readonly privateDirectories: string[] = [];
  readonly removedDirectories: string[] = [];
  failOuterCleanup = false;
  failOuterWrite = false;
  innerReadCorrupt = false;
  outerReadCorrupt = false;
  outerCandidateKind: CandidateKind | undefined;
  chmod(filePath: string, mode: 0o644 | 0o755): Promise<void> {
    this.ledger.push(`chmod:${filePath}`);
    return disk.chmod(filePath, mode);
  }
  async inspectPath(filePath: string): Promise<ReleasePathKind> {
    try {
      const status = await disk.lstat(filePath);
      if (status.isSymbolicLink()) return "symbolic-link";
      if (status.isFile()) return "regular-file";
      if (status.isDirectory()) return "directory";
      return "other";
    } catch {
      return "missing";
    }
  }
  async lstat(
    filePath: string,
  ): Promise<{ readonly isRegularFile: () => boolean; readonly isSymbolicLink: () => boolean }> {
    this.ledger.push(`lstat:${filePath}`);
    if (path.basename(filePath) === releaseSetArchiveBasename && this.outerCandidateKind !== undefined) {
      const kind = this.outerCandidateKind;
      return Object.freeze({
        isRegularFile: (): boolean => false,
        isSymbolicLink: (): boolean => kind === "symbolic-link",
      });
    }
    const status = await disk.lstat(filePath);
    return Object.freeze({
      isRegularFile: (): boolean => status.isFile(),
      isSymbolicLink: (): boolean => status.isSymbolicLink(),
    });
  }
  async mkdir(directory: string, mode: 0o755): Promise<void> {
    this.ledger.push(`mkdir:${directory}`);
    await disk.mkdir(directory, { mode });
  }
  async mkdtemp(input: {
    readonly parentDirectory: string;
    readonly prefix: string;
  }): Promise<ReleasePrivateDirectory> {
    this.ledger.push(`mkdtemp:${input.parentDirectory}:${input.prefix}`);
    const directory = await disk.mkdtemp(path.join(input.parentDirectory, input.prefix));
    this.privateDirectories.push(directory);
    return Object.freeze({ path: directory });
  }
  async readFile(filePath: string): Promise<Uint8Array> {
    this.ledger.push(`read:${filePath}`);
    const isOuter = path.basename(filePath) === releaseSetArchiveBasename;
    if (
      (isOuter && this.outerReadCorrupt) ||
      (!isOuter && filePath.endsWith(".zip") && this.innerReadCorrupt)
    ) {
      return new Uint8Array([0]);
    }
    return new Uint8Array(await disk.readFile(filePath));
  }
  async removePrivateDirectory(directory: ReleasePrivateDirectory): Promise<void> {
    this.ledger.push(`remove:${directory.path}`);
    if (this.failOuterCleanup && path.basename(directory.path).startsWith(releaseSetCandidatePrefix)) {
      throw new Error("injected outer candidate cleanup failure");
    }
    this.removedDirectories.push(directory.path);
    await disk.remove(directory.path, { force: false, recursive: true });
  }
  async removeFile(filePath: string): Promise<void> {
    this.ledger.push(`remove-file:${filePath}`);
    await disk.remove(filePath, { force: false });
  }
  async writeFile(filePath: string, bytes: Uint8Array, mode: 0o644 | 0o755): Promise<void> {
    this.ledger.push(`write:${filePath}`);
    if (this.failOuterWrite && path.basename(filePath) === releaseSetArchiveBasename) {
      throw new Error("injected outer archive write failure");
    }
    await disk.writeFile(filePath, bytes, { mode });
  }
}
class WorkflowWorkspace {
  static async create(): Promise<WorkflowWorkspace> {
    const root = await disk.mkdtemp(path.join(tmpdir(), "mm-release-set-publication-workflow-"));
    const privateRoot = path.join(root, "private");
    const publicRoot = path.join(root, "public");
    const repoRoot = path.join(root, "repo");
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
    return new WorkflowWorkspace(root, privateRoot, publicRoot, repoRoot);
  }
  private constructor(
    readonly root: string,
    readonly privateRoot: string,
    readonly publicRoot: string,
    readonly repoRoot: string,
  ) {}
  async dispose(): Promise<void> {
    await disk.remove(this.root, { force: true, recursive: true });
  }
}
class PublicationPort implements ReleasePublicationFileSystemPort {
  readonly hardLinks: boolean[] = [];
  readonly links: { readonly destination: string; readonly source: string }[] = [];
  constructor(private readonly failure?: unknown) {}
  async link(source: string, destination: string): Promise<void> {
    this.links.push({ destination, source });
    if (this.failure !== undefined) {
      if (this.failure instanceof Error) throw this.failure;
      throw new Error("injected non-Error publication failure");
    }
    const { link } = await import("node:fs/promises");
    await link(source, destination);
    const [sourceStatus, destinationStatus] = await Promise.all([
      disk.lstat(source),
      disk.lstat(destination),
    ]);
    this.hardLinks.push(sourceStatus.ino === destinationStatus.ino);
  }
}
function dependencies(
  workspace: WorkflowWorkspace,
  fileSystem: DiskReleaseFileSystem,
  shouldDifferByBuild = false,
): {
  readonly dependencies: ReleaseDependencies;
  readonly processCalls: string[];
  readonly queueSmoke: () => void;
} {
  let compilerCalls = 0;
  const processResults: ReleaseCommandResult[] = [];
  const processCalls: string[] = [];
  const releaseDependencies: ReleaseDependencies = {
    compiler: {
      async compile(input): Promise<void> {
        compilerCalls += 1;
        const discriminator = shouldDifferByBuild
          ? compilerCalls.toString()
          : path.basename(input.outputPath);
        await disk.writeFile(input.outputPath, encoder.encode(`compiled:${discriminator}\n`), {
          mode: 0o755,
        });
      },
    },
    fileSystem,
    git: {
      headCommit: (): Promise<string> => Promise.resolve("a".repeat(40)),
      headCommitEpoch: (): Promise<string> => Promise.resolve("1788199915"),
      porcelainStatus: (): Promise<string> => Promise.resolve(""),
    },
    process: {
      run(input): Promise<ReleaseCommandResult> {
        processCalls.push(input.argv.at(-1) ?? "");
        const result = processResults.shift();
        return result === undefined
          ? Promise.reject(new Error("missing smoke process result"))
          : Promise.resolve(result);
      },
    },
    repositoryRoot: workspace.repoRoot,
    temporaryRoot: workspace.privateRoot,
    toolchain: {
      bunVersion: (): Promise<string> => Promise.resolve("1.4.2"),
      nodeVersion: (): Promise<string> => Promise.resolve("v24.21.0"),
    },
  };
  const queueSmoke = (): void => {
    processResults.push(
      { exitCode: 1, stderr: botHelp, stdout: "" },
      { exitCode: 1, stderr: botHelp, stdout: "" },
      { exitCode: 0, stderr: "", stdout: configHelp },
      { exitCode: 1, stderr: "", stdout: configStatus },
      { exitCode: 0, stderr: "", stdout: configHelp },
      { exitCode: 1, stderr: "", stdout: configStatus },
    );
  };
  return Object.freeze({ dependencies: releaseDependencies, processCalls, queueSmoke });
}
function publicationDependencies(
  fileSystem: DiskReleaseFileSystem,
  publicationFileSystem: ReleasePublicationFileSystemPort,
): ReleaseSetPublicationDependencies {
  return Object.freeze({ privateCandidateFileSystem: fileSystem, publicationFileSystem });
}
function errorWithCode(code: string): Error {
  const error = new Error("injected publication failure");
  Object.defineProperty(error, "code", { value: code });
  return error;
}
function privateCleanupLedger(fileSystem: DiskReleaseFileSystem, hasOuter: boolean): string[] {
  const directories = fileSystem.privateDirectories;
  return [
    ...directories.slice(2, 4),
    ...directories.slice(0, 2),
    ...directories.slice(6, 8),
    ...directories.slice(4, 6),
    ...(hasOuter ? directories.slice(8) : []),
  ];
}
async function makeOuterCandidate(
  workspace: WorkflowWorkspace,
  fileSystem: DiskReleaseFileSystem,
): Promise<Awaited<ReturnType<typeof assembleReleaseSetCandidate>>> {
  const current = dependencies(workspace, fileSystem);
  const candidates: string[] = [];
  const inputs: ReleaseSetInput[] = [];
  try {
    for (const app of ["bot", "config-search"] as const) {
      const assembled = await assembleRelease(current.dependencies, app);
      candidates.push(assembled.candidate.directory);
      const verified = await verifyPrivateReleaseCandidate(current.dependencies, assembled.candidate);
      if (verified.manifest.schema !== "mm-crypto-bot.release-manifest/v2")
        throw new Error("release-set fixture requires V2 release manifests");
      inputs.push({
        application: app,
        innerManifest: verified.manifest,
        sidecarBytes: verified.sidecarBytes,
        zipBytes: verified.zipBytes,
      });
    }
    return await assembleReleaseSetCandidate(current.dependencies, inputs);
  } finally {
    for (const directory of candidates) {
      await fileSystem.removePrivateDirectory({ path: directory });
    }
  }
}
async function beginWorkflow(
  workspace: WorkflowWorkspace,
  fileSystem: DiskReleaseFileSystem,
  publication: PublicationPort,
  shouldDifferByBuild = false,
): Promise<{
  readonly current: ReturnType<typeof dependencies>;
  readonly destination: string;
  readonly outcome: Promise<ReleasePublicationOutcome>;
}> {
  const current = dependencies(workspace, fileSystem, shouldDifferByBuild);
  current.queueSmoke();
  const destination = path.join(workspace.publicRoot, "0.1.0", "bun-linux-x64", releaseSetArchiveBasename);
  await disk.mkdir(path.dirname(destination), { recursive: true });
  const outcome = assertReproducibleReleaseSet({
    publicationDependencies: publicationDependencies(fileSystem, publication),
    publicationRoot: workspace.publicRoot,
    releaseDependencies: current.dependencies,
  });
  return Object.freeze({ current, destination, outcome });
}
test("publishes one verified release-set hard link after two private builds per app and retains it after private deletion", async () => {
  const workspace = await WorkflowWorkspace.create();
  const fileSystem = new DiskReleaseFileSystem();
  try {
    const current = dependencies(workspace, fileSystem);
    current.queueSmoke();
    const publication = new PublicationPort();
    const destination = path.join(workspace.publicRoot, "0.1.0", "bun-linux-x64", releaseSetArchiveBasename);
    await disk.mkdir(path.dirname(destination), { recursive: true });
    await expect(
      assertReproducibleReleaseSet({
        publicationDependencies: publicationDependencies(fileSystem, publication),
        publicationRoot: workspace.publicRoot,
        releaseDependencies: current.dependencies,
      }),
    ).resolves.toEqual({ kind: "published" });
    expect(current.processCalls).toEqual(["--help", "--help", "--help", "--status", "--help", "--status"]);
    expect(publication.links).toHaveLength(1);
    expect(publication.hardLinks).toEqual([true]);
    const destinationBytes = new Uint8Array(await disk.readFile(destination));
    await expect(verifyReleaseSetArchive({ zipBytes: destinationBytes })).resolves.toMatchObject({
      verified: true,
    });
    expect(fileSystem.removedDirectories).toEqual(privateCleanupLedger(fileSystem, true));
  } finally {
    await workspace.dispose();
  }
});
test("rejects an escaped outer candidate before any private or publication port activity", async () => {
  const workspace = await WorkflowWorkspace.create();
  const fileSystem = new DiskReleaseFileSystem();
  try {
    const candidate = await makeOuterCandidate(workspace, fileSystem);
    const publication = new PublicationPort();
    fileSystem.ledger.length = 0;
    const forged = Object.freeze({
      ...candidate,
      archivePath: path.join(candidate.directory.path, "elsewhere.zip"),
    });
    await expect(
      publishReleaseSet(
        { candidate: forged, privateRoot: workspace.privateRoot, publicationRoot: workspace.publicRoot },
        publicationDependencies(fileSystem, publication),
      ),
    ).resolves.toEqual({ kind: "publication-failed" });
    expect(fileSystem.ledger).toEqual([]);
    expect(publication.links).toEqual([]);
    await fileSystem.removePrivateDirectory(candidate.directory);
  } finally {
    await workspace.dispose();
  }
});
test("removes the outer private candidate after its write failure and fails closed if that cleanup also fails", async () => {
  for (const hasCleanupFailure of [false, true]) {
    const workspace = await WorkflowWorkspace.create();
    const fileSystem = new DiskReleaseFileSystem();
    fileSystem.failOuterWrite = true;
    fileSystem.failOuterCleanup = hasCleanupFailure;
    try {
      const running = await beginWorkflow(workspace, fileSystem, new PublicationPort());
      await expect(running.outcome).rejects.toThrow(
        hasCleanupFailure
          ? "release-set private candidate cleanup failed"
          : "injected outer archive write failure",
      );
      expect(running.current.processCalls).toHaveLength(6);
      expect(fileSystem.privateDirectories).toHaveLength(9);
      expect(fileSystem.removedDirectories).toEqual(privateCleanupLedger(fileSystem, !hasCleanupFailure));
    } finally {
      await workspace.dispose();
    }
  }
});
test("redacts first and second private-build reproducibility failures after their exact private cleanup", async () => {
  const mismatchWorkspace = await WorkflowWorkspace.create();
  const mismatchFileSystem = new DiskReleaseFileSystem();
  try {
    const mismatch = await beginWorkflow(mismatchWorkspace, mismatchFileSystem, new PublicationPort(), true);
    await expect(mismatch.outcome).rejects.toThrow("release-set reproducibility mismatch");
    expect(mismatch.current.processCalls).toEqual([]);
    expect(mismatchFileSystem.removedDirectories).toEqual([
      mismatchFileSystem.privateDirectories[0],
      mismatchFileSystem.privateDirectories[1],
    ]);
  } finally {
    await mismatchWorkspace.dispose();
  }
  const verifierWorkspace = await WorkflowWorkspace.create();
  const verifierFileSystem = new DiskReleaseFileSystem();
  verifierFileSystem.innerReadCorrupt = true;
  try {
    const verification = await beginWorkflow(verifierWorkspace, verifierFileSystem, new PublicationPort());
    await expect(verification.outcome).rejects.toThrow(
      "release private candidate reproducibility verification failed",
    );
    expect(verification.current.processCalls).toEqual([]);
    expect(verifierFileSystem.removedDirectories).toEqual([verifierFileSystem.privateDirectories[0]]);
  } finally {
    await verifierWorkspace.dispose();
  }
});
test("fails closed for verifier and non-regular outer candidates, preserving the create-only public boundary", async () => {
  for (const kind of [undefined, "directory", "symbolic-link"] as const) {
    const workspace = await WorkflowWorkspace.create();
    const fileSystem = new DiskReleaseFileSystem();
    if (kind === undefined) fileSystem.outerReadCorrupt = true;
    else fileSystem.outerCandidateKind = kind;
    const publication = new PublicationPort();
    try {
      const running = await beginWorkflow(workspace, fileSystem, publication);
      await expect(running.outcome).resolves.toEqual({ kind: "publication-failed" });
      expect(publication.links).toEqual([]);
      expect(fileSystem.removedDirectories.at(-1)).toBe(fileSystem.privateDirectories.at(-1));
      await expect(disk.lstat(running.destination)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await workspace.dispose();
    }
  }
});
test("classifies EEXIST, EXDEV, unknown, and hostile link failures without a destination fallback", async () => {
  const failures: readonly {
    readonly expected: ReleasePublicationOutcome;
    readonly failure: unknown;
    readonly sentinel: boolean;
  }[] = [
    { expected: { kind: "destination-exists" }, failure: undefined, sentinel: true },
    { expected: { kind: "cross-device" }, failure: errorWithCode("EXDEV"), sentinel: false },
    { expected: { kind: "publication-failed" }, failure: new Error("unknown link failure"), sentinel: false },
    {
      expected: { kind: "publication-failed" },
      failure: new Proxy(new Error("hostile link failure"), {
        getOwnPropertyDescriptor: (): never => {
          throw new Error("hostile link error descriptor");
        },
      }),
      sentinel: false,
    },
  ];
  for (const failure of failures) {
    const workspace = await WorkflowWorkspace.create();
    const fileSystem = new DiskReleaseFileSystem();
    const publication = new PublicationPort(failure.failure);
    try {
      const destination = path.join(
        workspace.publicRoot,
        "0.1.0",
        "bun-linux-x64",
        releaseSetArchiveBasename,
      );
      await disk.mkdir(path.dirname(destination), { recursive: true });
      if (failure.sentinel) await disk.writeFile(destination, encoder.encode("existing public release\n"));
      const running = await beginWorkflow(workspace, fileSystem, publication);
      await expect(running.outcome).resolves.toEqual(failure.expected);
      expect(publication.links).toHaveLength(1);
      expect(fileSystem.removedDirectories.at(-1)).toBe(fileSystem.privateDirectories.at(-1));
      if (failure.sentinel)
        expect(await disk.readFile(destination, "utf8")).toBe("existing public release\n");
      else await expect(disk.lstat(destination)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await workspace.dispose();
    }
  }
});
test("retains the redacted pre-link failure and the visible post-link release across private cleanup failures", async () => {
  const beforeWorkspace = await WorkflowWorkspace.create();
  const beforeFileSystem = new DiskReleaseFileSystem();
  beforeFileSystem.outerCandidateKind = "symbolic-link";
  beforeFileSystem.failOuterCleanup = true;
  try {
    const before = await beginWorkflow(beforeWorkspace, beforeFileSystem, new PublicationPort());
    await expect(before.outcome).resolves.toEqual({ kind: "publication-failed" });
    expect(beforeFileSystem.removedDirectories).not.toContain(beforeFileSystem.privateDirectories.at(-1));
    await expect(disk.lstat(before.destination)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await beforeWorkspace.dispose();
  }
  const afterWorkspace = await WorkflowWorkspace.create();
  const afterFileSystem = new DiskReleaseFileSystem();
  afterFileSystem.failOuterCleanup = true;
  const afterPublication = new PublicationPort();
  try {
    const after = await beginWorkflow(afterWorkspace, afterFileSystem, afterPublication);
    await expect(after.outcome).resolves.toEqual({ kind: "published-cleanup-failed" });
    expect(afterPublication.hardLinks).toEqual([true]);
    const destinationBytes = new Uint8Array(await disk.readFile(after.destination));
    await expect(verifyReleaseSetArchive({ zipBytes: destinationBytes })).resolves.toMatchObject({
      verified: true,
    });
    expect(afterFileSystem.removedDirectories).not.toContain(afterFileSystem.privateDirectories.at(-1));
  } finally {
    await afterWorkspace.dispose();
  }
});
