/* eslint-disable security/detect-non-literal-fs-filename -- manifest paths are normalized and repository-bound before access */
/* eslint-disable security/detect-object-injection -- entry-kind keys are checked against the exact closed key set */
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const REPOSITORY_ROOT = resolve(import.meta.dirname, "../..");
export const MANIFEST_PATH = resolve(import.meta.dirname, "bot-runtime-scope.json");

export type E2eEntryKind = "canonical-cli" | "runtime-driver";

export interface BotRuntimeScopeManifest {
  readonly schemaVersion: 1;
  readonly runtimeFiles: readonly string[];
  readonly unitTestFiles: readonly string[];
  readonly e2eCases: Readonly<Record<E2eEntryKind, readonly string[]>>;
}

const SOURCE_PREFIX = "apps/bot/src/";
const TEST_FILE_PATTERN = /(?:^|\/)(?:__tests__\/.*|[^/]+\.(?:test|spec))\.[cm]?[jt]sx?$/u;
const DECLARATION_PATTERN = /\.d\.[cm]?ts$/u;
const RUNTIME_PATTERN = /\.[cm]?[jt]sx?$/u;

function assertPlainObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
}

function validateRelativeFile(file: unknown, label: string): string {
  if (typeof file !== "string" || file.length === 0) {
    throw new Error(`${label} must contain non-empty strings`);
  }
  if (isAbsolute(file) || file.includes("\\") || file.split("/").includes("..")) {
    throw new Error(`${label} contains an unsafe path: ${file}`);
  }
  const absolute = resolve(REPOSITORY_ROOT, file);
  const fromRoot = relative(REPOSITORY_ROOT, absolute);
  if (fromRoot === "" || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`${label} escapes the repository: ${file}`);
  }
  return absolute;
}

function validateUniqueFiles(
  value: unknown,
  label: string,
  { requireExists = true }: { readonly requireExists?: boolean } = {},
): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty array`);
  }
  const seen = new Set<string>();
  const files: unknown[] = value;
  return files.map((file): string => {
    if (typeof file !== "string") {
      throw new Error(`${label} must contain non-empty strings`);
    }
    const absolute = validateRelativeFile(file, label);
    if (seen.has(file)) throw new Error(`${label} contains duplicate path: ${file}`);
    seen.add(file);
    if (requireExists && !existsSync(absolute)) throw new Error(`${label} file is missing: ${file}`);
    return file;
  });
}

function validateE2eCases(value: unknown): Readonly<Record<E2eEntryKind, readonly string[]>> {
  assertPlainObject(value, "e2eCases");
  const expectedKinds: readonly E2eEntryKind[] = ["canonical-cli", "runtime-driver"];
  const keys = Object.keys(value).sort();
  if (JSON.stringify(keys) !== JSON.stringify(expectedKinds)) {
    throw new Error(`e2eCases must contain exactly: ${expectedKinds.join(", ")}`);
  }
  const allCaseIds = new Set<string>();
  const cases: Partial<Record<E2eEntryKind, readonly string[]>> = {};
  for (const kind of expectedKinds) {
    const ids = value[kind];
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new Error(`e2eCases.${kind} must be a non-empty array`);
    }
    cases[kind] = ids.map((id) => {
      if (typeof id !== "string" || !isCaseId(id)) {
        throw new Error(`e2eCases.${kind} contains invalid case ID: ${String(id)}`);
      }
      const key = `${kind}:${id}`;
      if (allCaseIds.has(key)) throw new Error(`e2eCases contains duplicate case: ${key}`);
      allCaseIds.add(key);
      return id;
    });
  }
  const canonicalCli = cases["canonical-cli"];
  const runtimeDriver = cases["runtime-driver"];
  if (canonicalCli === undefined || runtimeDriver === undefined) {
    throw new Error("e2eCases validation did not populate both entry kinds");
  }
  return { "canonical-cli": canonicalCli, "runtime-driver": runtimeDriver };
}

function isCaseId(value: string): boolean {
  return value.length > 0 && value.split("-").every((part) =>
    part.length > 0 && Array.from(part).every((character) =>
      (character >= "a" && character <= "z") || (character >= "0" && character <= "9")));
}

export function parseScopeManifest(
  value: unknown,
  { requireFiles = true }: { readonly requireFiles?: boolean } = {},
): BotRuntimeScopeManifest {
  assertPlainObject(value, "coverage manifest");
  if (value["schemaVersion"] !== 1) throw new Error("coverage manifest schemaVersion must equal 1");
  const runtimeFiles = validateUniqueFiles(value["runtimeFiles"], "runtimeFiles", { requireExists: requireFiles });
  const unitTestFiles = validateUniqueFiles(value["unitTestFiles"], "unitTestFiles", { requireExists: requireFiles });
  for (const file of runtimeFiles) {
    if (!file.startsWith(SOURCE_PREFIX) || !isRuntimeSourcePath(file)) {
      throw new Error(`runtimeFiles contains a non-runtime bot source: ${file}`);
    }
  }
  for (const file of unitTestFiles) {
    if (!file.startsWith(SOURCE_PREFIX) || !TEST_FILE_PATTERN.test(file)) {
      throw new Error(`unitTestFiles contains a non-test bot source: ${file}`);
    }
  }
  return { schemaVersion: 1, runtimeFiles, unitTestFiles, e2eCases: validateE2eCases(value["e2eCases"]) };
}

export function loadScopeManifest(path = MANIFEST_PATH): BotRuntimeScopeManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`cannot read coverage manifest ${path}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  return parseScopeManifest(parsed);
}

export function isRuntimeSourcePath(file: string): boolean {
  return file.startsWith(SOURCE_PREFIX)
    && RUNTIME_PATTERN.test(file)
    && !DECLARATION_PATTERN.test(file)
    && !TEST_FILE_PATTERN.test(file);
}

export function missingModifiedRuntimeFiles(
  manifestFiles: readonly string[],
  modifiedFiles: readonly string[],
): readonly string[] {
  const owned = new Set(manifestFiles);
  return [...new Set(modifiedFiles.filter(isRuntimeSourcePath))]
    .filter((file) => !owned.has(file))
    .sort();
}

export function absoluteRuntimeFiles(manifest: BotRuntimeScopeManifest): readonly string[] {
  return manifest.runtimeFiles.map((file) => resolve(REPOSITORY_ROOT, file));
}
