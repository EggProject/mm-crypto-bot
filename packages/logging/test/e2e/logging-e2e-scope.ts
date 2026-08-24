import { readdirSync } from "node:fs";
// eslint-disable-next-line unicorn/import-style -- Bun's node:path declaration only exposes typed named imports under the E2E project's configured type roots.
import { isAbsolute, relative, resolve, sep } from "node:path";

import {
  assertSafeDirectoryPathWithinRoot,
  assertSafeExistingFileWithinRoot,
} from "./logging-e2e-path-boundary.ts";
import { readVerifiedRegularFile } from "./logging-e2e-secure-file-reader.ts";

export const REPOSITORY_ROOT = resolve(import.meta.dirname, "../../../..");
export const LOGGING_DIRECTORY = resolve(REPOSITORY_ROOT, "packages/logging");
export const LOGGING_SOURCE_DIRECTORY = resolve(LOGGING_DIRECTORY, "src");
export const MANIFEST_PATH = resolve(LOGGING_DIRECTORY, "coverage-e2e-scope.json");

const SOURCE_PREFIX = "packages/logging/src/";
const TEST_SOURCE_SUFFIX = ".test.ts";
const TYPESCRIPT_SOURCE_SUFFIX = ".ts";
const CASE_SEGMENT_PATTERN = /^[a-z0-9]+$/u;

export interface LoggingEndToEndScopeManifest {
  readonly schemaVersion: 1;
  readonly runtimeFiles: readonly string[];
  readonly e2eCases: readonly string[];
}

interface LoggingScopeDirectoryEntry {
  readonly name: string;
  isSymbolicLink(): boolean;
  isDirectory(): boolean;
  isFile(): boolean;
}

interface LoggingScopeDiscoveryPort {
  readonly readDirectory: (directory: string) => readonly LoggingScopeDirectoryEntry[];
  readonly assertDirectory: (path: string, root: string, label: string) => void;
  readonly assertFile: (path: string, root: string, label: string) => void;
}

interface ParseLoggingEndToEndScopeManifestOptions {
  readonly areFilesRequired?: boolean;
  readonly discoveryPort?: LoggingScopeDiscoveryPort;
}

const defaultLoggingScopeDiscoveryPort: LoggingScopeDiscoveryPort = {
  readDirectory: (directory) =>
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- The source directory has just passed canonical containment and no-symlink checks.
    readdirSync(directory, { withFileTypes: true }),
  assertDirectory: assertSafeDirectoryPathWithinRoot,
  assertFile: assertSafeExistingFileWithinRoot,
};

function assertPlainObject(candidate: unknown, label: string): asserts candidate is Record<string, unknown> {
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error(`${label} must be a JSON object.`);
  }
}

function assertExactKeys(
  candidate: Record<string, unknown>,
  expectedKeys: readonly string[],
  label: string,
): void {
  if (
    Object.keys(candidate).length !== expectedKeys.length ||
    expectedKeys.some((expectedKey) => !Object.hasOwn(candidate, expectedKey))
  ) {
    throw new Error(`${label} must contain exactly: ${expectedKeys.join(", ")}.`);
  }
}

function validateRepoRelativePath(candidate: unknown, label: string): string {
  if (typeof candidate !== "string" || candidate.length === 0) {
    throw new Error(`${label} must contain non-empty strings.`);
  }
  if (isAbsolute(candidate) || candidate.includes("\\") || candidate.split("/").includes("..")) {
    throw new Error(`${label} contains an unsafe path: ${candidate}.`);
  }
  return candidate;
}

function orderDirectoryEntries(
  entries: readonly LoggingScopeDirectoryEntry[],
): readonly LoggingScopeDirectoryEntry[] {
  let orderedEntries: readonly LoggingScopeDirectoryEntry[] = [];
  for (const entry of entries) {
    const insertAt = orderedEntries.findIndex((current) => current.name.localeCompare(entry.name) > 0);
    orderedEntries =
      insertAt === -1
        ? [...orderedEntries, entry]
        : [...orderedEntries.slice(0, insertAt), entry, ...orderedEntries.slice(insertAt)];
  }
  return orderedEntries;
}

function discoverRuntimeFilesRecursively(
  directory: string,
  discoveryPort: LoggingScopeDiscoveryPort,
): readonly string[] {
  discoveryPort.assertDirectory(directory, LOGGING_SOURCE_DIRECTORY, "Logging runtime source directory");
  const discoveredFiles: string[] = [];
  const directoryEntries = orderDirectoryEntries(discoveryPort.readDirectory(directory));
  for (const directoryEntry of directoryEntries) {
    const absolutePath = resolve(directory, directoryEntry.name);
    if (directoryEntry.isSymbolicLink()) {
      throw new Error(`Logging runtime source must not contain symbolic links: ${absolutePath}.`);
    }
    if (directoryEntry.isDirectory()) {
      discoveredFiles.push(...discoverRuntimeFilesRecursively(absolutePath, discoveryPort));
      continue;
    }
    if (!directoryEntry.isFile()) continue;
    discoveryPort.assertFile(absolutePath, LOGGING_SOURCE_DIRECTORY, "Logging runtime source file");
    const repoPath = relative(REPOSITORY_ROOT, absolutePath).split(sep).join("/");
    if (repoPath.endsWith(TYPESCRIPT_SOURCE_SUFFIX) && !repoPath.endsWith(TEST_SOURCE_SUFFIX)) {
      discoveredFiles.push(repoPath);
    }
  }
  return discoveredFiles;
}

function validateRuntimeFiles(
  candidate: unknown,
  areFilesRequired: boolean,
  discoveryPort: LoggingScopeDiscoveryPort,
): readonly string[] {
  if (!Array.isArray(candidate) || candidate.length === 0) {
    throw new Error("runtimeFiles must be a non-empty array.");
  }
  const seenPaths = new Set<string>();
  const runtimeFiles = candidate.map((file): string => {
    const repoPath = validateRepoRelativePath(file, "runtimeFiles");
    if (!repoPath.startsWith(SOURCE_PREFIX) || !repoPath.endsWith(TYPESCRIPT_SOURCE_SUFFIX)) {
      throw new Error(`runtimeFiles contains a non-runtime logging source: ${repoPath}.`);
    }
    if (repoPath.endsWith(TEST_SOURCE_SUFFIX)) {
      throw new Error(`runtimeFiles must not contain a test source: ${repoPath}.`);
    }
    if (seenPaths.has(repoPath)) {
      throw new Error(`runtimeFiles contains a duplicate path: ${repoPath}.`);
    }
    seenPaths.add(repoPath);
    const absolutePath = resolve(REPOSITORY_ROOT, repoPath);
    if (areFilesRequired) {
      assertSafeExistingFileWithinRoot(absolutePath, LOGGING_SOURCE_DIRECTORY, "Logging runtime source file");
    }
    return repoPath;
  });
  const discoveredFiles = discoverRuntimeFilesRecursively(LOGGING_SOURCE_DIRECTORY, discoveryPort);
  if (
    runtimeFiles.length !== discoveredFiles.length ||
    runtimeFiles.some((runtimeFile) => !discoveredFiles.includes(runtimeFile))
  ) {
    throw new Error(
      `runtimeFiles must exactly equal the recursively discovered logging source scope. Expected: ${discoveredFiles.join(", ")}.`,
    );
  }
  return runtimeFiles;
}

function isEndToEndCaseIdentifier(candidate: string): boolean {
  return candidate.split("-").every((segment) => CASE_SEGMENT_PATTERN.test(segment));
}

function validateEndToEndCases(candidate: unknown): readonly string[] {
  if (!Array.isArray(candidate) || candidate.length === 0) {
    throw new Error("e2eCases must be a non-empty array.");
  }
  const seenCaseIds = new Set<string>();
  return candidate.map((caseId): string => {
    if (typeof caseId !== "string" || !isEndToEndCaseIdentifier(caseId)) {
      throw new Error(`e2eCases contains an invalid case ID: ${String(caseId)}.`);
    }
    if (seenCaseIds.has(caseId)) throw new Error(`e2eCases contains a duplicate case ID: ${caseId}.`);
    seenCaseIds.add(caseId);
    return caseId;
  });
}

export function parseLoggingEndToEndScopeManifest(
  candidate: unknown,
  {
    areFilesRequired = true,
    discoveryPort = defaultLoggingScopeDiscoveryPort,
  }: ParseLoggingEndToEndScopeManifestOptions = {},
): LoggingEndToEndScopeManifest {
  assertPlainObject(candidate, "logging E2E coverage manifest");
  assertExactKeys(candidate, ["schemaVersion", "runtimeFiles", "e2eCases"], "logging E2E coverage manifest");
  if (candidate["schemaVersion"] !== 1) {
    throw new Error("logging E2E coverage manifest schemaVersion must equal 1.");
  }
  return {
    schemaVersion: 1,
    runtimeFiles: validateRuntimeFiles(candidate["runtimeFiles"], areFilesRequired, discoveryPort),
    e2eCases: validateEndToEndCases(candidate["e2eCases"]),
  };
}

export function loadLoggingEndToEndScopeManifest(path = MANIFEST_PATH): LoggingEndToEndScopeManifest {
  let parsedManifest: unknown;
  try {
    parsedManifest = JSON.parse(
      new TextDecoder().decode(
        readVerifiedRegularFile(path, LOGGING_DIRECTORY, "Logging E2E coverage manifest").contents,
      ),
    );
  } catch (error: unknown) {
    throw new Error(`Cannot read logging E2E coverage manifest ${path}.`, { cause: error });
  }
  return parseLoggingEndToEndScopeManifest(parsedManifest);
}

export function absoluteRuntimeFiles(manifest: LoggingEndToEndScopeManifest): readonly string[] {
  return manifest.runtimeFiles.map((repoPath) => resolve(REPOSITORY_ROOT, repoPath));
}

export function isLoggingEndToEndCaseId(
  caseId: string,
  manifest = loadLoggingEndToEndScopeManifest(),
): boolean {
  return manifest.e2eCases.includes(caseId);
}
