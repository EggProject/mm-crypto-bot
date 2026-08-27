import { spawn } from "node:child_process";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { nodeSignalBusMaterializationPort } from "./signal-bus-materialization-git";
import { type SignalBusMaterializationVerificationRequest } from "./signal-bus-materialization-verifier";

const neutralGitEnvironmentNames = [
  "PATH",
  "SYSTEMROOT",
  "SystemRoot",
  "WINDIR",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "TZ",
] as const;

export function signalBusHistoryVerificationRequest(
  candidateRoot: string,
  manifestPath: string,
  approval: string,
  brief?: string,
): SignalBusMaterializationVerificationRequest {
  return {
    mode: "history",
    toolchainRoot: process.cwd(),
    candidateRoot,
    manifestPath,
    role: "active",
    ...(brief !== undefined && { brief }),
    base: approval,
    approval,
  };
}

export async function writeTemporaryFile(absolutePath: string, contents: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const directory = path.dirname(absolutePath);
    const child = spawn("mkdir", ["--parents", directory]);
    child.on("error", reject);
    child.on("close", (status: number | null) => {
      if (status === 0) {
        resolve();
        return;
      }
      reject(new Error("temporary-directory-failure"));
    });
  });
  await new Promise<void>((resolve, reject) => {
    const child = spawn("tee", [absolutePath]);
    child.on("error", reject);
    child.stdin.end(contents, "utf8");
    child.on("close", (status: number | null) => {
      if (status === 0) {
        resolve();
        return;
      }
      reject(new Error("temporary-file-failure"));
    });
  });
}

function git(root: string, arguments_: readonly string[]): Promise<string>;
function git(
  root: string,
  arguments_: readonly string[],
  isFailureAllowed: true,
): Promise<string | undefined>;
async function git(
  root: string,
  arguments_: readonly string[],
  isFailureAllowed = false,
): Promise<string | undefined> {
  return await new Promise((resolve, reject) => {
    const environment: NodeJS.ProcessEnv = {
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
      GIT_AUTHOR_NAME: "Verifier",
      GIT_AUTHOR_EMAIL: "verifier@example.invalid",
      GIT_COMMITTER_NAME: "Verifier",
      GIT_COMMITTER_EMAIL: "verifier@example.invalid",
    };
    for (const name of neutralGitEnvironmentNames) {
      // eslint-disable-next-line security/detect-object-injection -- The key comes from the closed neutral allowlist above.
      const value = process.env[name];
      // eslint-disable-next-line security/detect-object-injection -- The key comes from the closed neutral allowlist above.
      if (value !== undefined) environment[name] = value;
    }
    const child = spawn("git", arguments_, {
      cwd: root,
      env: environment,
    });
    const output: Uint8Array[] = [];
    const errors: Uint8Array[] = [];
    child.stdout.on("data", (chunk: Uint8Array) => {
      output.push(chunk);
    });
    child.stderr.on("data", (chunk: Uint8Array) => {
      errors.push(chunk);
    });
    child.on("error", reject);
    child.on("close", (status: number | null) => {
      if (status === 0) {
        resolve(Buffer.concat(output).toString("utf8").trim());
        return;
      }
      if (isFailureAllowed) {
        resolve(undefined);
        return;
      }
      reject(
        new Error(`temporary-git-failure:${arguments_.join(" ")}:${Buffer.concat(errors).toString("utf8")}`),
      );
    });
  });
}

export interface TemporarySignalBusRepo {
  readonly root: string;
  readonly port: typeof nodeSignalBusMaterializationPort;
  write(relativePath: string, contents: string): Promise<void>;
  remove(relativePath: string): Promise<void>;
  symlink(relativePath: string, target: string): Promise<void>;
  writeAndCommit(relativePath: string, contents: string): Promise<void>;
  writeAndStage(relativePath: string, contents: string): Promise<void>;
  commitWithMessage(
    relativePath: string,
    contents: string,
    message: string,
    additionalRelativePaths?: readonly string[],
  ): Promise<void>;
  removeAndCommitWithMessage(relativePath: string, message: string): Promise<void>;
  setGitConfig(name: string, value: string): Promise<void>;
  branch(name: string): Promise<void>;
  checkout(name: string): Promise<void>;
  merge(name: string | readonly string[], message?: string): Promise<void>;
  mergeWithResolution(
    name: string | readonly string[],
    relativePath: string,
    contents: string | undefined,
    message: string,
  ): Promise<void>;
  currentBranch(): Promise<string>;
  head(): Promise<string>;
  remoteNames(): Promise<readonly string[]>;
  dispose(): Promise<void>;
}

export async function createTemporarySignalBusRepo(
  objectFormat: "sha1" | "sha256" = "sha1",
): Promise<TemporarySignalBusRepo> {
  const root = await mkdtemp(path.join(tmpdir(), "signal-bus-materialization-"));
  await git(root, ["init", `--object-format=${objectFormat}`]);
  await git(root, ["commit", "--allow-empty", "-m", "initial"]);
  const write = async (relativePath: string, contents: string): Promise<void> => {
    const absolute = path.join(root, relativePath);
    await writeTemporaryFile(absolute, contents);
  };
  const remove = async (relativePath: string): Promise<void> => {
    await rm(path.join(root, relativePath));
  };
  const createSymlink = async (relativePath: string, target: string): Promise<void> => {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("mkdir", ["--parents", path.dirname(path.join(root, relativePath))]);
      child.on("error", reject);
      child.on("close", (status: number | null) => {
        if (status === 0) {
          resolve();
        } else {
          reject(new Error("temporary-directory-failure"));
        }
      });
    });
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Test fixture paths are confined to its fresh temporary repository.
    await symlink(target, path.join(root, relativePath));
  };
  const writeAndCommit = async (relativePath: string, contents: string): Promise<void> => {
    await write(relativePath, contents);
    await git(root, ["add", "--", relativePath]);
    await git(root, ["commit", "-m", "fixture"]);
  };
  const writeAndStage = async (relativePath: string, contents: string): Promise<void> => {
    await write(relativePath, contents);
    await git(root, ["add", "--", relativePath]);
  };
  const commitWithMessage = async (
    relativePath: string,
    contents: string,
    message: string,
    additionalRelativePaths: readonly string[] = [],
  ): Promise<void> => {
    await write(relativePath, contents);
    await git(root, ["add", "--", relativePath, ...additionalRelativePaths]);
    await git(root, ["commit", "-m", message]);
  };
  const removeAndCommitWithMessage = async (relativePath: string, message: string): Promise<void> => {
    await git(root, ["rm", "--", relativePath]);
    await git(root, ["commit", "-m", message]);
  };
  const setGitConfig = async (name: string, value: string): Promise<void> => {
    await git(root, ["config", name, value]);
  };
  const remoteNames = async (): Promise<readonly string[]> => {
    const names = await git(root, ["remote"]);
    return names.split("\n").filter(Boolean);
  };
  return Object.freeze({
    root,
    port: nodeSignalBusMaterializationPort,
    write,
    remove,
    symlink: createSymlink,
    writeAndCommit,
    writeAndStage,
    commitWithMessage,
    removeAndCommitWithMessage,
    setGitConfig,
    branch: async (name: string) => {
      await git(root, ["switch", "--create", name]);
    },
    checkout: async (name: string) => {
      await git(root, ["switch", name]);
    },
    merge: async (name: string | readonly string[], message?: string) => {
      const names = typeof name === "string" ? [name] : name;
      await git(
        root,
        message === undefined
          ? ["merge", "--no-ff", "--no-edit", ...names]
          : ["merge", "--no-ff", "-m", message, ...names],
      );
    },
    mergeWithResolution: async (
      name: string | readonly string[],
      relativePath: string,
      contents: string | undefined,
      message: string,
    ) => {
      const names = typeof name === "string" ? [name] : name;
      await git(root, ["merge", "--no-ff", "--no-commit", ...names], true);
      if (contents === undefined) await git(root, ["rm", "--force", "--", relativePath]);
      else {
        await write(relativePath, contents);
        await git(root, ["add", "--", relativePath]);
      }
      await git(root, ["commit", "--allow-empty", "-m", message]);
    },
    currentBranch: async () => await git(root, ["branch", "--show-current"]),
    head: async () => await git(root, ["rev-parse", "HEAD"]),
    remoteNames,
    dispose: async () => {
      await rm(root, { recursive: true, force: true });
    },
  });
}
