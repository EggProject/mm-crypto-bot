import type {
  ReleaseDependencies,
  ReleaseFileSystemPort,
  ReleasePathKind,
  ReleasePrivateDirectory,
} from "./release-ports";

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
  #retainRemovedFile = false;
  #writeFailure: Error | undefined;
  readonly chmodOperations: { readonly mode: 0o644 | 0o755; readonly path: string }[] = [];
  readonly temporaryDirectoryOperations: { readonly parentDirectory: string; readonly prefix: string }[] = [];
  readonly writeOperations: { readonly bytes: Uint8Array; readonly path: string }[] = [];

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
    const kind = this.#kinds.get(path) ?? "missing";
    return Promise.resolve({
      isRegularFile: () => kind === "regular-file",
      isSymbolicLink: () => kind === "symbolic-link",
    });
  }

  mkdtemp(input: {
    readonly parentDirectory: string;
    readonly prefix: string;
  }): Promise<ReleasePrivateDirectory> {
    this.#temporaryDirectoryIndex += 1;
    this.temporaryDirectoryOperations.push(input);
    const directory = `${input.parentDirectory}/${input.prefix}${this.#temporaryDirectoryIndex.toString()}`;
    this.#kinds.set(directory, "directory");
    return Promise.resolve(Object.freeze({ path: directory }));
  }

  readFile(path: string): Promise<Uint8Array> {
    const bytes = this.#bytes.get(path);
    if (bytes === undefined) {
      return Promise.reject(new Error(`missing file: ${path}`));
    }
    return Promise.resolve(new Uint8Array(bytes));
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

  writeFile(path: string, bytes: Uint8Array, _mode: 0o644 | 0o755): Promise<void> {
    const failure = this.#writeFailure;
    this.#writeFailure = undefined;
    if (failure !== undefined) {
      return Promise.reject(failure);
    }
    this.writeOperations.push({ bytes: new Uint8Array(bytes), path });
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
    process: { run: () => Promise.resolve({ exitCode: 0, stderr: "", stdout: "" }) },
    repositoryRoot: repoRoot,
    temporaryRoot,
    toolchain: {
      bunVersion: () => Promise.resolve(options.bunVersion ?? "1.3.14"),
      nodeVersion: () => Promise.resolve(options.nodeVersion ?? "v24.19.0"),
    },
  };
  return { compilerCalls, dependencies, fileSystem };
}
