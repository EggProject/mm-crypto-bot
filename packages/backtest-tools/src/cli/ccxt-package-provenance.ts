import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export class CcxtPackageProvenanceError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = "CcxtPackageProvenanceError";
  }
}

export interface CcxtPackageProvenanceDependencies {
  readonly readExpectedManifestText: () => Promise<string>;
  readonly readInstalledPackageText: (path: string) => Promise<string>;
  readonly resolveSpecifier: (specifier: string) => string;
}

const defaultDependencies: CcxtPackageProvenanceDependencies = {
  readExpectedManifestText: async () =>
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- The module-relative manifest URL is fixed.
    await readFile(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
  readInstalledPackageText: async (filePath) =>
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- The resolver validates a local file URL first.
    await readFile(filePath, "utf8"),
  resolveSpecifier: (specifier) => import.meta.resolve(specifier),
};

/**
 * Returns the version stored in the package metadata beside the resolved CCXT
 * module. It intentionally does not read the module's self-reported version,
 * because that value can be stale within a published artifact.
 */
export async function resolveCcxtPackageVersion(
  dependencies: CcxtPackageProvenanceDependencies = defaultDependencies,
): Promise<string> {
  const expectedVersion = await resolveExpectedCcxtVersion(dependencies);
  const packageJsonPath = resolveCcxtPackageJsonPath(dependencies.resolveSpecifier("ccxt"));
  let packageJsonText: string;
  try {
    packageJsonText = await dependencies.readInstalledPackageText(packageJsonPath);
  } catch (error: unknown) {
    throw new CcxtPackageProvenanceError("Unable to read resolved CCXT package metadata", error);
  }

  const installedVersion = parseCcxtPackageVersion(packageJsonText);
  if (installedVersion !== expectedVersion) {
    throw new CcxtPackageProvenanceError(
      `Resolved CCXT package version does not match active dependency: expected ${expectedVersion}, received ${installedVersion}`,
      undefined,
    );
  }
  return installedVersion;
}

async function resolveExpectedCcxtVersion(dependencies: CcxtPackageProvenanceDependencies): Promise<string> {
  let manifestText: string;
  try {
    manifestText = await dependencies.readExpectedManifestText();
  } catch (error: unknown) {
    throw new CcxtPackageProvenanceError("Unable to read active CCXT dependency manifest", error);
  }
  return parseExpectedCcxtVersion(manifestText);
}

function resolveCcxtPackageJsonPath(resolvedModuleUrl: string): string {
  try {
    const modulePath = fileURLToPath(resolvedModuleUrl);
    return path.resolve(path.dirname(modulePath), "..", "package.json");
  } catch (error: unknown) {
    throw new CcxtPackageProvenanceError("Resolved CCXT module is not a local file artifact", error);
  }
}

function parseCcxtPackageVersion(packageJsonText: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(packageJsonText);
  } catch (error: unknown) {
    throw new CcxtPackageProvenanceError("Resolved CCXT package metadata is not valid JSON", error);
  }

  if (!isRecord(parsed) || parsed["name"] !== "ccxt" || typeof parsed["version"] !== "string") {
    throw new CcxtPackageProvenanceError("Resolved package metadata does not identify CCXT", undefined);
  }
  if (!isCanonicalSemanticVersion(parsed["version"])) {
    throw new CcxtPackageProvenanceError("Resolved CCXT package metadata has an invalid version", undefined);
  }
  return parsed["version"];
}

function parseExpectedCcxtVersion(manifestText: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestText);
  } catch (error: unknown) {
    throw new CcxtPackageProvenanceError("Active CCXT dependency manifest is not valid JSON", error);
  }

  if (
    !isRecord(parsed) ||
    !isRecord(parsed["dependencies"]) ||
    typeof parsed["dependencies"]["ccxt"] !== "string"
  ) {
    throw new CcxtPackageProvenanceError("Active CCXT dependency manifest is missing ccxt", undefined);
  }
  const expectedVersion = parsed["dependencies"]["ccxt"];
  if (!isCanonicalSemanticVersion(expectedVersion)) {
    throw new CcxtPackageProvenanceError(
      "Active CCXT dependency must be an exact canonical version",
      undefined,
    );
  }
  return expectedVersion;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCanonicalSemanticVersion(version: string): boolean {
  const buildIndex = version.indexOf("+");
  const versionWithoutBuild = buildIndex === -1 ? version : version.slice(0, buildIndex);
  const build = buildIndex === -1 ? undefined : version.slice(buildIndex + 1);
  if (build !== undefined && !hasValidIdentifiers(build, false)) return false;

  const prereleaseIndex = versionWithoutBuild.indexOf("-");
  const coreVersion =
    prereleaseIndex === -1 ? versionWithoutBuild : versionWithoutBuild.slice(0, prereleaseIndex);
  const prerelease = prereleaseIndex === -1 ? undefined : versionWithoutBuild.slice(prereleaseIndex + 1);
  return (
    isCanonicalCoreVersion(coreVersion) && (prerelease === undefined || hasValidIdentifiers(prerelease, true))
  );
}

function isCanonicalCoreVersion(value: string): boolean {
  let componentCount = 0;
  let component = "";
  const terminatedValue = `${value}.`;
  for (const character of terminatedValue) {
    if (character === ".") {
      if (!isCanonicalNumber(component)) return false;
      componentCount += 1;
      component = "";
    } else if (isDecimalDigit(character)) {
      component += character;
    } else {
      return false;
    }
  }
  return componentCount === 3;
}

function hasValidIdentifiers(value: string, requiresCanonicalNumeric: boolean): boolean {
  let identifier = "";
  const terminatedValue = `${value}.`;
  for (const character of terminatedValue) {
    if (character === ".") {
      if (!isValidIdentifier(identifier, requiresCanonicalNumeric)) return false;
      identifier = "";
    } else if (isIdentifierCharacter(character)) {
      identifier += character;
    } else {
      return false;
    }
  }
  return true;
}

function isValidIdentifier(identifier: string, requiresCanonicalNumeric: boolean): boolean {
  if (identifier.length === 0) return false;
  return !requiresCanonicalNumeric || !hasOnlyDecimalDigits(identifier) || isCanonicalNumber(identifier);
}

function isCanonicalNumber(value: string): boolean {
  return value === "0" || (value.length > 0 && !value.startsWith("0") && hasOnlyDecimalDigits(value));
}

function hasOnlyDecimalDigits(value: string): boolean {
  for (const character of value) {
    if (!isDecimalDigit(character)) return false;
  }
  return true;
}

function isDecimalDigit(character: string): boolean {
  return character >= "0" && character <= "9";
}

function isIdentifierCharacter(character: string): boolean {
  return character === "-" || isDecimalDigit(character) || isAsciiLetter(character);
}

function isAsciiLetter(character: string): boolean {
  return (character >= "A" && character <= "Z") || (character >= "a" && character <= "z");
}
