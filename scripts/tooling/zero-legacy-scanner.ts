import { execFile } from "node:child_process";
import path from "node:path";

import { zeroLegacyScannerConfig, type ZeroLegacyScannerConfig } from "./zero-legacy-config.ts";
import {
  evaluateZeroLegacyContract,
  type ZeroLegacyEvaluation,
  type ZeroLegacySemanticEntry,
} from "./zero-legacy-contract.ts";
import { extractZeroLegacySemanticEntries } from "./zero-legacy-extractors.ts";
import {
  createZeroLegacySecureIo,
  type ZeroLegacySecureIo,
  type ZeroLegacySecurePathKind,
  type ZeroLegacySecurePathMetadata,
} from "./zero-legacy-secure-io.ts";

export const zeroLegacyScanResultSchemaVersion = "zero-legacy-scan-result@1" as const;

export type ZeroLegacyPathKind = ZeroLegacySecurePathKind;
export type ZeroLegacyPathMetadata = ZeroLegacySecurePathMetadata;

export interface ZeroLegacyNodeDependencies {
  readonly execFile: (
    file: string,
    arguments_: readonly string[],
    options: Readonly<{ encoding: "utf8" }>,
    callback: (error: Error | undefined, stdout: string) => void,
  ) => void;
  readonly secureIo: ZeroLegacySecureIo;
  readonly writeStderr: (message: string) => void;
  readonly writeStdout: (message: string) => void;
}

export interface ZeroLegacyScannerPort {
  readonly canonicalize: (absolutePath: string) => Promise<string>;
  readonly getGitTopLevel: (absolutePath: string) => Promise<string>;
  readonly inspectPath: (
    repoRoot: string,
    absolutePath: string,
  ) => Promise<ZeroLegacyPathMetadata | undefined>;
  readonly readDirectory: (
    repoRoot: string,
    absolutePath: string,
    expectedIdentity?: string,
  ) => Promise<readonly string[]>;
  readonly readUtf8: (repoRoot: string, absolutePath: string, expectedIdentity?: string) => Promise<string>;
  readonly writeStderr: (message: string) => void;
  readonly writeStdout: (message: string) => void;
}

export interface ZeroLegacyScanResult extends Omit<ZeroLegacyEvaluation, "schemaVersion"> {
  readonly schemaVersion: typeof zeroLegacyScanResultSchemaVersion;
  readonly scannerSchemaVersion: ZeroLegacyScannerConfig["schemaVersion"];
}

export interface ZeroLegacyScannerCliResult {
  readonly exitCode: 1 | 2;
  readonly result: ZeroLegacyScanResult;
}

const scanDiagnosticPath = "package.json";

function getGitTopLevel(
  absolutePath: string,
  executeFile: ZeroLegacyNodeDependencies["execFile"],
): Promise<string> {
  return new Promise((resolve, reject) => {
    executeFile(
      "git",
      ["-C", absolutePath, "rev-parse", "--show-toplevel"],
      { encoding: "utf8" },
      (error, stdout) => {
        if (error !== undefined) {
          reject(new Error("Git top-level could not be resolved", { cause: error }));
          return;
        }
        resolve(stdout.trim());
      },
    );
  });
}

const unsealedDefaultNodeDependencies: ZeroLegacyNodeDependencies = {
  execFile: (file, arguments_, options, callback) => {
    execFile(file, arguments_, options, (error, stdout) => {
      callback(error ?? undefined, stdout);
    });
  },
  secureIo: createZeroLegacySecureIo(),
  writeStderr: (message) => process.stderr.write(message),
  writeStdout: (message) => process.stdout.write(message),
};

const defaultNodeDependencies: ZeroLegacyNodeDependencies = Object.freeze(unsealedDefaultNodeDependencies);

export function createNodeZeroLegacyScannerPort(
  dependencies: Partial<ZeroLegacyNodeDependencies> = {},
): ZeroLegacyScannerPort {
  const resolvedDependencies: ZeroLegacyNodeDependencies = { ...defaultNodeDependencies, ...dependencies };
  return Object.freeze({
    canonicalize: resolvedDependencies.secureIo.canonicalize,
    getGitTopLevel: (absolutePath: string) => getGitTopLevel(absolutePath, resolvedDependencies.execFile),
    inspectPath: resolvedDependencies.secureIo.inspectPath,
    readDirectory: resolvedDependencies.secureIo.readDirectory,
    readUtf8: resolvedDependencies.secureIo.readUtf8,
    writeStderr: resolvedDependencies.writeStderr,
    writeStdout: resolvedDependencies.writeStdout,
  });
}

const nodePort = createNodeZeroLegacyScannerPort();

const isSafeRelativePath = (relativePath: string): boolean =>
  relativePath.length > 0 &&
  !relativePath.startsWith("/") &&
  !relativePath.includes("\\") &&
  relativePath.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");

const isSimpleDirectoryName = (name: string): boolean =>
  name.length > 0 && name !== "." && name !== ".." && !name.includes("/") && !name.includes("\\");

function sortedStrings(values: readonly string[]): readonly string[] {
  const ordered: string[] = [];
  for (const value of values) {
    const insertionIndex = ordered.findIndex((candidate) => candidate.localeCompare(value) > 0);
    ordered.splice(insertionIndex === -1 ? ordered.length : insertionIndex, 0, value);
  }
  return Object.freeze(ordered);
}

const diagnosticEntry = (
  signal: "unreadable-target" | "legacy-file",
  location: string,
): ZeroLegacySemanticEntry => Object.freeze({ signal, path: scanDiagnosticPath, location });

const freezeResult = (evaluation: ZeroLegacyEvaluation): ZeroLegacyScanResult =>
  Object.freeze({
    schemaVersion: zeroLegacyScanResultSchemaVersion,
    scannerSchemaVersion: evaluation.schemaVersion,
    catalogCompleteness: evaluation.catalogCompleteness,
    incompleteReasons: Object.freeze([...evaluation.incompleteReasons]),
    status: evaluation.status,
    findings: Object.freeze(evaluation.findings.map((finding) => Object.freeze({ ...finding }))),
  });

const isEvidencePath = (relativePath: string, config: ZeroLegacyScannerConfig): boolean =>
  config.evidenceOnlyPaths.includes(relativePath) ||
  config.evidenceOnlyPrefixes.some((prefix) => relativePath.startsWith(prefix));

const isExcludedPath = (relativePath: string, config: ZeroLegacyScannerConfig): boolean => {
  const hasExcludedDirectory = relativePath
    .split("/")
    .some((segment) => config.excludedDirectoryNames.includes(segment));
  return (
    hasExcludedDirectory ||
    config.excludedPathPrefixes.some((prefix) => {
      const exactPath = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
      return relativePath === exactPath || relativePath.startsWith(prefix);
    })
  );
};

const toSafeTarget = (repoRoot: string, relativePath: string): string | undefined =>
  isSafeRelativePath(relativePath) ? path.resolve(repoRoot, relativePath) : undefined;

const hasSupportedSemanticExtension = (relativePath: string): boolean =>
  /\.(?:[cm]?[jt]sx?|json|toml|mdx?|html?|bash|sh|ya?ml)$/iu.test(relativePath);

async function scanRegularFile(
  repoRoot: string,
  absolutePath: string,
  relativePath: string,
  metadata: ZeroLegacyPathMetadata,
  entries: ZeroLegacySemanticEntry[],
  port: ZeroLegacyScannerPort,
  config: ZeroLegacyScannerConfig,
): Promise<void> {
  if (isEvidencePath(relativePath, config) || !hasSupportedSemanticExtension(relativePath)) {
    return;
  }
  try {
    entries.push(
      ...extractZeroLegacySemanticEntries(
        relativePath,
        await port.readUtf8(repoRoot, absolutePath, metadata.identity),
        config,
      ),
    );
  } catch {
    entries.push(diagnosticEntry("unreadable-target", `${relativePath}:read`));
  }
}

async function traverseTarget(
  repoRoot: string,
  relativePath: string,
  entries: ZeroLegacySemanticEntry[],
  visitedPaths: Set<string>,
  port: ZeroLegacyScannerPort,
  config: ZeroLegacyScannerConfig,
): Promise<void> {
  if (visitedPaths.has(relativePath)) {
    return;
  }
  visitedPaths.add(relativePath);
  if (isExcludedPath(relativePath, config)) {
    return;
  }
  const absolutePath = toSafeTarget(repoRoot, relativePath);
  if (absolutePath === undefined) {
    entries.push(diagnosticEntry("unreadable-target", `${relativePath}:unsafe-path`));
    return;
  }
  let metadata: ZeroLegacyPathMetadata | undefined;
  try {
    metadata = await port.inspectPath(repoRoot, absolutePath);
  } catch {
    entries.push(diagnosticEntry("unreadable-target", `${relativePath}:path`));
    return;
  }
  if (metadata === undefined) {
    return;
  }
  if (metadata.kind === "file") {
    entries.push(Object.freeze({ signal: "legacy-file", path: relativePath, location: `${relativePath}:0` }));
    await scanRegularFile(repoRoot, absolutePath, relativePath, metadata, entries, port, config);
    return;
  }
  if (metadata.kind !== "directory") {
    entries.push(diagnosticEntry("unreadable-target", `${relativePath}:path`));
    return;
  }
  if (config.terminalAbsentPaths.includes(relativePath)) {
    entries.push(
      Object.freeze({ signal: "legacy-directory", path: relativePath, location: `${relativePath}:0` }),
    );
  }
  let names: readonly string[];
  try {
    names = await port.readDirectory(repoRoot, absolutePath, metadata.identity);
  } catch {
    entries.push(diagnosticEntry("unreadable-target", `${relativePath}:readdir`));
    return;
  }
  for (const name of sortedStrings(names)) {
    if (!isSimpleDirectoryName(name)) {
      entries.push(diagnosticEntry("unreadable-target", `${relativePath}:unsafe-child`));
      continue;
    }
    await traverseTarget(repoRoot, `${relativePath}/${name}`, entries, visitedPaths, port, config);
  }
}

function hasUnsafeFinding(result: ZeroLegacyScanResult): boolean {
  return result.findings.some(
    (finding) => finding.category === "unsafe-path" || finding.category === "unreadable-target",
  );
}

export async function scanRepoForLegacyReferences(
  repoRoot: string,
  port: ZeroLegacyScannerPort = nodePort,
  config: ZeroLegacyScannerConfig = zeroLegacyScannerConfig,
): Promise<ZeroLegacyScanResult> {
  const entries: ZeroLegacySemanticEntry[] = [];
  if (!path.isAbsolute(repoRoot)) {
    entries.push(diagnosticEntry("unreadable-target", "repository-root:not-absolute"));
    return freezeResult(evaluateZeroLegacyContract(entries, config));
  }
  let canonicalRoot: string;
  try {
    canonicalRoot = await port.canonicalize(repoRoot);
    const canonicalGitRoot = await port.canonicalize(await port.getGitTopLevel(canonicalRoot));
    if (canonicalRoot !== canonicalGitRoot) {
      throw new Error("Repository root is not the Git top-level");
    }
    const rootMetadata = await port.inspectPath(canonicalRoot, canonicalRoot);
    if (rootMetadata?.kind !== "directory") {
      throw new Error("Repository root is not a directory");
    }
  } catch {
    entries.push(diagnosticEntry("unreadable-target", "repository-root:verification"));
    return freezeResult(evaluateZeroLegacyContract(entries, config));
  }
  const inventory = sortedStrings([
    ...new Set([...config.declaredInventoryRoots, ...config.terminalAbsentPaths]),
  ]);
  const visitedPaths = new Set<string>();
  for (const inventoryRoot of inventory) {
    await traverseTarget(canonicalRoot, inventoryRoot, entries, visitedPaths, port, config);
  }
  return freezeResult(evaluateZeroLegacyContract(entries, config));
}

export async function runZeroLegacyScannerCli(
  cliArguments: readonly string[],
  port: ZeroLegacyScannerPort = nodePort,
): Promise<ZeroLegacyScannerCliResult> {
  const repoRoot =
    cliArguments.length === 2 && cliArguments[0] === "--repository-root" ? cliArguments[1] : undefined;
  const result = await scanRepoForLegacyReferences(repoRoot ?? "", port);
  const exitCode: 1 | 2 = hasUnsafeFinding(result) || result.status === "incomplete" ? 2 : 1;
  port.writeStdout(`${JSON.stringify(result)}\n`);
  if (exitCode === 2 && result.findings.length > 0) {
    port.writeStderr("zero-legacy scanner could not safely complete\n");
  }
  return Object.freeze({ exitCode, result });
}
