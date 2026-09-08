import type { ArbLatencyArtifactV2 } from "./arb-latency-artifact-v2.js";

const MAXIMUM_LOGICAL_PATH_LENGTH = 240;
const VALIDATED_OUTPUT_PATH_CREATION_TOKEN = Symbol("validated-arb-latency-output-path");
const SAFE_PATH_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const WINDOWS_RESERVED_SEGMENT_BASENAMES = new Set([
  "aux",
  "clock$",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "con",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
  "nul",
  "prn",
]);
const TEMPORARY_SEGMENT_NAMES = new Set(["temp", "temporary", "tmp"]);
const authenticatedOutputPaths = new WeakSet();

export type ArbLatencyOutputPathErrorCode =
  | "ABSOLUTE_PATH"
  | "AMBIGUOUS_CHARACTER"
  | "BACKSLASH_SEPARATOR"
  | "DOT_SEGMENT"
  | "EMPTY_PATH"
  | "EMPTY_SEGMENT"
  | "HIDDEN_SEGMENT"
  | "INVALID_FILENAME"
  | "INVALID_TYPE"
  | "PATH_TOO_LONG"
  | "RESERVED_SEGMENT"
  | "UNAUTHENTICATED_PATH"
  | "UNAUTHORIZED_CONSTRUCTION"
  | "UNSAFE_SEGMENT"
  | "WINDOWS_PATH";

export class ArbLatencyOutputPathError extends Error {
  public readonly code: ArbLatencyOutputPathErrorCode;

  public constructor(code: ArbLatencyOutputPathErrorCode) {
    super(`Arbitrage-latency output path validation failed: ${code}.`);
    this.code = code;
    this.name = "ArbLatencyOutputPathError";
  }
}

/**
 * An authenticated, normalized logical artifact path that contains no physical path information.
 */
export class ValidatedArbLatencyOutputPath {
  declare public readonly logicalPath: string;

  public constructor(logicalPath: string, creationToken: symbol) {
    if (creationToken !== VALIDATED_OUTPUT_PATH_CREATION_TOKEN) {
      throw new ArbLatencyOutputPathError("UNAUTHORIZED_CONSTRUCTION");
    }
    Object.defineProperty(this, "logicalPath", {
      configurable: false,
      enumerable: true,
      value: logicalPath,
      writable: false,
    });
    authenticatedOutputPaths.add(this);
    Object.freeze(this);
  }
}

export interface ArbLatencyArtifactOutputReceipt {
  readonly schema: "arb-latency-cli-output@2";
  readonly logicalPath: string;
}

export interface ArbLatencyArtifactOutputPort {
  write(
    outputPath: ValidatedArbLatencyOutputPath,
    artifact: ArbLatencyArtifactV2,
  ): ArbLatencyArtifactOutputReceipt;
}

function fail(code: ArbLatencyOutputPathErrorCode): never {
  throw new ArbLatencyOutputPathError(code);
}

function isString(input: unknown): input is string {
  return typeof input === "string";
}

function segmentBasename(lowercaseSegment: string): string {
  const extensionIndex = lowercaseSegment.indexOf(".");
  return extensionIndex === -1 ? lowercaseSegment : lowercaseSegment.slice(0, extensionIndex);
}

function isReservedSegment(segment: string): boolean {
  const lowercaseSegment = segment.toLowerCase();
  const basename = segmentBasename(lowercaseSegment);
  return (
    WINDOWS_RESERVED_SEGMENT_BASENAMES.has(basename) ||
    TEMPORARY_SEGMENT_NAMES.has(lowercaseSegment) ||
    lowercaseSegment.endsWith(".temp") ||
    lowercaseSegment.endsWith(".tmp")
  );
}

function validatePathSegments(logicalPath: string): readonly string[] {
  const segments = logicalPath.split("/");
  for (const segment of segments) {
    if (segment.length === 0) {
      fail("EMPTY_SEGMENT");
    }
    if (segment === "." || segment === "..") {
      fail("DOT_SEGMENT");
    }
    if (segment.startsWith(".")) {
      fail("HIDDEN_SEGMENT");
    }
    if (!SAFE_PATH_SEGMENT_PATTERN.test(segment) || segment.endsWith(".")) {
      fail("UNSAFE_SEGMENT");
    }
    if (isReservedSegment(segment)) {
      fail("RESERVED_SEGMENT");
    }
  }
  return segments;
}

function validateLogicalPath(input: unknown): string {
  if (!isString(input)) {
    fail("INVALID_TYPE");
  }
  if (input.length === 0) {
    fail("EMPTY_PATH");
  }
  if (input.length > MAXIMUM_LOGICAL_PATH_LENGTH) {
    fail("PATH_TOO_LONG");
  }
  if (/\p{Cc}|\s/u.test(input)) {
    fail("AMBIGUOUS_CHARACTER");
  }
  if (input.includes("\\")) {
    fail("BACKSLASH_SEPARATOR");
  }
  if (input.startsWith("/")) {
    fail("ABSOLUTE_PATH");
  }
  if (/^[A-Za-z]:/u.test(input)) {
    fail("WINDOWS_PATH");
  }

  validatePathSegments(input);
  const filename = input.slice(input.lastIndexOf("/") + 1);
  if (!filename.endsWith(".json")) {
    fail("INVALID_FILENAME");
  }
  return input;
}

function isAuthenticatedOutputPath(input: unknown): input is ValidatedArbLatencyOutputPath {
  return typeof input === "object" && input !== null && authenticatedOutputPaths.has(input);
}

function authenticatedLogicalPath(input: unknown): string {
  if (!isAuthenticatedOutputPath(input)) {
    fail("UNAUTHENTICATED_PATH");
  }
  return input.logicalPath;
}

/**
 * Parses one untrusted output path into an immutable normalized POSIX logical path.
 */
export function parseValidatedArbLatencyOutputPath(input: unknown): ValidatedArbLatencyOutputPath {
  return new ValidatedArbLatencyOutputPath(validateLogicalPath(input), VALIDATED_OUTPUT_PATH_CREATION_TOKEN);
}

/**
 * Creates the receipt that an output adapter returns after accepting a validated artifact path.
 */
export function createArbLatencyArtifactOutputReceipt(outputPath: unknown): ArbLatencyArtifactOutputReceipt {
  return Object.freeze({
    logicalPath: authenticatedLogicalPath(outputPath),
    schema: "arb-latency-cli-output@2",
  });
}
