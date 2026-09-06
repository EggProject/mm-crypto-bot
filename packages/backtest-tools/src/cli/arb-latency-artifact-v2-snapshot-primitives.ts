import { ExactRational } from "@mm-crypto-bot/numeric";

export type ArbLatencyArtifactSnapshotErrorCode =
  "ARRAY_SHAPE" | "RATIONAL_VALUE" | "RECORD_SHAPE" | "REFLECTION_FAILURE";

export type ArbLatencyArtifactSnapshotFailurePhase =
  | "ARRAY_CLASSIFICATION"
  | "ARRAY_INDEX_DESCRIPTOR"
  | "ARRAY_LENGTH_DESCRIPTOR"
  | "ARRAY_OWN_KEYS"
  | "EXACT_RATIONAL_SNAPSHOT"
  | "RECORD_DESCRIPTOR"
  | "RECORD_OWN_KEYS";

export class ArbLatencyArtifactSnapshotError extends Error {
  public constructor(
    public readonly code: ArbLatencyArtifactSnapshotErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ArbLatencyArtifactSnapshotError";
  }
}

export class ArbLatencyArtifactSnapshotRedactedCause extends Error {
  public readonly code = "UNTRUSTED_ARTIFACT_INPUT" as const;

  public constructor(public readonly phase: ArbLatencyArtifactSnapshotFailurePhase) {
    super("Artifact input inspection failed.");
    this.name = "ArbLatencyArtifactSnapshotRedactedCause";
  }
}

interface OwnDataDescriptor extends PropertyDescriptor {
  readonly value: unknown;
}

function fail(code: ArbLatencyArtifactSnapshotErrorCode, message: string, cause?: unknown): never {
  throw new ArbLatencyArtifactSnapshotError(code, message, cause);
}

function requireLabel(label: string, code: ArbLatencyArtifactSnapshotErrorCode): void {
  if (label.length === 0) {
    fail(code, "Artifact snapshot labels must be nonempty strings.");
  }
}

function createAllowedKeySet(allowedKeys: readonly string[]): ReadonlySet<string> {
  const allowed = new Set<string>();
  for (const key of allowedKeys) {
    if (typeof key !== "string" || key.length === 0 || allowed.has(key)) {
      fail("RECORD_SHAPE", "Artifact record key definitions must be unique nonempty strings.");
    }
    allowed.add(key);
  }
  return allowed;
}

function isDataDescriptor(descriptor: PropertyDescriptor | undefined): descriptor is OwnDataDescriptor {
  return (
    descriptor !== undefined &&
    descriptor.get === undefined &&
    descriptor.set === undefined &&
    Object.hasOwn(descriptor, "value")
  );
}

function parseArrayIndexKey(key: string): number | undefined {
  if (key === "0") return 0;
  if (key.length === 0 || key.startsWith("0") || key.length > 10) return undefined;
  for (const character of key) {
    if (character < "0" || character > "9") return undefined;
  }
  if (key.length === 10 && key > "4294967294") return undefined;
  return Number(key);
}

function reflectionFailure(phase: ArbLatencyArtifactSnapshotFailurePhase): never {
  fail(
    "REFLECTION_FAILURE",
    "Artifact input could not be inspected safely.",
    new ArbLatencyArtifactSnapshotRedactedCause(phase),
  );
}

function readOwnKeys(input: object, phase: ArbLatencyArtifactSnapshotFailurePhase): readonly PropertyKey[] {
  try {
    return Reflect.ownKeys(input);
  } catch {
    return reflectionFailure(phase);
  }
}

function readOwnDescriptor(
  input: object,
  key: PropertyKey,
  phase: ArbLatencyArtifactSnapshotFailurePhase,
): PropertyDescriptor | undefined {
  try {
    return Object.getOwnPropertyDescriptor(input, key);
  } catch {
    return reflectionFailure(phase);
  }
}

function readOwnDataDescriptor(
  input: object,
  key: PropertyKey,
  phase: ArbLatencyArtifactSnapshotFailurePhase,
  code: ArbLatencyArtifactSnapshotErrorCode,
  message: string,
): OwnDataDescriptor {
  const descriptor = readOwnDescriptor(input, key, phase);
  if (!isDataDescriptor(descriptor)) {
    fail(code, message);
  }
  return descriptor;
}

function readArtifactArrayLength(input: object): number {
  const descriptor = readOwnDataDescriptor(
    input,
    "length",
    "ARRAY_LENGTH_DESCRIPTOR",
    "ARRAY_SHAPE",
    "Artifact array length descriptor is invalid.",
  );
  const length = descriptor.value;
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) {
    fail("ARRAY_SHAPE", "Artifact array length descriptor is invalid.");
  }
  return length;
}

function requireMaximumArrayLength(maximumLength: number): void {
  if (!Number.isSafeInteger(maximumLength) || maximumLength <= 0) {
    fail("ARRAY_SHAPE", "Artifact array maximum length must be a positive safe integer.");
  }
}
/**
 * Reads each declared own data property once without invoking object accessors.
 */
export function readClosedArtifactRecord(
  input: unknown,
  allowedKeys: readonly string[],
  label: string,
): Readonly<Record<string, unknown>> {
  requireLabel(label, "RECORD_SHAPE");
  const allowed = createAllowedKeySet(allowedKeys);
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      fail("RECORD_SHAPE", "Artifact record must be a non-array object.");
    }

    const ownKeys = readOwnKeys(input, "RECORD_OWN_KEYS");
    if (ownKeys.length !== allowed.size) {
      fail("RECORD_SHAPE", "Artifact record keys must exactly match its declared schema.");
    }

    const snapshot: Record<string, unknown> = {};
    for (const key of ownKeys) {
      if (typeof key !== "string" || !allowed.has(key)) {
        fail("RECORD_SHAPE", "Artifact record keys must exactly match its declared schema.");
      }
      const descriptor = readOwnDataDescriptor(
        input,
        key,
        "RECORD_DESCRIPTOR",
        "RECORD_SHAPE",
        "Artifact record properties must be enumerable own data properties.",
      );
      if (descriptor.enumerable !== true) {
        fail("RECORD_SHAPE", "Artifact record properties must be enumerable own data properties.");
      }
      Object.defineProperty(snapshot, key, {
        configurable: false,
        enumerable: true,
        value: descriptor.value,
        writable: false,
      });
    }
    return Object.freeze(snapshot);
  } catch (error: unknown) {
    if (error instanceof ArbLatencyArtifactSnapshotError) throw error;
    return reflectionFailure("RECORD_OWN_KEYS");
  }
}

/**
 * Copies a dense own-data array without invoking getters, iterators, or serializers.
 */
export function readClosedArtifactArray(
  input: unknown,
  label: string,
  maximumLength: number,
): readonly unknown[] {
  requireLabel(label, "ARRAY_SHAPE");
  requireMaximumArrayLength(maximumLength);
  try {
    if (!Array.isArray(input)) {
      fail("ARRAY_SHAPE", "Artifact array must be a genuine array.");
    }

    const length = readArtifactArrayLength(input);
    if (length > maximumLength) {
      fail("ARRAY_SHAPE", "Artifact array length exceeds the configured maximum.");
    }
    const ownKeys = readOwnKeys(input, "ARRAY_OWN_KEYS");
    const entries = new Map<number, PropertyDescriptor>();

    for (const key of ownKeys) {
      if (typeof key !== "string") {
        fail("ARRAY_SHAPE", "Artifact arrays must not have symbol properties.");
      }
      if (key === "length") {
        continue;
      }
      const index = parseArrayIndexKey(key);
      const descriptor = readOwnDataDescriptor(
        input,
        key,
        "ARRAY_INDEX_DESCRIPTOR",
        "ARRAY_SHAPE",
        "Artifact arrays must contain only own data index properties.",
      );
      if (index === undefined) {
        fail("ARRAY_SHAPE", "Artifact arrays must contain only own data index properties.");
      }
      entries.set(index, descriptor);
    }

    if (ownKeys.length !== length + 1 || entries.size !== length) {
      fail("ARRAY_SHAPE", "Artifact arrays must contain every index and no extra properties.");
    }

    const snapshot: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = entries.get(index);
      if (descriptor === undefined) {
        fail("ARRAY_SHAPE", "Artifact arrays must be dense own-data arrays.");
      }
      snapshot.push(descriptor.value);
    }
    return Object.freeze(snapshot);
  } catch (error: unknown) {
    if (error instanceof ArbLatencyArtifactSnapshotError) throw error;
    return reflectionFailure("ARRAY_CLASSIFICATION");
  }
}

/**
 * Reconstructs an independent exact value from one trusted numeric snapshot.
 */
export function snapshotArtifactExactRational(input: unknown, label: string): ExactRational {
  requireLabel(label, "RATIONAL_VALUE");
  try {
    if (!(input instanceof ExactRational)) {
      fail("RATIONAL_VALUE", "Artifact exact values must be ExactRational instances.");
    }
    const snapshot = ExactRational.prototype.toSnapshot.call(input);
    return ExactRational.fromSnapshot(snapshot);
  } catch (error: unknown) {
    if (error instanceof ArbLatencyArtifactSnapshotError) throw error;
    fail(
      "RATIONAL_VALUE",
      "Artifact exact value could not be snapshotted safely.",
      new ArbLatencyArtifactSnapshotRedactedCause("EXACT_RATIONAL_SNAPSHOT"),
    );
  }
}
