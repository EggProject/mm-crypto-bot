export const zeroLegacySchemaVersion = "zero-legacy-scanner@1" as const;

export interface ZeroLegacyScannerConfig {
  readonly schemaVersion: typeof zeroLegacySchemaVersion;
  readonly catalogCompleteness: "incomplete";
  readonly incompleteReasons: readonly string[];
  readonly declaredInventoryRoots: readonly string[];
  readonly excludedDirectoryNames: readonly string[];
  readonly excludedPathPrefixes: readonly string[];
  readonly evidenceOnlyPrefixes: readonly string[];
  readonly evidenceOnlyPaths: readonly string[];
  readonly terminalAbsentPaths: readonly string[];
  readonly knownLegacyPaths: readonly string[];
  readonly knownLegacyIdentifiers: readonly string[];
}

function freezeArray(values: readonly string[]): readonly string[] {
  return Object.freeze([...values]);
}

export const zeroLegacyScannerConfig: ZeroLegacyScannerConfig = Object.freeze({
  schemaVersion: zeroLegacySchemaVersion,
  catalogCompleteness: "incomplete",
  incompleteReasons: freezeArray([
    "The current documentation and served-asset catalog is not yet declared.",
    "The scanner cannot claim a repository-wide clean result before that catalog exists.",
  ]),
  declaredInventoryRoots: freezeArray([
    "apps",
    "packages",
    "scripts",
    "docs",
    "run-bot",
    "search-best-config",
    ".github",
    "package.json",
    "turbo.json",
    "lefthook.yml",
  ]),
  excludedDirectoryNames: freezeArray(["node_modules", "dist", "build", "coverage", ".turbo"]),
  excludedPathPrefixes: freezeArray(["search-best-config/results/"]),
  evidenceOnlyPrefixes: freezeArray(["plans/full-refactor/", "data/reports/"]),
  evidenceOnlyPaths: freezeArray(["AGENTS.md", ".codex/ENGINEERING-STANDARDS.md"]),
  terminalAbsentPaths: freezeArray(["docs/legacy", "bin", "run-bot", "search-best-config"]),
  knownLegacyPaths: freezeArray(["scripts/install-mm-bot.sh", "bin/mm-bot"]),
  knownLegacyIdentifiers: freezeArray([
    "mm-bot",
    "run-bot",
    "search-best-config",
    "mm-bot:built",
    "start",
    "headless",
    "bot:*",
    "bin",
    "postinstall",
  ]),
});
