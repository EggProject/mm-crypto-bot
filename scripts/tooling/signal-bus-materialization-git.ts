import { constants, type BigIntStats } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

import {
  type CanonicalMaterializationRecord,
  type SafeRepoRelativePath,
  VerificationFailure,
  toSafeRepoRelativePath,
} from "./signal-bus-materialization-contract";

export interface SignalBusMaterializationGitPort {
  canonicalize(absolutePath: string): Promise<string>;
  run(
    root: string,
    arguments_: readonly string[],
    input?: Uint8Array,
  ): Promise<{ readonly stdout: Uint8Array; readonly stderr: string; readonly exitCode: number | null }>;
  snapshot(absolutePath: string, gitRoot?: string): Promise<SignalBusMaterializationFileSnapshot>;
  inspect(
    absolutePath: string,
    gitRoot?: string,
  ): Promise<{ readonly identity: string; readonly isRegularFile: boolean; readonly exists: boolean }>;
}

export interface SignalBusMaterializationFileSnapshot {
  readonly bytes: Uint8Array;
  readonly exists: boolean;
  readonly governedText?: string;
  readonly identity: string;
  readonly isRegularFile: boolean;
  readonly isStable: boolean;
  readonly lineCount?: number;
}

export interface NodeSignalBusMaterializationPortOptions {
  readonly afterRead?: (absolutePath: string) => Promise<void>;
}

interface RawDiffRecord {
  readonly path: SafeRepoRelativePath;
}

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

function isolatedGitEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  };
  for (const name of neutralGitEnvironmentNames) {
    // eslint-disable-next-line security/detect-object-injection -- The key comes from the closed neutral allowlist above.
    const value = process.env[name];
    // eslint-disable-next-line security/detect-object-injection -- The key comes from the closed neutral allowlist above.
    if (value !== undefined) environment[name] = value;
  }
  return environment;
}

function fail(code: string): never {
  throw new VerificationFailure(code, `signal-bus-materialization:${code}`);
}

function nulTokens(stdout: Uint8Array): readonly string[] {
  if (stdout.length === 0) return [];
  if (stdout.at(-1) !== 0) return fail("git-nul-record");
  return new TextDecoder("utf-8", { fatal: true }).decode(stdout).slice(0, -1).split("\0");
}

export function hasPorcelainStatusChanges(stdout: Uint8Array): boolean {
  if (stdout.length === 0) return false;
  const tokens = nulTokens(stdout);
  for (let index = 0; index < tokens.length;) {
    const record = requiredToken(tokens, index++, "git-status-arity");
    if (!/^[ MADRCU?!][ MADRCU?!] .+$/u.test(record)) fail("git-status-record");
    toSafeRepoRelativePath(record.slice(3));
    if (record.startsWith("R") || record.startsWith("C")) {
      toSafeRepoRelativePath(requiredToken(tokens, index++, "git-status-arity"));
    }
  }
  return true;
}

function requiredToken(tokens: readonly string[], index: number, code: string): string {
  const token = tokens.at(index);
  if (typeof token !== "string") return fail(code);
  return token;
}

function parseStatus(status: string): "A" | "M" | "D" {
  if (status.startsWith("R") || status.startsWith("C")) return fail("rename-or-copy");
  switch (status) {
    case "A": {
      return status;
    }
    case "M": {
      return status;
    }
    case "D": {
      return status;
    }
    default: {
      return fail("git-status");
    }
  }
}

export function parseNameStatusGitDiff(stdout: Uint8Array): readonly SafeRepoRelativePath[] {
  const tokens = nulTokens(stdout);
  const paths: SafeRepoRelativePath[] = [];
  for (let index = 0; index < tokens.length;) {
    const status = requiredToken(tokens, index++, "git-name-status-arity");
    parseStatus(status);
    const path = requiredToken(tokens, index++, "git-name-status-arity");
    paths.push(toSafeRepoRelativePath(path));
  }
  return paths;
}

export function parseRawGitDiff(stdout: Uint8Array): readonly RawDiffRecord[] {
  const tokens = nulTokens(stdout);
  const records: RawDiffRecord[] = [];
  for (let index = 0; index < tokens.length;) {
    const header = requiredToken(tokens, index++, "git-raw-arity");
    const match = /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40}|0{40}) ([0-9a-f]{40}|0{40}) ([A-Z][0-9]*)$/u.exec(
      header,
    );
    if (match === null) return fail("git-raw-header");
    const status = header.slice(header.lastIndexOf(" ") + 1);
    parseStatus(status);
    if (match[1] !== match[2] && match[3] === match[4]) return fail("mode-only");
    const path = requiredToken(tokens, index++, "git-raw-arity");
    records.push({ path: toSafeRepoRelativePath(path) });
  }
  return records;
}

async function runChecked(
  port: SignalBusMaterializationGitPort,
  root: string,
  arguments_: readonly string[],
): Promise<Uint8Array> {
  const result = await port.run(root, arguments_);
  if (result.exitCode !== 0) fail("git-command");
  return result.stdout;
}

async function collectDiffPaths(
  port: SignalBusMaterializationGitPort,
  root: string,
  arguments_: readonly string[],
): Promise<readonly SafeRepoRelativePath[]> {
  const rawArguments = [
    "diff",
    "--raw",
    "-z",
    "--no-abbrev",
    "--find-renames",
    "--find-copies",
    "--find-copies-harder",
    ...arguments_,
  ];
  const nameArguments = [
    "diff",
    "--name-status",
    "-z",
    "--no-abbrev",
    "--find-renames",
    "--find-copies",
    "--find-copies-harder",
    ...arguments_,
  ];
  const raw = parseRawGitDiff(await runChecked(port, root, rawArguments)).map((record) => record.path);
  const names = parseNameStatusGitDiff(await runChecked(port, root, nameArguments));
  if (raw.length !== names.length || raw.some((path, index) => path !== names.at(index)))
    fail("git-diff-mismatch");
  return raw;
}

async function baseBlob(
  port: SignalBusMaterializationGitPort,
  root: string,
  base: string,
  path: SafeRepoRelativePath,
): Promise<string | undefined> {
  const output = await runChecked(port, root, ["ls-tree", "-z", "--abbrev=40", base, "--", path]);
  if (output.length === 0) return undefined;
  const tokens = nulTokens(output);
  if (tokens.length !== 1) return fail("git-tree-arity");
  const token = tokens.join("");
  const separator = token.indexOf("\t");
  const header = token.slice(0, separator);
  const observedPath = token.slice(separator + 1);
  const match = /^(100644|100755) blob ([a-f0-9]{40})$/u.exec(header);
  if (separator === -1 || match === null || observedPath !== path) return fail("git-tree-entry");
  return `git:${header.slice(-40)}`;
}

function toFinalRecord(
  path: SafeRepoRelativePath,
  baseIdentity: string | undefined,
  finalIdentity: string | undefined,
): CanonicalMaterializationRecord | undefined {
  if (baseIdentity === undefined) {
    return finalIdentity === undefined ? undefined : { operation: "A", path, blobIdentity: finalIdentity };
  }
  if (finalIdentity === undefined) return { operation: "D", path, blobIdentity: "absent" };
  return baseIdentity === finalIdentity ? undefined : { operation: "M", path, blobIdentity: finalIdentity };
}

export async function collectCandidateMaterialization(
  port: SignalBusMaterializationGitPort,
  candidateRoot: string,
  base: string,
): Promise<readonly CanonicalMaterializationRecord[]> {
  const all = new Set<SafeRepoRelativePath>();
  const diffArgumentSets = [[`${base}..HEAD`], ["--cached"], []];
  for (const arguments_ of diffArgumentSets) {
    const paths = await collectDiffPaths(port, candidateRoot, arguments_);
    for (const path of paths) all.add(path);
  }
  const untracked = nulTokens(
    await runChecked(port, candidateRoot, ["ls-files", "--others", "--exclude-standard", "-z"]),
  );
  for (const path of untracked) all.add(toSafeRepoRelativePath(path));
  const records: CanonicalMaterializationRecord[] = [];
  // eslint-disable-next-line unicorn/no-array-sort -- ES2022 has no non-mutating Array sort.
  const orderedPaths = [...all].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  for (const path of orderedPaths) {
    const final = await port.snapshot(`${candidateRoot}/${path}`, candidateRoot);
    if (!final.isStable) fail("file-mutated");
    if (final.exists && !final.isRegularFile) fail("non-regular-final");
    const finalIdentity = final.exists ? final.identity : undefined;
    if (finalIdentity !== undefined && !/^git:[a-f0-9]{40}$/u.test(finalIdentity)) fail("git-final-identity");
    if (final.exists) {
      if (final.governedText === undefined || final.lineCount === undefined) fail("governed-text");
      if (final.lineCount > 500) fail("line-limit");
    }
    const record = toFinalRecord(path, await baseBlob(port, candidateRoot, base, path), finalIdentity);
    if (record !== undefined) records.push(record);
  }
  return records;
}

export function validateStrictGovernedText(bytes: Uint8Array): string {
  const text = strictGovernedText(bytes);
  return text ?? fail("governed-text");
}

function strictGovernedText(bytes: Uint8Array): string | undefined {
  for (const byte of bytes) {
    if (byte !== 9 && byte !== 10 && byte !== 13 && byte < 32) return undefined;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

function physicalLineCount(text: string): number {
  return text.length === 0 ? 0 : text.split(/\r\n|\n|\r/u).length - (/(\r\n|\n|\r)$/u.test(text) ? 1 : 0);
}

async function treeBlob(
  port: SignalBusMaterializationGitPort,
  root: string,
  commit: string,
  path: SafeRepoRelativePath,
): Promise<string | undefined> {
  return await baseBlob(port, root, commit, path);
}

export async function readCommitTreeText(
  port: SignalBusMaterializationGitPort,
  root: string,
  commit: string,
  path: SafeRepoRelativePath,
): Promise<Uint8Array | undefined> {
  if ((await treeBlob(port, root, commit, path)) === undefined) return undefined;
  return await runChecked(port, root, ["show", "--no-textconv", `${commit}:${path}`]);
}

export async function collectCommitMaterialization(
  port: SignalBusMaterializationGitPort,
  candidateRoot: string,
  parents: readonly string[] | string,
  commit: string,
): Promise<readonly CanonicalMaterializationRecord[]> {
  const materialization = await collectCommitMaterializationDetail(port, candidateRoot, parents, commit);
  return materialization.records;
}

export interface CommitMaterializationDetail {
  readonly records: readonly CanonicalMaterializationRecord[];
  readonly touchedPaths: readonly SafeRepoRelativePath[];
}

function sortedRepoPaths(paths: Iterable<SafeRepoRelativePath>): SafeRepoRelativePath[] {
  const orderedPaths: SafeRepoRelativePath[] = [];
  for (const path of paths) {
    const index = orderedPaths.findIndex(
      (candidate) => Buffer.compare(Buffer.from(candidate), Buffer.from(path)) > 0,
    );
    if (index === -1) {
      orderedPaths.push(path);
      continue;
    }
    orderedPaths.splice(index, 0, path);
  }
  return orderedPaths;
}

export async function collectCommitMaterializationDetail(
  port: SignalBusMaterializationGitPort,
  candidateRoot: string,
  parents: readonly string[] | string,
  commit: string,
): Promise<CommitMaterializationDetail> {
  const parentList = typeof parents === "string" ? [parents] : parents;
  if (parentList.length === 0) fail("git-parents");
  const paths = new Set<SafeRepoRelativePath>();
  for (const parent of parentList) {
    const parentDiffPaths = await collectDiffPaths(port, candidateRoot, [parent, commit]);
    for (const path of parentDiffPaths) paths.add(path);
  }
  const records: CanonicalMaterializationRecord[] = [];
  const orderedPaths = sortedRepoPaths(paths);
  for (const path of orderedPaths) {
    const [final, ...states] = await Promise.all([
      treeBlob(port, candidateRoot, commit, path),
      ...parentList.map(async (parent) => await treeBlob(port, candidateRoot, parent, path)),
    ]);
    if (states.includes(final)) continue;
    const areAllAbsent = states.every((state) => state === undefined);
    const record =
      final === undefined
        ? { operation: "D" as const, path, blobIdentity: "absent" }
        : areAllAbsent
          ? { operation: "A" as const, path, blobIdentity: final }
          : { operation: "M" as const, path, blobIdentity: final };
    records.push(record);
  }
  return Object.freeze({ records: Object.freeze(records), touchedPaths: Object.freeze(orderedPaths) });
}

async function spawnGit(
  root: string,
  arguments_: readonly string[],
  input?: Uint8Array,
): Promise<{ readonly stdout: Uint8Array; readonly stderr: string; readonly exitCode: number | null }> {
  return await new Promise((resolve, reject) => {
    const child = spawn("git", arguments_, {
      cwd: root,
      env: isolatedGitEnvironment(),
    });
    const stdout: Uint8Array[] = [];
    const stderr: Uint8Array[] = [];
    child.stdout.on("data", (chunk: Uint8Array) => {
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Uint8Array) => {
      stderr.push(chunk);
    });
    child.on("error", reject);
    child.on("close", (exitCode: number | null) => {
      resolve({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString("utf8"), exitCode });
    });
    child.stdin.end(input);
  });
}

async function rejectSymlinkComponents(absolutePath: string): Promise<void> {
  const parsed = path.parse(absolutePath);
  let current = parsed.root;
  const components = absolutePath.slice(parsed.root.length).split(path.sep).filter(Boolean);
  for (const part of components) {
    current = path.join(current, part);
    const filesystem = await import("node:fs/promises");
    let metadata: Awaited<ReturnType<typeof filesystem.lstat>>;
    try {
      metadata = await filesystem.lstat(pathToFileURL(current));
    } catch {
      return;
    }
    if (metadata.isSymbolicLink()) fail("symlink-component");
  }
}

async function snapshot(
  absolutePath: string,
  gitRoot = process.cwd(),
  afterRead?: (absolutePath: string) => Promise<void>,
): Promise<SignalBusMaterializationFileSnapshot> {
  await rejectSymlinkComponents(absolutePath);
  const filesystem = await import("node:fs/promises");
  let handle: Awaited<ReturnType<typeof filesystem.open>>;
  try {
    handle = await filesystem.open(pathToFileURL(absolutePath), constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return { bytes: new Uint8Array(), exists: false, identity: "", isRegularFile: false, isStable: true };
    return fail("file-snapshot");
  }
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile())
      return { bytes: new Uint8Array(), exists: true, identity: "", isRegularFile: false, isStable: true };
    const bytes = await handle.readFile();
    const text = strictGovernedText(bytes);
    await afterRead?.(absolutePath);
    const after = await handle.stat({ bigint: true });
    const isStable = isStableFileIdentity(before, after);
    const result = await spawnGit(gitRoot, ["hash-object", "--stdin"], bytes);
    const identity = new TextDecoder("utf-8", { fatal: true }).decode(result.stdout).trim();
    if (!/^[a-f0-9]{40}$/u.test(identity)) fail("git-final-identity");
    const stableSnapshot = {
      bytes,
      exists: true,
      identity: `git:${identity}`,
      isRegularFile: true,
      isStable,
    };
    return text === undefined
      ? stableSnapshot
      : { ...stableSnapshot, governedText: text, lineCount: physicalLineCount(text) };
  } finally {
    await handle.close();
  }
}

function isStableFileIdentity(before: BigIntStats, after: BigIntStats): boolean {
  return (
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.mtimeNs === after.mtimeNs &&
    before.ctimeNs === after.ctimeNs
  );
}

export function createNodeSignalBusMaterializationPort(
  options: NodeSignalBusMaterializationPortOptions = {},
): SignalBusMaterializationGitPort {
  return Object.freeze({
    canonicalize: async (absolutePath: string) => {
      await rejectSymlinkComponents(absolutePath);
      const filesystem = await import("node:fs/promises");
      return await filesystem.realpath(pathToFileURL(absolutePath));
    },
    run: spawnGit,
    snapshot: async (absolutePath: string, gitRoot = process.cwd()) =>
      await snapshot(absolutePath, gitRoot, options.afterRead),
    inspect: async (absolutePath: string, gitRoot = process.cwd()) => {
      const file = await snapshot(absolutePath, gitRoot, options.afterRead);
      return { identity: file.identity, isRegularFile: file.isRegularFile, exists: file.exists };
    },
  });
}

export const nodeSignalBusMaterializationPort = createNodeSignalBusMaterializationPort();
