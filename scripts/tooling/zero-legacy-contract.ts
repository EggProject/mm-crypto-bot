import { zeroLegacyScannerConfig, type ZeroLegacyScannerConfig } from "./zero-legacy-config.ts";

export type ZeroLegacyFindingCategory =
  | "legacy-file"
  | "legacy-directory"
  | "legacy-import"
  | "legacy-export"
  | "legacy-route"
  | "legacy-command"
  | "legacy-runtime-reference"
  | "legacy-config-reference"
  | "legacy-current-doc-reference"
  | "legacy-served-asset"
  | "legacy-compatibility-shim"
  | "evidence-path-imported"
  | "evidence-path-executed"
  | "evidence-path-configured"
  | "evidence-path-routed"
  | "evidence-path-served"
  | "unsafe-path"
  | "unreadable-target"
  | "unparseable-source";

export type ZeroLegacySignal =
  | "legacy-file"
  | "legacy-directory"
  | "import"
  | "export"
  | "route"
  | "command"
  | "runtime-reference"
  | "config-reference"
  | "current-doc-reference"
  | "served-asset"
  | "compatibility-shim"
  | "unreadable-target"
  | "unparseable-source";

export interface ZeroLegacySemanticEntry {
  readonly signal: ZeroLegacySignal;
  readonly path: string;
  readonly location: string;
  readonly target?: string;
}

export interface ZeroLegacyFinding {
  readonly category: ZeroLegacyFindingCategory;
  readonly path: string;
  readonly location: string;
  readonly target?: string;
}

export interface ZeroLegacyEvaluation {
  readonly schemaVersion: ZeroLegacyScannerConfig["schemaVersion"];
  readonly catalogCompleteness: "incomplete";
  readonly incompleteReasons: readonly string[];
  readonly status: "fail" | "incomplete";
  readonly findings: readonly ZeroLegacyFinding[];
}

const evidenceCategoryBySignal: Readonly<Partial<Record<ZeroLegacySignal, ZeroLegacyFindingCategory>>> =
  Object.freeze({
    import: "evidence-path-imported",
    export: "evidence-path-imported",
    command: "evidence-path-executed",
    "runtime-reference": "evidence-path-executed",
    "config-reference": "evidence-path-configured",
    route: "evidence-path-routed",
    "served-asset": "evidence-path-served",
  });

const legacyCategoryBySignal: Readonly<Partial<Record<ZeroLegacySignal, ZeroLegacyFindingCategory>>> =
  Object.freeze({
    import: "legacy-import",
    export: "legacy-export",
    route: "legacy-route",
    command: "legacy-command",
    "runtime-reference": "legacy-runtime-reference",
    "config-reference": "legacy-config-reference",
    "current-doc-reference": "legacy-current-doc-reference",
    "served-asset": "legacy-served-asset",
    "compatibility-shim": "legacy-compatibility-shim",
  });

function isSafePosixRelativePath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    path.split("/").every((segment) => segment !== "." && segment !== ".." && segment.length > 0)
  );
}

function isAtOrBelow(path: string, directory: string): boolean {
  return path === directory || path.startsWith(`${directory}/`);
}

function isEvidenceOnlyPath(path: string, config: ZeroLegacyScannerConfig): boolean {
  return (
    config.evidenceOnlyPaths.includes(path) ||
    config.evidenceOnlyPrefixes.some((prefix) => path.startsWith(prefix))
  );
}

function isPhaseTestLabel(identifier: string): boolean {
  return /\bphase[ _-]*[0-9][a-z0-9._-]*/iu.test(identifier);
}

function isKnownLegacyIdentifier(identifier: string, config: ZeroLegacyScannerConfig): boolean {
  return config.knownLegacyIdentifiers.includes(identifier) || isPhaseTestLabel(identifier);
}

function isKnownLegacyPath(path: string, config: ZeroLegacyScannerConfig): boolean {
  return (
    config.knownLegacyPaths.includes(path) ||
    config.terminalAbsentPaths.some((terminalPath) => isAtOrBelow(path, terminalPath))
  );
}

function compareFindings(left: ZeroLegacyFinding, right: ZeroLegacyFinding): number {
  return (
    left.category.localeCompare(right.category) ||
    left.path.localeCompare(right.path) ||
    left.location.localeCompare(right.location) ||
    (left.target ?? "").localeCompare(right.target ?? "")
  );
}

function freezeFinding(finding: ZeroLegacyFinding): ZeroLegacyFinding {
  return Object.freeze({ ...finding });
}

function createFinding(
  category: ZeroLegacyFindingCategory,
  entry: ZeroLegacySemanticEntry,
): ZeroLegacyFinding {
  return freezeFinding({
    category,
    path: entry.path,
    location: entry.location,
    ...(entry.target !== undefined && { target: entry.target }),
  });
}

function evaluateEntry(
  entry: ZeroLegacySemanticEntry,
  config: ZeroLegacyScannerConfig,
): readonly ZeroLegacyFinding[] {
  if (
    !isSafePosixRelativePath(entry.path) ||
    (entry.target !== undefined && !isSafePosixRelativePath(entry.target))
  ) {
    return Object.freeze([createFinding("unsafe-path", entry)]);
  }

  if (isEvidenceOnlyPath(entry.path, config)) {
    return Object.freeze([]);
  }

  if (entry.signal === "unparseable-source") {
    return Object.freeze([
      freezeFinding({
        category: "unparseable-source",
        path: entry.path,
        location: entry.location,
      }),
    ]);
  }

  const target = entry.target ?? entry.path;
  const evidenceCategory = evidenceCategoryBySignal[entry.signal];
  if (evidenceCategory !== undefined && isEvidenceOnlyPath(target, config)) {
    return Object.freeze([createFinding(evidenceCategory, entry)]);
  }

  if (entry.signal === "unreadable-target") {
    return Object.freeze([createFinding("unreadable-target", entry)]);
  }

  if (entry.signal === "legacy-directory") {
    return config.terminalAbsentPaths.includes(target)
      ? Object.freeze([createFinding("legacy-directory", entry)])
      : Object.freeze([]);
  }

  if (entry.signal === "legacy-file") {
    return isKnownLegacyPath(target, config)
      ? Object.freeze([createFinding("legacy-file", entry)])
      : Object.freeze([]);
  }

  const legacyCategory = legacyCategoryBySignal[entry.signal];
  return legacyCategory !== undefined &&
    (isKnownLegacyPath(target, config) || isKnownLegacyIdentifier(target, config))
    ? Object.freeze([createFinding(legacyCategory, entry)])
    : Object.freeze([]);
}

export function evaluateZeroLegacyContract(
  entries: readonly ZeroLegacySemanticEntry[],
  config: ZeroLegacyScannerConfig = zeroLegacyScannerConfig,
): ZeroLegacyEvaluation {
  const findings: ZeroLegacyFinding[] = [];
  for (const entry of entries) {
    for (const finding of evaluateEntry(entry, config)) {
      const insertionIndex = findings.findIndex((existing) => compareFindings(existing, finding) > 0);
      const index = insertionIndex === -1 ? findings.length : insertionIndex;
      findings.splice(index, 0, freezeFinding(finding));
    }
  }

  return Object.freeze({
    schemaVersion: config.schemaVersion,
    catalogCompleteness: config.catalogCompleteness,
    incompleteReasons: Object.freeze([...config.incompleteReasons]),
    status: findings.length === 0 ? "incomplete" : "fail",
    findings: Object.freeze(findings),
  });
}
