import type {
  ReleaseDependencies,
  ReleaseFileSystemPort,
  ReleasePathKind,
  ReleasePrivateDirectory,
} from "./release-ports";
import type { ReleaseCommandResult } from "./release-ports";

const text = new TextEncoder();

export const repoRoot = "/repo";
export const temporaryRoot = "/private";

export class FakeFileSystem implements ReleaseFileSystemPort {
  #bytes = new Map<string, Uint8Array>();
  #kinds = new Map<string, ReleasePathKind>([
    [repoRoot, "directory"],
    [temporaryRoot, "directory"],
  ]);
  #temporaryDirectoryIndex = 0;
  #removalFailure: Error | undefined;
  #directoryRemovalFailure: Error | undefined;
  #lstatFailure: Error | undefined;
  #mkdtempFailure: Error | undefined;
  #readFailureCountdown = 0;
  #nextPrivateDirectory: ReleasePrivateDirectory | undefined;
  #nextPrivateDirectoryPath: string | undefined;
  #retainRemovedFile = false;
  #writeFailure: Error | undefined;
  #processResults: ReleaseCommandResult[] = [];
  readonly chmodOperations: { readonly mode: 0o644 | 0o755; readonly path: string }[] = [];
  readonly directoryOperations: { readonly mode: 0o755; readonly path: string }[] = [];
  readonly processOperations: {
    readonly argv: readonly string[];
    readonly cwd: string;
    readonly env: Readonly<Record<string, string>>;
  }[] = [];
  readonly readOperations: string[] = [];
  readonly removedDirectories: string[] = [];
  readonly temporaryDirectoryOperations: { readonly parentDirectory: string; readonly prefix: string }[] = [];
  readonly writeOperations: { readonly bytes: Uint8Array; readonly path: string }[] = [];
  readonly writeModes: (0o644 | 0o755)[] = [];

  addDirectory(path: string): void {
    this.#kinds.set(path, "directory");
  }

  addFile(path: string, bytes: Uint8Array): void {
    this.#bytes.set(path, bytes);
    this.#kinds.set(path, "regular-file");
  }

  chmod(path: string, mode: 0o644 | 0o755): Promise<void> {
    this.chmodOperations.push({ mode, path });
    return Promise.resolve();
  }

  inspectPath(path: string): Promise<ReleasePathKind> {
    return Promise.resolve(this.#kinds.get(path) ?? "missing");
  }

  lstat(
    path: string,
  ): Promise<{ readonly isRegularFile: () => boolean; readonly isSymbolicLink: () => boolean }> {
    const failure = this.#lstatFailure;
    this.#lstatFailure = undefined;
    if (failure !== undefined) return Promise.reject(failure);
    const kind = this.#kinds.get(path) ?? "missing";
    return Promise.resolve({
      isRegularFile: () => kind === "regular-file",
      isSymbolicLink: () => kind === "symbolic-link",
    });
  }

  mkdir(path: string, mode: 0o755): Promise<void> {
    this.directoryOperations.push({ mode, path });
    this.addDirectory(path);
    return Promise.resolve();
  }

  mkdtemp(input: {
    readonly parentDirectory: string;
    readonly prefix: string;
  }): Promise<ReleasePrivateDirectory> {
    const failure = this.#mkdtempFailure;
    this.#mkdtempFailure = undefined;
    if (failure !== undefined) return Promise.reject(failure);
    this.#temporaryDirectoryIndex += 1;
    this.temporaryDirectoryOperations.push(input);
    const directoryPath =
      this.#nextPrivateDirectoryPath ??
      `${input.parentDirectory}/${input.prefix}${this.#temporaryDirectoryIndex.toString()}`;
    this.#nextPrivateDirectoryPath = undefined;
    const directory = this.#nextPrivateDirectory ?? Object.freeze({ path: directoryPath });
    this.#nextPrivateDirectory = undefined;
    this.#kinds.set(directory.path, "directory");
    return Promise.resolve(directory);
  }

  readFile(path: string): Promise<Uint8Array> {
    this.readOperations.push(path);
    if (this.#readFailureCountdown > 0) {
      this.#readFailureCountdown -= 1;
      if (this.#readFailureCountdown === 0) return Promise.reject(new Error("injected read failure"));
    }
    const bytes = this.#bytes.get(path);
    if (bytes === undefined) {
      return Promise.reject(new Error(`missing file: ${path}`));
    }
    return Promise.resolve(new Uint8Array(bytes));
  }

  removePrivateDirectory(directory: ReleasePrivateDirectory): Promise<void> {
    const failure = this.#directoryRemovalFailure;
    this.#directoryRemovalFailure = undefined;
    if (failure !== undefined) return Promise.reject(failure);
    if (this.pathKind(directory.path) !== "directory") {
      return Promise.reject(new Error(`missing private directory: ${directory.path}`));
    }
    this.removedDirectories.push(directory.path);
    for (const path of this.#kinds.keys()) {
      if (path !== directory.path && !path.startsWith(`${directory.path}/`)) continue;
      this.#kinds.delete(path);
      this.#bytes.delete(path);
    }
    return Promise.resolve();
  }

  removeFile(path: string): Promise<void> {
    const failure = this.#removalFailure;
    this.#removalFailure = undefined;
    if (failure !== undefined) {
      return Promise.reject(failure);
    }
    if ((this.#kinds.get(path) ?? "missing") !== "regular-file") {
      return Promise.reject(new Error(`missing removable file: ${path}`));
    }
    if (this.#retainRemovedFile) {
      this.#retainRemovedFile = false;
      return Promise.resolve();
    }
    this.#bytes.delete(path);
    this.#kinds.delete(path);
    return Promise.resolve();
  }

  failNextRemove(): void {
    this.#removalFailure = new Error("injected remove failure");
  }

  failNextDirectoryRemoval(): void {
    this.#directoryRemovalFailure = new Error("injected directory remove failure");
  }

  failNextLstat(): void {
    this.#lstatFailure = new Error("injected lstat failure");
  }

  failNextMkdtemp(): void {
    this.#mkdtempFailure = new Error("injected mkdtemp failure");
  }

  failNextRead(): void {
    this.#readFailureCountdown = 1;
  }

  failSecondRead(): void {
    this.#readFailureCountdown = 2;
  }

  setNextPrivateDirectory(path: string): void {
    this.#nextPrivateDirectoryPath = path;
  }

  setNextPrivateDirectoryValue(directory: ReleasePrivateDirectory): void {
    this.#nextPrivateDirectory = directory;
  }

  queueProcess(...results: readonly ReleaseCommandResult[]): void {
    this.#processResults.push(...results);
  }

  runProcess(input: {
    readonly argv: readonly string[];
    readonly cwd: string;
    readonly env: Readonly<Record<string, string>>;
  }): Promise<ReleaseCommandResult> {
    this.processOperations.push(input);
    const result = this.#processResults.shift();
    if (result === undefined) return Promise.reject(new Error("missing process result"));
    return Promise.resolve(result);
  }

  retainNextRemovedFile(): void {
    this.#retainRemovedFile = true;
  }

  failNextWrite(): void {
    this.#writeFailure = new Error("injected write failure");
  }

  pathKind(path: string): ReleasePathKind {
    return this.#kinds.get(path) ?? "missing";
  }

  setKind(path: string, kind: ReleasePathKind): void {
    this.#kinds.set(path, kind);
  }

  writeFile(path: string, bytes: Uint8Array, mode: 0o644 | 0o755): Promise<void> {
    const failure = this.#writeFailure;
    this.#writeFailure = undefined;
    if (failure !== undefined) {
      return Promise.reject(failure);
    }
    this.writeOperations.push({ bytes: new Uint8Array(bytes), path });
    this.writeModes.push(mode);
    this.addFile(path, new Uint8Array(bytes));
    return Promise.resolve();
  }
}

export interface Fixture {
  readonly compilerCalls: {
    readonly entryPoint: string;
    readonly outputPath: string;
    readonly target: string;
  }[];
  readonly dependencies: ReleaseDependencies;
  readonly fileSystem: FakeFileSystem;
}

export interface FixtureOptions {
  readonly bunVersion?: string;
  readonly commit?: string;
  readonly epoch?: string;
  readonly nodeVersion?: string;
  readonly status?: string;
}

export function rootPackageBytes(
  packageManager = "bun@1.3.14",
  bun = "1.3.14",
  node = "24.19.0",
): Uint8Array {
  return text.encode(`{"engines":{"bun":"${bun}","node":"${node}"},"packageManager":"${packageManager}"}\n`);
}

export function fixture(options: FixtureOptions = {}): Fixture {
  const fileSystem = new FakeFileSystem();
  fileSystem.addFile(`${repoRoot}/package.json`, rootPackageBytes());
  fileSystem.addFile(`${repoRoot}/.bun-version`, text.encode("1.3.14\n"));
  fileSystem.addFile(`${repoRoot}/.nvmrc`, text.encode("24.19.0\n"));
  fileSystem.addFile(`${repoRoot}/bun.lock`, text.encode("lockfile\n"));
  for (const app of ["bot", "config-search"] as const) {
    fileSystem.addFile(`${repoRoot}/apps/${app}/package.json`, text.encode('{"version":"0.1.0"}\n'));
    fileSystem.addFile(`${repoRoot}/apps/${app}/src/index.ts`, text.encode("entrypoint\n"));
  }
  const compilerCalls: {
    readonly entryPoint: string;
    readonly outputPath: string;
    readonly target: string;
  }[] = [];
  const dependencies: ReleaseDependencies = {
    compiler: {
      compile: (input) => {
        compilerCalls.push(input);
        fileSystem.addFile(input.outputPath, text.encode(`compiled ${input.entryPoint}\n`));
        return Promise.resolve();
      },
    },
    fileSystem,
    git: {
      headCommit: () => Promise.resolve(options.commit ?? "a".repeat(40)),
      headCommitEpoch: () => Promise.resolve(options.epoch ?? "1788199915"),
      porcelainStatus: () => Promise.resolve(options.status ?? ""),
    },
    process: { run: (input) => fileSystem.runProcess(input) },
    repositoryRoot: repoRoot,
    temporaryRoot,
    toolchain: {
      bunVersion: () => Promise.resolve(options.bunVersion ?? "1.3.14"),
      nodeVersion: () => Promise.resolve(options.nodeVersion ?? "v24.19.0"),
    },
  };
  return { compilerCalls, dependencies, fileSystem };
}
