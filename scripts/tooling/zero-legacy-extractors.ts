import { parse as parseToml } from "smol-toml";
import path from "node:path";
import ts from "typescript";

import { extractStaticCommandTokens } from "./zero-legacy-command-parser.ts";
import { zeroLegacyScannerConfig, type ZeroLegacyScannerConfig } from "./zero-legacy-config.ts";
import type { ZeroLegacySemanticEntry, ZeroLegacySignal } from "./zero-legacy-contract.ts";
import {
  extractHtmlDocumentTargets,
  extractMarkdownDocumentTargets,
} from "./zero-legacy-document-extractors.ts";
import { extractShellSyntaxTargets, extractYamlSyntaxTargets } from "./zero-legacy-shell-yaml-extractors.ts";
import { appendZeroLegacySyntaxEntries } from "./zero-legacy-syntax-targets.ts";
export class ZeroLegacyExtractorError extends Error {
  public constructor(
    public readonly path: string,
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(`${path}: ${message}`, cause === undefined ? undefined : { cause });
    this.name = "ZeroLegacyExtractorError";
  }
}

type LocatedTarget = Readonly<{
  readonly target: string;
  readonly start: number;
}>;

type TargetSource = "config" | "document" | "module";

const scriptKeyNames = new Set(["scripts", "command", "commands", "script"]);
const routeKeyNames = new Set(["route", "routes"]);
const commandKeyNames = new Set(["bin", "postinstall"]);

function signalForConfigKey(key: string): ZeroLegacySignal | undefined {
  if (routeKeyNames.has(key)) {
    return "route";
  }
  return scriptKeyNames.has(key) || commandKeyNames.has(key) ? "command" : undefined;
}

function freezeEntries(entries: readonly ZeroLegacySemanticEntry[]): readonly ZeroLegacySemanticEntry[] {
  return Object.freeze(entries.map((entry) => Object.freeze({ ...entry })));
}

function lineAt(sourceText: string, start: number): number {
  return sourceText.slice(0, start).split("\n").length;
}

function location(path: string, sourceText: string, start: number): string {
  return `${path}:${String(lineAt(sourceText, start))}`;
}

function normalizedTarget(target: string): string {
  let normalized = target;
  while (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }
  return normalized;
}

function isUnsafeTarget(target: string): boolean {
  return (
    target.startsWith("/") ||
    target.includes("\\") ||
    target.includes("\0") ||
    target.split("/").some((part) => part === "." || part === "..")
  );
}

function isAtOrBelow(target: string, candidate: string): boolean {
  return target === candidate || target.startsWith(`${candidate}/`);
}

function isPhaseIdentifier(target: string): boolean {
  return /\bphase[ _-]*[0-9][a-z0-9._-]*/iu.test(target);
}

function isCandidateTarget(target: string, config: ZeroLegacyScannerConfig): boolean {
  const normalized = normalizedTarget(target);
  return (
    isUnsafeTarget(normalized) ||
    config.terminalAbsentPaths.some((candidate) => isAtOrBelow(normalized, candidate)) ||
    config.knownLegacyPaths.some((candidate) => isAtOrBelow(normalized, candidate)) ||
    config.evidenceOnlyPaths.includes(normalized) ||
    config.evidenceOnlyPrefixes.some((prefix) => normalized.startsWith(prefix)) ||
    config.knownLegacyIdentifiers.includes(normalized) ||
    isPhaseIdentifier(normalized)
  );
}

function isExactKnownLegacyTarget(target: string, config: ZeroLegacyScannerConfig): boolean {
  const normalized = normalizedTarget(target);
  return (
    config.terminalAbsentPaths.includes(normalized) ||
    config.knownLegacyPaths.includes(normalized) ||
    config.knownLegacyIdentifiers.includes(normalized) ||
    isPhaseIdentifier(normalized)
  );
}

function isConfiguredPath(target: string, config: ZeroLegacyScannerConfig): boolean {
  return (
    config.terminalAbsentPaths.some((candidate) => isAtOrBelow(target, candidate)) ||
    config.knownLegacyPaths.some((candidate) => isAtOrBelow(target, candidate)) ||
    config.evidenceOnlyPaths.includes(target) ||
    config.evidenceOnlyPrefixes.some((prefix) => target.startsWith(prefix))
  );
}

function isRelativePath(target: string): boolean {
  return target.startsWith("./") || target.startsWith("../");
}

function resolveRelativeTarget(sourcePath: string, target: string): string {
  return path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), target));
}

function isExternalDocumentTarget(target: string): boolean {
  return /^\w[\w+.-]*:/u.test(target) || target.startsWith("//") || target.startsWith("#");
}

function stripDocumentSuffix(target: string): string {
  const queryIndex = target.indexOf("?");
  const fragmentIndex = target.indexOf("#");
  const endIndex = Math.min(
    queryIndex === -1 ? target.length : queryIndex,
    fragmentIndex === -1 ? target.length : fragmentIndex,
  );
  return target.slice(0, endIndex);
}

function canonicalizeTarget(
  sourcePath: string,
  target: string,
  source: TargetSource,
  config: ZeroLegacyScannerConfig,
): string | undefined {
  if (target.includes("\0") || target.includes("\\")) {
    return target;
  }
  if (source === "document") {
    if (isExternalDocumentTarget(target)) {
      return undefined;
    }
    const localTarget = stripDocumentSuffix(target);
    if (localTarget.length === 0) {
      return undefined;
    }
    if (localTarget.startsWith("/")) {
      return localTarget.replace(/^\/+/, "");
    }
    if (isRelativePath(localTarget)) {
      return resolveRelativeTarget(sourcePath, localTarget);
    }
    return isConfiguredPath(localTarget, config) || isExactKnownLegacyTarget(localTarget, config)
      ? localTarget
      : undefined;
  }
  if (isRelativePath(target)) {
    return resolveRelativeTarget(sourcePath, target);
  }
  return isConfiguredPath(target, config) || isExactKnownLegacyTarget(target, config) ? target : undefined;
}

function appendEntry(
  entries: ZeroLegacySemanticEntry[],
  signal: ZeroLegacySignal,
  path: string,
  sourceText: string,
  locatedTarget: LocatedTarget,
  source: TargetSource,
  config: ZeroLegacyScannerConfig,
): void {
  const canonicalTarget = canonicalizeTarget(path, locatedTarget.target, source, config);
  if (canonicalTarget === undefined) {
    return;
  }
  const target = normalizedTarget(canonicalTarget);
  if (!isCandidateTarget(target, config)) {
    return;
  }
  entries.push({ signal, path, location: location(path, sourceText, locatedTarget.start), target });
}

function literalTarget(node: ts.Expression): string | undefined {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : undefined;
}

function extractorFailure(path: string): (message: string) => never {
  return (message: string): never => {
    throw new ZeroLegacyExtractorError(path, message);
  };
}

function addStaticCommandText(
  entries: ZeroLegacySemanticEntry[],
  path: string,
  sourceText: string,
  sourceStart: number,
  commandText: string,
  config: ZeroLegacyScannerConfig,
): void {
  const targets = extractStaticCommandTokens(commandText, sourceStart, {
    allowRepositoryRootVariable: false,
    error: extractorFailure(path),
  });
  for (const target of targets) {
    appendEntry(entries, "command", path, sourceText, target, "config", config);
  }
}

function isBunSpawn(node: ts.Expression): boolean {
  return (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "Bun" &&
    (node.name.text === "spawn" || node.name.text === "spawnSync")
  );
}

function addBunCommandArgument(
  entries: ZeroLegacySemanticEntry[],
  path: string,
  sourceText: string,
  sourceFile: ts.SourceFile,
  argument: ts.Expression | undefined,
  config: ZeroLegacyScannerConfig,
): void {
  if (argument === undefined) {
    throw new ZeroLegacyExtractorError(path, "Bun spawn command is missing");
  }
  const array = ts.isArrayLiteralExpression(argument)
    ? argument
    : ts.isObjectLiteralExpression(argument)
      ? argument.properties.find(
          (property): property is ts.PropertyAssignment =>
            ts.isPropertyAssignment(property) &&
            ts.isIdentifier(property.name) &&
            property.name.text === "cmd",
        )?.initializer
      : undefined;
  if (array === undefined || !ts.isArrayLiteralExpression(array)) {
    throw new ZeroLegacyExtractorError(path, "Bun spawn command must be a static argv array");
  }
  const elements = array.elements;
  for (const element of elements) {
    const target = literalTarget(element);
    if (target === undefined) {
      throw new ZeroLegacyExtractorError(path, "Bun spawn argv must contain only static strings");
    }
    appendEntry(
      entries,
      "runtime-reference",
      path,
      sourceText,
      { target, start: element.getStart(sourceFile) },
      "module",
      config,
    );
  }
}

function extractTypeScriptEntries(
  path: string,
  sourceText: string,
  config: ZeroLegacyScannerConfig,
): readonly ZeroLegacySemanticEntry[] {
  const sourceFile = ts.createSourceFile(path, sourceText, ts.ScriptTarget.Latest, true);
  const entries: ZeroLegacySemanticEntry[] = [];
  const addNode = (signal: ZeroLegacySignal, node: ts.Expression): void => {
    const target = literalTarget(node);
    if (target !== undefined) {
      appendEntry(
        entries,
        signal,
        path,
        sourceText,
        { target, start: node.getStart(sourceFile) },
        "module",
        config,
      );
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      addNode("import", node.moduleSpecifier);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) {
      const target = literalTarget(node.moduleSpecifier);
      addNode("export", node.moduleSpecifier);
      if (target !== undefined && isExactKnownLegacyTarget(target, config)) {
        addNode("compatibility-shim", node.moduleSpecifier);
      }
    } else if (ts.isCallExpression(node)) {
      const firstArgument = node.arguments[0];
      const isBunSpawnCall = isBunSpawn(node.expression);
      const isRuntimeCall =
        node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require") ||
        isBunSpawnCall;
      if (isBunSpawnCall) {
        addBunCommandArgument(entries, path, sourceText, sourceFile, firstArgument, config);
      } else if (firstArgument !== undefined && isRuntimeCall) {
        addNode("runtime-reference", firstArgument);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return freezeEntries(entries);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function locateParsedTarget(sourceText: string, target: string): LocatedTarget {
  const encodedTargetIndex = sourceText.indexOf(JSON.stringify(target));
  const rawTargetIndex = sourceText.indexOf(target);
  return {
    target,
    start: Math.max(0, encodedTargetIndex === -1 ? rawTargetIndex : encodedTargetIndex),
  };
}

function extractConfigValues(
  path: string,
  sourceText: string,
  document: Readonly<Record<string, unknown>>,
  config: ZeroLegacyScannerConfig,
): readonly ZeroLegacySemanticEntry[] {
  const entries: ZeroLegacySemanticEntry[] = [];
  const visit = (value: unknown, currentKey: string, inheritedSignal?: ZeroLegacySignal): void => {
    const currentSignal = inheritedSignal ?? signalForConfigKey(currentKey) ?? "config-reference";
    if (typeof value === "string") {
      if (currentSignal === "command") {
        addStaticCommandText(
          entries,
          path,
          sourceText,
          locateParsedTarget(sourceText, value).start,
          value,
          config,
        );
        return;
      }
      appendEntry(
        entries,
        currentSignal,
        path,
        sourceText,
        locateParsedTarget(sourceText, value),
        "config",
        config,
      );
      return;
    }
    if (Array.isArray(value)) {
      for (const element of value) {
        visit(element, currentKey, currentSignal);
      }
      return;
    }
    if (isRecord(value)) {
      for (const [key, nestedValue] of Object.entries(value)) {
        if ((currentKey === "scripts" || commandKeyNames.has(key)) && isCandidateTarget(key, config)) {
          appendEntry(
            entries,
            "command",
            path,
            sourceText,
            locateParsedTarget(sourceText, key),
            "config",
            config,
          );
        }
        visit(nestedValue, key, signalForConfigKey(key) ?? currentSignal);
      }
    }
  };
  for (const [key, value] of Object.entries(document)) {
    if (commandKeyNames.has(key) && isCandidateTarget(key, config)) {
      appendEntry(
        entries,
        "command",
        path,
        sourceText,
        locateParsedTarget(sourceText, key),
        "config",
        config,
      );
    }
    visit(value, key);
  }
  return freezeEntries(entries);
}

function extractJsonEntries(
  path: string,
  sourceText: string,
  config: ZeroLegacyScannerConfig,
): readonly ZeroLegacySemanticEntry[] {
  let document: unknown;
  try {
    document = JSON.parse(sourceText);
  } catch (error: unknown) {
    throw new ZeroLegacyExtractorError(path, "malformed JSON", error);
  }
  if (!isRecord(document)) {
    throw new ZeroLegacyExtractorError(path, "JSON document must be an object");
  }
  return extractConfigValues(path, sourceText, document, config);
}

function extractTomlEntries(
  path: string,
  sourceText: string,
  config: ZeroLegacyScannerConfig,
): readonly ZeroLegacySemanticEntry[] {
  let document: Readonly<Record<string, unknown>>;
  try {
    document = parseToml(sourceText);
  } catch (error: unknown) {
    throw new ZeroLegacyExtractorError(path, "malformed TOML", error);
  }
  return extractConfigValues(path, sourceText, document, config);
}

function extractMarkdownEntries(
  path: string,
  sourceText: string,
  config: ZeroLegacyScannerConfig,
): readonly ZeroLegacySemanticEntry[] {
  const entries: ZeroLegacySemanticEntry[] = [];
  for (const target of extractMarkdownDocumentTargets(sourceText)) {
    appendEntry(entries, target.signal, path, sourceText, target, "document", config);
  }
  return freezeEntries(entries);
}

function extractHtmlEntries(
  path: string,
  sourceText: string,
  config: ZeroLegacyScannerConfig,
): readonly ZeroLegacySemanticEntry[] {
  const entries: ZeroLegacySemanticEntry[] = [];
  for (const target of extractHtmlDocumentTargets(sourceText)) {
    appendEntry(entries, target.signal, path, sourceText, target, "document", config);
  }
  return freezeEntries(entries);
}

function extractSyntaxEntries(
  path: string,
  sourceText: string,
  config: ZeroLegacyScannerConfig,
  extractor: typeof extractShellSyntaxTargets,
): readonly ZeroLegacySemanticEntry[] {
  const entries: ZeroLegacySemanticEntry[] = [];
  appendZeroLegacySyntaxEntries(sourceText, extractorFailure(path), extractor, (signal, target) => {
    appendEntry(entries, signal, path, sourceText, target, "config", config);
  });
  return freezeEntries(entries);
}

export function extractZeroLegacySemanticEntries(
  path: string,
  sourceText: string,
  config: ZeroLegacyScannerConfig = zeroLegacyScannerConfig,
): readonly ZeroLegacySemanticEntry[] {
  const lowerCasePath = path.toLowerCase();
  if (/\.(?:[cm]?[jt]sx?|tsx?)$/u.test(lowerCasePath)) {
    return extractTypeScriptEntries(path, sourceText, config);
  }
  if (lowerCasePath.endsWith(".json")) {
    return extractJsonEntries(path, sourceText, config);
  }
  if (lowerCasePath.endsWith(".toml")) {
    return extractTomlEntries(path, sourceText, config);
  }
  if (lowerCasePath.endsWith(".sh") || lowerCasePath.endsWith(".bash")) {
    return extractSyntaxEntries(path, sourceText, config, extractShellSyntaxTargets);
  }
  if (lowerCasePath.endsWith(".yml") || lowerCasePath.endsWith(".yaml")) {
    return extractSyntaxEntries(path, sourceText, config, extractYamlSyntaxTargets);
  }
  if (lowerCasePath.endsWith(".md") || lowerCasePath.endsWith(".mdx")) {
    return extractMarkdownEntries(path, sourceText, config);
  }
  return lowerCasePath.endsWith(".html") || lowerCasePath.endsWith(".htm")
    ? extractHtmlEntries(path, sourceText, config)
    : Object.freeze([]);
}
