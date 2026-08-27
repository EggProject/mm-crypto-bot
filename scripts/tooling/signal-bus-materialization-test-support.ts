import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { type SignalBusMaterializationGitPort } from "./signal-bus-materialization-git";
import { type SignalBusMaterializationVerificationRequest } from "./signal-bus-materialization-verifier";
import {
  createTemporarySignalBusRepo as createTemporarySignalBusRepoFixture,
  type TemporarySignalBusRepo,
  writeTemporaryFile as writeTemporaryRepoFile,
} from "./signal-bus-materialization-repo-test-support";
const encoder = new TextEncoder();
export const signalBusFullIdentity = "1".repeat(40);
export const signalBusVerificationBase = "a".repeat(40);
const addedRaw = `:100644 100644 ${"0".repeat(40)} ${signalBusFullIdentity} A\u{0}entry.ts\u{0}`;
const addedName = "A\u{0}entry.ts\u{0}";
function signalBusPhysicalLineCount(text: string): number {
  return text.length === 0 ? 0 : text.split(/\r\n|\n|\r/u).length - (/(\r\n|\n|\r)$/u.test(text) ? 1 : 0);
}
export const signalBusVerificationManifest = JSON.stringify({
  schemaVersion: 1,
  role: "active",
  materializations: [
    {
      role: "active",
      path: "governed/entry.ts",
      owner: "owner",
      allowedOperation: "create",
      prerequisite: [],
      brief: "ABC",
    },
  ],
});
export interface SignalBusManifestFixtureEntry {
  readonly path: string;
  readonly allowedOperation: "create" | "modify" | "delete";
  readonly prerequisite?: readonly string[];
  readonly brief?: string;
  readonly owner?: string;
}
export function signalBusManifest(entries: readonly SignalBusManifestFixtureEntry[]): string {
  return JSON.stringify({
    schemaVersion: 1,
    role: "active",
    materializations: entries.map((entry) => ({
      role: "active",
      path: entry.path,
      owner: entry.owner ?? "owner",
      allowedOperation: entry.allowedOperation,
      prerequisite: entry.prerequisite ?? [],
      brief: entry.brief ?? "ABC",
    })),
  });
}
export function signalBusGitOutput(
  text: string,
  exitCode = 0,
): { readonly stdout: Uint8Array; readonly stderr: string; readonly exitCode: number } {
  return { stdout: encoder.encode(text), stderr: "", exitCode };
}
export function createSignalBusGitPort(
  run: (arguments_: readonly string[]) => {
    readonly stdout: Uint8Array;
    readonly stderr: string;
    readonly exitCode: number;
  },
  inspect: SignalBusMaterializationGitPort["inspect"],
): SignalBusMaterializationGitPort {
  return {
    canonicalize: (absolutePath) => Promise.resolve(absolutePath),
    run: (_root, arguments_) => Promise.resolve(run(arguments_)),
    snapshot: async (absolutePath, gitRoot) => {
      const file = await inspect(absolutePath, gitRoot);
      return {
        ...file,
        bytes: encoder.encode("entry\n"),
        governedText: "entry\n",
        isStable: true,
        lineCount: 1,
      };
    },
    inspect,
  };
}
export interface SignalBusVerificationPortOptions {
  readonly canonicalize?: (absolutePath: string) => string;
  readonly rootOutput?: string;
  readonly sourceExists?: boolean;
  readonly manifestExists?: boolean;
  readonly manifestChanges?: boolean;
  readonly manifestText?: string;
  readonly mergeBaseExitCode?: number;
  readonly entryStates?: readonly SignalBusSnapshotState[];
  readonly entryText?: string;
  readonly entrySnapshotStable?: boolean;
  readonly statusExitCode?: number;
}
export interface SignalBusSnapshotState {
  readonly identity: string;
  readonly isRegularFile: boolean;
  readonly exists: boolean;
}

const existingSignalBusSnapshot = {
  identity: `git:${signalBusFullIdentity}`,
  isRegularFile: true,
  exists: true,
} as const;
export function createSignalBusModifiedBaselinePort(
  entryText = "entry\n",
  finalState: SignalBusSnapshotState = existingSignalBusSnapshot,
): SignalBusMaterializationGitPort {
  return createSignalBusVerificationPort({
    manifestText: signalBusManifest([{ path: "governed/entry.ts", allowedOperation: "modify" }]),
    entryStates: [existingSignalBusSnapshot, finalState],
    entryText,
  });
}
export function createSignalBusVerificationPort(
  options: SignalBusVerificationPortOptions = {},
): SignalBusMaterializationGitPort {
  let entryInspections = 0;
  return {
    canonicalize: (absolutePath) =>
      Promise.resolve(
        options.canonicalize?.(absolutePath) ??
          (absolutePath.endsWith("signal-bus-materialization-verifier.ts")
            ? "/toolchain/scripts/tooling/signal-bus-materialization-verifier.ts"
            : absolutePath),
      ),
    run: (root, arguments_) => {
      if (arguments_[0] === "rev-parse" && arguments_[1] === "--show-toplevel")
        return Promise.resolve(signalBusGitOutput(options.rootOutput ?? root));
      if (arguments_[0] === "diff" && options.entryStates !== undefined)
        return Promise.resolve(
          signalBusGitOutput(
            (arguments_.includes("--raw") ? addedRaw : addedName).replaceAll("entry.ts", "governed/entry.ts"),
          ),
        );
      if (arguments_[0] === "status")
        return Promise.resolve(signalBusGitOutput("", options.statusExitCode ?? 0));
      if (["cat-file", "ls-files", "ls-tree"].includes(arguments_[0] ?? ""))
        return Promise.resolve(signalBusGitOutput(""));
      if (arguments_[0] === "rev-parse" && arguments_[1] === "HEAD")
        return Promise.resolve(signalBusGitOutput(signalBusVerificationBase));
      if (arguments_[0] === "merge-base")
        return Promise.resolve(signalBusGitOutput("", options.mergeBaseExitCode ?? 0));
      return Promise.resolve(signalBusGitOutput(""));
    },
    snapshot: (absolutePath) => {
      if (absolutePath.endsWith("signal-bus-materialization-verifier.ts"))
        return Promise.resolve({
          bytes: encoder.encode("source\n"),
          exists: options.sourceExists ?? true,
          identity: "source",
          isRegularFile: options.sourceExists ?? true,
          isStable: true,
        });
      if (absolutePath === "/manifest") {
        const manifestText = options.manifestText ?? signalBusVerificationManifest;
        const manifestLineCount = signalBusPhysicalLineCount(manifestText);
        return Promise.resolve({
          bytes: encoder.encode(manifestText),
          exists: options.manifestExists ?? true,
          governedText: manifestText,
          identity: options.manifestChanges ? "changed" : "manifest",
          isRegularFile: options.manifestExists ?? true,
          isStable: !options.manifestChanges,
          lineCount: manifestLineCount,
        });
      }
      if (absolutePath === "/candidate/governed/entry.ts") {
        const state = options.entryStates?.[entryInspections++] ?? {
          identity: "",
          isRegularFile: false,
          exists: false,
        };
        return Promise.resolve({
          ...state,
          bytes: encoder.encode(options.entryText ?? "entry\n"),
          governedText: options.entryText ?? "entry\n",
          isStable: options.entrySnapshotStable ?? true,
          lineCount: signalBusPhysicalLineCount(options.entryText ?? "entry\n"),
        });
      }
      return Promise.resolve({
        bytes: new Uint8Array(),
        exists: false,
        identity: "",
        isRegularFile: false,
        isStable: true,
      });
    },
    inspect: (absolutePath) => {
      if (absolutePath.endsWith("signal-bus-materialization-verifier.ts"))
        return Promise.resolve({
          identity: "source",
          isRegularFile: options.sourceExists ?? true,
          exists: options.sourceExists ?? true,
        });
      if (absolutePath === "/manifest")
        return Promise.resolve({
          identity: "manifest",
          isRegularFile: options.manifestExists ?? true,
          exists: options.manifestExists ?? true,
        });
      if (absolutePath === "/candidate/governed/entry.ts" && options.entryStates !== undefined)
        return Promise.resolve(
          options.entryStates[entryInspections++] ?? { identity: "", isRegularFile: false, exists: false },
        );
      return Promise.resolve({ identity: "", isRegularFile: false, exists: false });
    },
  };
}

export function signalBusVerificationRequest(
  overrides: Partial<SignalBusMaterializationVerificationRequest> = {},
): SignalBusMaterializationVerificationRequest {
  return {
    mode: "candidate",
    toolchainRoot: "/toolchain",
    candidateRoot: "/candidate",
    manifestPath: "/manifest",
    role: "active",
    base: signalBusVerificationBase,
    ...overrides,
  };
}

export function signalBusVerificationRequestWithoutBase(
  overrides: Partial<SignalBusMaterializationVerificationRequest> = {},
): Omit<SignalBusMaterializationVerificationRequest, "base"> {
  const { base: _base, ...request } = signalBusVerificationRequest(overrides);
  return request;
}

export function signalBusRepoVerificationRequest(
  mode: SignalBusMaterializationVerificationRequest["mode"],
  candidateRoot: string,
  manifestPath: string,
  base: string,
): SignalBusMaterializationVerificationRequest {
  return { mode, toolchainRoot: process.cwd(), candidateRoot, manifestPath, role: "active", base };
}

export async function runDirectSignalBusVerifier(
  arguments_: readonly string[],
): Promise<{ readonly exitCode: number | null; readonly stderr: string }> {
  return await runSignalBusProcess(["scripts/tooling/verify-signal-bus-materialization.ts", ...arguments_]);
}

export async function runBuiltDirectSignalBusVerifier(
  arguments_: readonly string[],
): Promise<{ readonly exitCode: number | null; readonly stderr: string }> {
  const directory = await mkdtemp(path.join(tmpdir(), "signal bus materialization-built-"));
  const executable = path.join(directory, "verify.mjs");
  try {
    const build = await runSignalBusProcess([
      "build",
      "scripts/tooling/verify-signal-bus-materialization.ts",
      "--target=bun",
      `--outfile=${executable}`,
    ]);
    if (build.exitCode !== 0) throw new Error("temporary-build-failure");
    return await runSignalBusProcess([executable, ...arguments_]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function runSignalBusProcess(
  arguments_: readonly string[],
): Promise<{ readonly exitCode: number | null; readonly stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn("bun", arguments_, { cwd: process.cwd() });
    const stderr: Uint8Array[] = [];
    child.stderr.on("data", (chunk: Uint8Array) => {
      stderr.push(chunk);
    });
    child.on("error", reject);
    child.on("close", (exitCode: number | null) => {
      resolve({ exitCode, stderr: Buffer.concat(stderr).toString("utf8") });
    });
  });
}

export interface TemporarySignalBusManifestFixture {
  readonly fixture: TemporarySignalBusRepo;
  readonly manifestPath: string;
  readonly dispose: () => Promise<void>;
}

export {
  createTemporarySignalBusRepo,
  type TemporarySignalBusRepo,
  writeTemporaryFile,
} from "./signal-bus-materialization-repo-test-support";

export async function writeSignalBusManifest(
  absolutePath: string,
  entries: readonly SignalBusManifestFixtureEntry[],
): Promise<void> {
  await writeTemporaryRepoFile(absolutePath, signalBusManifest(entries));
}

export async function createTemporarySignalBusManifestFixture(
  directoryPrefix: string,
): Promise<TemporarySignalBusManifestFixture> {
  const fixture = await createTemporarySignalBusRepoFixture();
  const directory = await mkdtemp(path.join(tmpdir(), directoryPrefix));
  return Object.freeze({
    fixture,
    manifestPath: path.join(directory, "manifest.json"),
    dispose: async () => {
      await fixture.dispose();
      await rm(directory, { recursive: true, force: true });
    },
  });
}
