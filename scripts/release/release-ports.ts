import { link as linkFile } from "node:fs/promises";

import type { ReleaseTarget } from "./release-contract";

export interface ReleaseCommandResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

export interface ReleaseProcessPort {
  run(input: {
    readonly argv: readonly string[];
    readonly cwd: string;
    readonly env: Readonly<Record<string, string>>;
  }): Promise<ReleaseCommandResult>;
}

export interface ReleaseGitPort {
  headCommit(): Promise<string>;
  headCommitEpoch(): Promise<string>;
  porcelainStatus(): Promise<string>;
}

export interface ReleaseToolchainPort {
  bunVersion(): Promise<string>;
  /**
   * Returns the trimmed raw output of `node --version`, including its leading `v`.
   */
  nodeVersion(): Promise<string>;
}

export interface ReleaseCompilerPort {
  compile(input: {
    readonly entryPoint: string;
    readonly outputPath: string;
    readonly target: ReleaseTarget;
  }): Promise<void>;
}

export interface ReleaseFileSystemPort {
  chmod(path: string, mode: 0o644 | 0o755): Promise<void>;
  inspectPath(path: string): Promise<ReleasePathKind>;
  lstat(
    path: string,
  ): Promise<{ readonly isRegularFile: () => boolean; readonly isSymbolicLink: () => boolean }>;
  mkdir(path: string, mode: 0o755): Promise<void>;
  mkdtemp(input: ReleaseMkdtempInput): Promise<ReleasePrivateDirectory>;
  readFile(path: string): Promise<Uint8Array>;
  removePrivateDirectory(directory: ReleasePrivateDirectory): Promise<void>;
  removeFile(path: string): Promise<void>;
  writeFile(path: string, bytes: Uint8Array, mode: 0o644 | 0o755): Promise<void>;
}

export interface ReleaseMkdtempInput {
  readonly parentDirectory: string;
  readonly prefix: string;
}

export type ReleasePathKind = "directory" | "missing" | "other" | "regular-file" | "symbolic-link";

export interface ReleasePrivateDirectory {
  readonly path: string;
}

/*
 * Create-only public publication capability; it deliberately exposes no read or traversal operation.
 */
export interface ReleasePublicationFileSystemPort {
  link(source: string, destination: string): Promise<void>;
}

function createReleasePublicationFileSystem(
  link: ReleasePublicationFileSystemPort["link"],
): ReleasePublicationFileSystemPort {
  return Object.freeze({ link });
}

/*
 * Node/Bun create-only publication adapter; link errors remain observable to the publisher.
 */
export const nodeReleasePublicationFileSystem = createReleasePublicationFileSystem(linkFile);

export interface ReleaseDependencies {
  readonly compiler: ReleaseCompilerPort;
  readonly fileSystem: ReleaseFileSystemPort;
  readonly git: ReleaseGitPort;
  readonly process: ReleaseProcessPort;
  readonly repositoryRoot: string;
  readonly temporaryRoot: string;
  readonly toolchain: ReleaseToolchainPort;
}

export interface ReleaseBuildIdentity {
  readonly commit: string;
  readonly lockfileSha256: string;
  readonly sourceDateEpoch: number;
}
