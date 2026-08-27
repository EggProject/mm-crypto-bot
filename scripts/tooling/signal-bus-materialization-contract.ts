import { createHash } from "node:crypto";

export type MaterializationRole = "active" | "exact";
export type AllowedMaterializationOperation = "create" | "modify" | "delete";
export type CanonicalOperation = "A" | "M" | "D";
export type SafeRepoRelativePath = string;
export type CanonicalDigest = string;
export type CanonicalBrief = string;
export type CanonicalOwner = string;

export interface VerificationDiagnostic {
  readonly code: string;
  readonly message: string;
}

export class VerificationFailure extends Error {
  public readonly diagnostic: VerificationDiagnostic;

  public constructor(code: string, message: string) {
    super(message);
    this.name = "VerificationFailure";
    this.diagnostic = Object.freeze({ code, message });
  }
}

export interface SignalBusMaterializationEntry {
  readonly role: MaterializationRole;
  readonly path: SafeRepoRelativePath;
  readonly owner: CanonicalOwner;
  readonly allowedOperation: AllowedMaterializationOperation;
  readonly prerequisite: readonly CanonicalBrief[];
  readonly brief: CanonicalBrief;
}

export interface SignalBusMaterializationManifestV1 {
  readonly schemaVersion: 1;
  readonly role: MaterializationRole;
  readonly materializations: readonly SignalBusMaterializationEntry[];
}

export interface CanonicalMaterializationRecord {
  readonly operation: CanonicalOperation;
  readonly path: SafeRepoRelativePath;
  readonly blobIdentity: string;
}

const ownerPattern = /^[a-z0-9][a-z0-9._-]*$/u;
const briefPattern = /^[A-Z][A-Z0-9-]{2,127}$/u;
const blobPattern = /^git:[a-f0-9]{40}$/u;

function failure(code: string): never {
  throw new VerificationFailure(code, `signal-bus-materialization:${code}`);
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function hasOnlyKeys(input: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(input).every((key) => allowed.includes(key));
}

function isPathCharacter(character: string, isSegmentStart: boolean): boolean {
  const isLetter = /^[A-Za-z]$/u.test(character);
  const isDigit = /^[0-9]$/u.test(character);
  return isLetter || isDigit || (!isSegmentStart && [".", "_", "-"].includes(character));
}

function isSafePath(input: string): boolean {
  if (input.length === 0) return false;
  let isSegmentStart = true;
  for (let index = 0; index < input.length; index += 1) {
    const character = input.charAt(index);
    if (character === "/") {
      if (isSegmentStart) return false;
      isSegmentStart = true;
      continue;
    }
    if (!isPathCharacter(character, isSegmentStart)) return false;
    isSegmentStart = false;
  }
  return !isSegmentStart;
}

function parseStrictJson(input: string): unknown {
  let index = 0;
  const whitespace = (): void => {
    while (index < input.length && " \t\r\n".includes(input.charAt(index))) index += 1;
  };
  const string = (): string => {
    if (input.charAt(index) !== '"') return failure("manifest-json");
    index += 1;
    const start = index - 1;
    for (;;) {
      const character = input.charAt(index);
      index += 1;
      if (character === "") return failure("manifest-json");
      if (character === "\\") {
        index += 1;
        continue;
      }
      if (character === '"') {
        try {
          // The scanner enters this branch only after consuming a quoted JSON token.
          return JSON.parse(input.slice(start, index)) as string;
        } catch {
          return failure("manifest-json");
        }
      }
      if (character < " ") return failure("manifest-json");
    }
  };
  const value = (): void => {
    whitespace();
    const character = input.charAt(index);
    if (character === '"') {
      string();
      return;
    }
    if (character === "{") {
      index += 1;
      whitespace();
      if (input.charAt(index) === "}") {
        index += 1;
        return;
      }
      const keys = new Set<string>();
      for (;;) {
        whitespace();
        const key = string();
        if (keys.has(key)) failure("manifest-json-duplicate-key");
        keys.add(key);
        whitespace();
        if (input.charAt(index) !== ":") return failure("manifest-json");
        index += 1;
        value();
        whitespace();
        if (input.charAt(index) === "}") {
          index += 1;
          return;
        }
        if (input.charAt(index) !== ",") return failure("manifest-json");
        index += 1;
      }
    }
    if (character === "[") {
      index += 1;
      whitespace();
      if (input.charAt(index) === "]") {
        index += 1;
        return;
      }
      for (;;) {
        value();
        whitespace();
        if (input.charAt(index) === "]") {
          index += 1;
          return;
        }
        if (input.charAt(index) !== ",") return failure("manifest-json");
        index += 1;
      }
    }
    const tokenStart = index;
    while (!",]} \t\r\n".includes(input.charAt(index)) && input.charAt(index) !== "") index += 1;
    const token = input.slice(tokenStart, index);
    try {
      const parsed: unknown = JSON.parse(token);
      if (typeof parsed === "object" || typeof parsed === "string") return failure("manifest-json");
    } catch {
      return failure("manifest-json");
    }
  };
  value();
  whitespace();
  if (index !== input.length) failure("manifest-json");
  const parsed: unknown = JSON.parse(input);
  return parsed;
}

function parseRole(input: unknown): MaterializationRole {
  if (input === "active" || input === "exact") return input;
  return failure("manifest-role");
}

function parseBrief(input: unknown): CanonicalBrief {
  if (typeof input === "string" && briefPattern.test(input)) return input;
  return failure("manifest-brief");
}

function parseOwner(input: unknown): CanonicalOwner {
  if (typeof input === "string" && ownerPattern.test(input)) return input;
  return failure("manifest-owner");
}

export function toSafeRepoRelativePath(input: string): SafeRepoRelativePath {
  if (!isSafePath(input)) failure("unsafe-path");
  return input;
}

function parseEntry(input: unknown, requestedRole: MaterializationRole): SignalBusMaterializationEntry {
  if (
    !isRecord(input) ||
    !hasOnlyKeys(input, ["role", "path", "owner", "allowedOperation", "prerequisite", "brief"])
  ) {
    return failure("manifest-entry");
  }
  const role = parseRole(input["role"]);
  if (role !== requestedRole || typeof input["path"] !== "string")
    return failure("manifest-entry-role-or-path");
  if (
    input["allowedOperation"] !== "create" &&
    input["allowedOperation"] !== "modify" &&
    input["allowedOperation"] !== "delete"
  ) {
    return failure("manifest-operation");
  }
  if (!Array.isArray(input["prerequisite"])) return failure("manifest-prerequisite");
  const brief = parseBrief(input["brief"]);
  const prerequisite = input["prerequisite"].map((candidate) => parseBrief(candidate));
  if (prerequisite.includes(brief) || new Set(prerequisite).size !== prerequisite.length)
    failure("manifest-prerequisite");
  return Object.freeze({
    role,
    path: toSafeRepoRelativePath(input["path"]),
    owner: parseOwner(input["owner"]),
    allowedOperation: input["allowedOperation"],
    prerequisite: Object.freeze(prerequisite),
    brief,
  });
}

export function parseMaterializationManifest(
  input: unknown,
  requestedRole: MaterializationRole,
): SignalBusMaterializationManifestV1 {
  const raw = typeof input === "string" ? parseStrictJson(input) : input;
  if (!isRecord(raw) || !hasOnlyKeys(raw, ["schemaVersion", "role", "materializations"]))
    return failure("manifest-shape");
  if (
    raw["schemaVersion"] !== 1 ||
    parseRole(raw["role"]) !== requestedRole ||
    !Array.isArray(raw["materializations"])
  ) {
    return failure("manifest-header");
  }
  const materializations = raw["materializations"].map((entry) => parseEntry(entry, requestedRole));
  if (materializations.length === 0) failure("manifest-empty");
  const paths = new Set(materializations.map((entry) => entry.path));
  const triples = new Set(
    materializations.map((entry) => `${entry.brief}\u{0}${entry.owner}\u{0}${entry.path}`),
  );
  const briefs = new Set(materializations.map((entry) => entry.brief));
  if (
    paths.size !== materializations.length ||
    triples.size !== materializations.length ||
    materializations.some((entry) => entry.prerequisite.some((brief) => !briefs.has(brief)))
  ) {
    return failure("manifest-bijection");
  }
  return Object.freeze({
    schemaVersion: 1,
    role: requestedRole,
    materializations: Object.freeze(materializations),
  });
}

function validateRecord(record: CanonicalMaterializationRecord): void {
  const recordInput: { readonly operation: unknown } = record;
  const operation = recordInput.operation;
  if ((operation !== "A" && operation !== "M" && operation !== "D") || !isSafePath(record.path)) {
    failure("canonical-record");
  }
  if (record.operation === "D") {
    if (record.blobIdentity !== "absent") failure("canonical-blob");
    return;
  }
  if (!blobPattern.test(record.blobIdentity)) {
    failure("canonical-blob");
  }
}

export function createCanonicalDigest(records: readonly CanonicalMaterializationRecord[]): {
  readonly records: readonly CanonicalMaterializationRecord[];
  readonly value: CanonicalDigest;
} {
  if (records.length === 0) failure("canonical-empty");
  for (const record of records) validateRecord(record);
  // eslint-disable-next-line unicorn/no-array-sort -- ES2022 has no non-mutating Array sort.
  const ordered = [...records].sort((left, right) =>
    Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)),
  );
  if (new Set(ordered.map((record) => record.path)).size !== ordered.length)
    failure("canonical-duplicate-path");
  const bytes = ordered
    .map((record) => `${record.operation}\t${record.path}\t${record.blobIdentity}\n`)
    .join("");
  const value = `sha256:${createHash("sha256").update(bytes, "utf8").digest("hex")}`;
  return Object.freeze({
    records: Object.freeze(ordered.map((record) => Object.freeze({ ...record }))),
    value,
  });
}

export function isWithinMaterializationLineLimit(lineCount: number): boolean {
  return Number.isSafeInteger(lineCount) && lineCount >= 0 && lineCount <= 500;
}
