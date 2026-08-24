import type { LogLevel, LogRecord, LogValue } from "./contracts.js";

const MAXIMUM_DEPTH = 8;
const MAXIMUM_KEYS = 64;
const MAXIMUM_ARRAY_ITEMS = 64;
const MAXIMUM_BIGINT_MAGNITUDE = 10n ** 1024n;
const MAXIMUM_KEY_LENGTH = 128;
const MAXIMUM_STRING_LENGTH = 8192;
const REDACTED = "[REDACTED]";
const TRUNCATED = "[TRUNCATED]";
const SENSITIVE_KEY_LABELS = [
  "apikey",
  "authorization",
  "credential",
  "password",
  "privatekey",
  "secret",
  "token",
  "setcookie",
  "cookie",
  "sessionid",
  "session",
] as const;
const SENSITIVE_TEXT_LABELS = [
  "access_token",
  "accesstoken",
  "authorization",
  "bearer",
  "api-key",
  "api_key",
  "apikey",
  "token",
  "id_token",
  "idtoken",
  "refresh_token",
  "refreshtoken",
  "secret",
  "credential",
  "password",
] as const;
const COOKIE_OR_SESSION_TEXT_LABELS = [
  "set-cookie",
  "set_cookie",
  "setcookie",
  "cookie",
  "session-id",
  "session_id",
  "sessionid",
  "jsessionid",
  "session-token",
  "session_token",
  "sessiontoken",
  "sid",
  "session",
] as const;
const INVALID_EVENT = "logging.invalid.record";
const INVALID_IDENTIFIER = "invalid";
const INVALID_TIMESTAMP = "1970-01-01T00:00:00.000Z";

function normalizeSensitiveLabel(value: string): string {
  return value.toLowerCase().replaceAll(/[-_]/gu, "");
}

function isSensitiveTextBoundary(character: string | undefined): boolean {
  return character === undefined || " \t\n\r,;|&?{[(-\"'".includes(character);
}

function isWhitespace(character: string | undefined): boolean {
  return [" ", "\t", "\n", "\r"].includes(character ?? "");
}

function isQuote(character: string | undefined): boolean {
  return character === '"' || character === "'";
}

function hasSensitiveTextValue(
  value: string,
  labels: readonly string[],
  isWhitespaceDelimiterAllowed: boolean,
): boolean {
  const normalized = value.toLowerCase();
  for (const label of labels) {
    let labelIndex = normalized.indexOf(label);
    while (labelIndex >= 0) {
      const previousCharacter = labelIndex === 0 ? undefined : normalized.at(labelIndex - 1);
      const isBoundary = isSensitiveTextBoundary(previousCharacter);
      let delimiterIndex = labelIndex + label.length;
      if (isQuote(normalized.at(delimiterIndex))) delimiterIndex += 1;
      let hasWhitespaceDelimiter = false;
      while (isWhitespace(normalized.at(delimiterIndex))) {
        hasWhitespaceDelimiter = true;
        delimiterIndex += 1;
      }
      const isExplicitDelimiter = [":", "="].includes(normalized.at(delimiterIndex) ?? "");
      if (
        isBoundary &&
        (isExplicitDelimiter || (isWhitespaceDelimiterAllowed && hasWhitespaceDelimiter)) &&
        delimiterIndex + 1 < normalized.length
      ) {
        return true;
      }
      labelIndex = normalized.indexOf(label, labelIndex + 1);
    }
  }
  return false;
}

function decodeUrlEscapes(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isAsciiLetter(character: string | undefined): boolean {
  return character !== undefined && "abcdefghijklmnopqrstuvwxyz".includes(character.toLowerCase());
}

function isUriSchemeCharacter(character: string | undefined): boolean {
  return character !== undefined && "abcdefghijklmnopqrstuvwxyz0123456789+.-".includes(character);
}

function isUriAuthorityTerminator(value: string, index: number): boolean {
  const character = value.at(index);
  return (
    character === "/" ||
    character === "?" ||
    character === "#" ||
    isWhitespace(character) ||
    value.startsWith("%2f", index) ||
    value.startsWith("%3f", index) ||
    value.startsWith("%23", index)
  );
}

function hasUriUserinfoInAuthority(value: string, authorityStart: number): boolean {
  for (let authorityIndex = authorityStart; authorityIndex < value.length; authorityIndex += 1) {
    if (isUriAuthorityTerminator(value, authorityIndex)) return false;
    const userinfoDelimiterLength =
      value.at(authorityIndex) === "@" ? 1 : value.startsWith("%40", authorityIndex) ? 3 : 0;
    if (userinfoDelimiterLength > 0) {
      const hasUserinfo = authorityIndex > authorityStart;
      const hostStart = authorityIndex + userinfoDelimiterLength;
      return hasUserinfo && hostStart < value.length && !isUriAuthorityTerminator(value, hostStart);
    }
  }
  return false;
}

function hasUriUserinfo(value: string): boolean {
  const normalized = value.toLowerCase();
  for (let separatorStart = 0; separatorStart < normalized.length; separatorStart += 1) {
    const authorityStart = normalized.startsWith("://", separatorStart)
      ? separatorStart + 3
      : normalized.startsWith("%3a%2f%2f", separatorStart)
        ? separatorStart + 9
        : undefined;
    if (authorityStart === undefined || authorityStart >= normalized.length) continue;

    let schemeStart = separatorStart;
    while (schemeStart > 0 && isUriSchemeCharacter(normalized.at(schemeStart - 1))) schemeStart -= 1;
    if (isAsciiLetter(normalized.at(schemeStart)) && hasUriUserinfoInAuthority(normalized, authorityStart)) {
      return true;
    }
  }
  return false;
}

function isSensitiveKey(key: string): boolean {
  if (key.length > MAXIMUM_KEY_LENGTH) return true;
  const normalized = normalizeSensitiveLabel(key);
  return SENSITIVE_KEY_LABELS.some((label) => normalized.includes(label));
}

function isSensitiveText(value: string): boolean {
  for (const candidate of [value, decodeUrlEscapes(value)]) {
    if (
      hasSensitiveTextValue(candidate, SENSITIVE_TEXT_LABELS, true) ||
      hasSensitiveTextValue(candidate, COOKIE_OR_SESSION_TEXT_LABELS, false) ||
      hasUriUserinfo(candidate) ||
      candidate.startsWith("sk-") ||
      candidate.startsWith("ghp_")
    ) {
      return true;
    }
  }
  return false;
}

export function isSensitiveLogIdentifier(value: string): boolean {
  const normalized = normalizeSensitiveLabel(value);
  return SENSITIVE_KEY_LABELS.some((label) => normalized.includes(label));
}

function safeString(value: string): string {
  if (isSensitiveText(value)) return REDACTED;
  return value.length <= MAXIMUM_STRING_LENGTH
    ? value
    : `${value.slice(0, MAXIMUM_STRING_LENGTH)}${TRUNCATED}`;
}

function serializeError(error: Error, visited: WeakSet<object>, depth: number): LogValue {
  const serialized: Record<string, LogValue> = {
    name: safeString(error.name),
    message: safeString(error.message),
  };
  const stackDescriptor = Object.getOwnPropertyDescriptor(error, "stack");
  if (
    stackDescriptor !== undefined &&
    "value" in stackDescriptor &&
    typeof stackDescriptor.value === "string"
  ) {
    Object.defineProperty(serialized, "stack", {
      configurable: false,
      enumerable: true,
      value: safeString(stackDescriptor.value),
      writable: false,
    });
  }
  const causeDescriptor = Object.getOwnPropertyDescriptor(error, "cause");
  if (causeDescriptor !== undefined && "value" in causeDescriptor) {
    Object.defineProperty(serialized, "cause", {
      configurable: false,
      enumerable: true,
      value: serializeLogValue(causeDescriptor.value, visited, depth + 1),
      writable: false,
    });
  }
  return serialized;
}

function serializeDescriptorValue(
  descriptor: PropertyDescriptor,
  visited: WeakSet<object>,
  depth: number,
): LogValue {
  const candidate: unknown = descriptor.value;
  return serializeLogValue(candidate, visited, depth + 1);
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function serializeRecord(
  value: object,
  visited: WeakSet<object>,
  depth: number,
): Readonly<Record<string, LogValue>> | "[UNREADABLE_OBJECT]" {
  const output: Record<string, LogValue> = {};
  let keys: readonly string[];
  try {
    keys = Object.keys(value).slice(0, MAXIMUM_KEYS);
  } catch {
    return "[UNREADABLE_OBJECT]";
  }
  for (const [index, key] of keys.entries()) {
    const outputKey = key.length <= MAXIMUM_KEY_LENGTH ? key : `[TRUNCATED_KEY_${String(index)}]`;
    if (isSensitiveKey(key)) {
      Object.defineProperty(output, outputKey, {
        configurable: false,
        enumerable: true,
        value: REDACTED,
        writable: false,
      });
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && "value" in descriptor) {
      Object.defineProperty(output, outputKey, {
        configurable: false,
        enumerable: true,
        value: serializeDescriptorValue(descriptor, visited, depth),
        writable: false,
      });
    } else {
      Object.defineProperty(output, outputKey, {
        configurable: false,
        enumerable: true,
        value: "[UNREADABLE_VALUE]",
        writable: false,
      });
    }
  }
  return output;
}

export function serializeLogValue(value: unknown, visited = new WeakSet(), depth = 0): LogValue {
  if (depth >= MAXIMUM_DEPTH) return TRUNCATED;
  // eslint-disable-next-line unicorn/no-null -- JSON structured records preserve an explicit null diagnostic value.
  if (value === null) return null;
  switch (typeof value) {
    case "string": {
      return safeString(value);
    }
    case "boolean": {
      return value;
    }
    case "number": {
      return Number.isFinite(value) ? value.toString() : "[NON_FINITE_NUMBER]";
    }
    case "bigint": {
      if (value < 0n ? value <= -MAXIMUM_BIGINT_MAGNITUDE : value >= MAXIMUM_BIGINT_MAGNITUDE) {
        return TRUNCATED;
      }
      return value.toString();
    }
    case "undefined": {
      return "[UNDEFINED]";
    }
    case "symbol": {
      return "[SYMBOL]";
    }
    case "function": {
      return "[FUNCTION]";
    }
    case "object": {
      break;
    }
  }
  try {
    if (visited.has(value)) return "[CYCLE]";
    visited.add(value);
    if (value instanceof Error) return serializeError(value, visited, depth);
    if (isUnknownArray(value)) {
      const output: LogValue[] = [];
      for (const item of value) {
        if (output.length >= MAXIMUM_ARRAY_ITEMS) break;
        output.push(serializeLogValue(item, visited, depth + 1));
      }
      return output;
    }
    return serializeRecord(value, visited, depth);
  } catch {
    return "[UNREADABLE_OBJECT]";
  }
}

export function serializeLogFields(fields: unknown): Readonly<Record<string, LogValue>> {
  if (typeof fields !== "object" || fields === null) return { fields: serializeLogValue(fields) };
  const serialized = serializeRecord(fields, new WeakSet(), 0);
  return typeof serialized === "string" ? { fields: serialized } : serialized;
}

function readOwnRecordValue(record: unknown, key: string): unknown {
  if (typeof record !== "object" || record === null) return "[UNREADABLE_VALUE]";
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (descriptor === undefined) return undefined;
    if (!("value" in descriptor)) return "[UNREADABLE_VALUE]";
    return descriptor.value;
  } catch {
    return "[UNREADABLE_VALUE]";
  }
}

function isValidIdentifier(value: string): boolean {
  if (value.length === 0 || value.length > 128 || isSensitiveLogIdentifier(value)) return false;
  for (const character of value) {
    const code = Number(character.codePointAt(0));
    const isLowercaseLetter = code >= 97 && code <= 122;
    const isUppercaseLetter = code >= 65 && code <= 90;
    const isDigit = code >= 48 && code <= 57;
    if (
      !isLowercaseLetter &&
      !isUppercaseLetter &&
      !isDigit &&
      character !== "." &&
      character !== "-" &&
      character !== "_"
    ) {
      return false;
    }
  }
  return true;
}

function sanitizeIdentifier(value: unknown): string {
  return typeof value === "string" && isValidIdentifier(value) ? value : INVALID_IDENTIFIER;
}

function isValidEventPart(part: string): boolean {
  if (part.length === 0) return false;
  for (const character of part) {
    const code = Number(character.codePointAt(0));
    const isLowercaseLetter = code >= 97 && code <= 122;
    const isDigit = code >= 48 && code <= 57;
    if (!isLowercaseLetter && !isDigit) return false;
  }
  return true;
}

function isValidEvent(value: string): boolean {
  if (value.length > 160 || isSensitiveText(value)) return false;
  const parts = value.split(".");
  return parts.length >= 2 && parts.every((part) => isValidEventPart(part));
}

function sanitizeEvent(value: unknown): string {
  return typeof value === "string" && isValidEvent(value) ? value : INVALID_EVENT;
}

function isValidTimestamp(value: string): boolean {
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function sanitizeTimestamp(value: unknown): string {
  return typeof value === "string" && !isSensitiveText(value) && isValidTimestamp(value)
    ? value
    : INVALID_TIMESTAMP;
}

function sanitizeLevel(value: unknown): LogLevel {
  switch (value) {
    case "debug":
    case "info":
    case "warn":
    case "error": {
      return value;
    }
    default: {
      return "error";
    }
  }
}

export function sanitizeLogRecord(record: unknown): LogRecord {
  const timestamp = readOwnRecordValue(record, "timestamp");
  const level = readOwnRecordValue(record, "level");
  const event = readOwnRecordValue(record, "event");
  const component = readOwnRecordValue(record, "component");
  const runId = readOwnRecordValue(record, "runId");
  const correlationId = readOwnRecordValue(record, "correlationId");
  const strategyId = readOwnRecordValue(record, "strategyId");
  const symbol = readOwnRecordValue(record, "symbol");
  const datasetId = readOwnRecordValue(record, "datasetId");
  const orderId = readOwnRecordValue(record, "orderId");
  const fields = readOwnRecordValue(record, "fields");
  return {
    component: sanitizeIdentifier(component),
    correlationId: sanitizeIdentifier(correlationId),
    ...(strategyId !== undefined && { strategyId: sanitizeIdentifier(strategyId) }),
    ...(symbol !== undefined && { symbol: sanitizeIdentifier(symbol) }),
    ...(datasetId !== undefined && { datasetId: sanitizeIdentifier(datasetId) }),
    ...(orderId !== undefined && { orderId: sanitizeIdentifier(orderId) }),
    event: sanitizeEvent(event),
    fields: serializeLogFields(fields),
    level: sanitizeLevel(level),
    runId: sanitizeIdentifier(runId),
    timestamp: sanitizeTimestamp(timestamp),
  };
}
