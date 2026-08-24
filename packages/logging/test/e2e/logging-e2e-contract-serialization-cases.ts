import {
  assertCondition,
  assertLoggingError,
  createLogger,
  createNineLevelObject,
  isLogArray,
  isLogObject,
  OVERLONG_KEY,
  RecordingSink,
  REDACTION_SENTINEL,
  requireLogger,
} from "./logging-e2e-contract-serialization-support.ts";

export function runPublicRequireLoggerContract(): Promise<void> {
  const logger = createLogger(new RecordingSink());
  assertCondition(
    requireLogger(logger, "logging-e2e") === logger,
    "Injected logger identity must be preserved.",
  );
  assertLoggingError(
    () => {
      requireLogger(undefined, "logging-e2e");
    },
    "INVALID_CONTEXT",
    "Logger must be injected into logging-e2e.",
  );
  return Promise.resolve();
}

export async function runPublicSerializationAdversarialValues(): Promise<void> {
  const sink = new RecordingSink();
  const logger = createLogger(sink);
  const accessorObject = Object.defineProperty({}, "accessorValue", {
    enumerable: true,
    get(): never {
      throw new Error("Accessor must not be executed.");
    },
  });
  const unreadableObject = new Proxy(
    {},
    {
      ownKeys(): never {
        throw new Error("ownKeys must not escape serialization.");
      },
    },
  );
  const prototypeThrowingObject = new Proxy(
    {},
    {
      getPrototypeOf(): never {
        throw new Error("Prototype reads must not escape serialization.");
      },
    },
  );
  const errorWithCause = new Error("safe error", {
    cause: { nestedCause: "safe cause" },
  });
  Object.defineProperty(errorWithCause, "stack", {
    configurable: true,
    value: "safe stack",
  });
  const descriptorlessError = new Error("descriptorless error", { cause: "descriptorless cause" });
  Reflect.deleteProperty(descriptorlessError, "stack");
  Reflect.deleteProperty(descriptorlessError, "cause");

  logger.info("logging.e2e.contract.serialization", {
    [OVERLONG_KEY]: "overlong-key-value",
    explicitNull: /never-match/u.exec(""),
    explicitFalse: false,
    symbolValue: Symbol("symbol-value"),
    functionValue: (): undefined => undefined,
    negativeBigint: -(10n ** 1024n),
    array65: Array.from({ length: 65 }, (_value, index) => `array-${String(index)}`),
    nineLevels: createNineLevelObject(),
    selfCycle: (() => {
      const cycle: Record<string, unknown> = {};
      cycle["self"] = cycle;
      return cycle;
    })(),
    redacted01: `token: ${REDACTION_SENTINEL}`,
    redacted02: `authorization = ${REDACTION_SENTINEL}`,
    redacted03: `{"credential":"${REDACTION_SENTINEL}"}`,
    redacted04: `cookie=${REDACTION_SENTINEL}`,
    redacted05: `session-id=${REDACTION_SENTINEL}`,
    redacted06: `sk-${REDACTION_SENTINEL}`,
    redacted07: `ghp_${REDACTION_SENTINEL}`,
    redacted08: `https://operator:${REDACTION_SENTINEL}@example.invalid/path`,
    redacted09: `https%3A%2F%2Foperator%3A${REDACTION_SENTINEL}%40example.invalid%2Fpath`,
    redacted10: `https://${REDACTION_SENTINEL}@example.invalid/path`,
    redacted11: `https%3A%2F%2F${REDACTION_SENTINEL}%40example.invalid%2Fpath`,
    safeAuthority: "https://example.invalid",
    endOfStringLabel: "token",
    malformedEscape: "https%3A%2F%2Fexample.invalid%ZZ/path",
    longSafeString: "s".repeat(8193),
    accessorObject,
    unreadableObject,
    prototypeThrowingContainer: { nested: prototypeThrowingObject },
    errorWithCause,
    descriptorlessError,
  });
  await logger.flush();

  const records = sink.getStoredRecords();
  assertCondition(records.length === 1, "Exactly one serialized record must be stored after flush.");
  const record = records[0];
  assertCondition(record !== undefined, "Stored serialized record must be defined.");
  const fields = record.fields;

  assertCondition(
    fields["[TRUNCATED_KEY_0]"] === "[REDACTED]",
    "Overlong keys must redact deterministically.",
  );
  assertCondition(fields["explicitNull"] === null, "Explicit null must be preserved.");
  assertCondition(fields["explicitFalse"] === false, "False must be preserved.");
  assertCondition(fields["symbolValue"] === "[SYMBOL]", "Symbols must be marked.");
  assertCondition(fields["functionValue"] === "[FUNCTION]", "Functions must be marked.");
  assertCondition(fields["negativeBigint"] === "[TRUNCATED]", "Bounded negative bigint must truncate.");

  const array65 = fields["array65"];
  assertCondition(isLogArray(array65), "Array fields must remain arrays.");
  assertCondition(array65.length === 64, "Arrays must truncate at 64 items.");
  assertCondition(array65[63] === "array-63", "The last retained array item must be deterministic.");

  const depth1 = fields["nineLevels"];
  assertCondition(isLogObject(depth1), "Depth one must remain an object.");
  const depth2 = depth1["depth1"];
  assertCondition(isLogObject(depth2), "Depth two must remain an object.");
  const depth3 = depth2["depth2"];
  assertCondition(isLogObject(depth3), "Depth three must remain an object.");
  const depth4 = depth3["depth3"];
  assertCondition(isLogObject(depth4), "Depth four must remain an object.");
  const depth5 = depth4["depth4"];
  assertCondition(isLogObject(depth5), "Depth five must remain an object.");
  const depth6 = depth5["depth5"];
  assertCondition(isLogObject(depth6), "Depth six must remain an object.");
  const depth7 = depth6["depth6"];
  assertCondition(isLogObject(depth7), "Depth seven must remain an object.");
  assertCondition(
    depth7["depth7"] === "[TRUNCATED]",
    "The public nesting bound must truncate at depth eight.",
  );

  const selfCycle = fields["selfCycle"];
  assertCondition(isLogObject(selfCycle), "Self-cycle root must be serialized as an object.");
  assertCondition(selfCycle["self"] === "[CYCLE]", "Self-cycle references must be marked.");

  assertCondition(fields["redacted01"] === "[REDACTED]", "Token text must be redacted.");
  assertCondition(fields["redacted02"] === "[REDACTED]", "Authorization text must be redacted.");
  assertCondition(fields["redacted03"] === "[REDACTED]", "Credential JSON must be redacted.");
  assertCondition(fields["redacted04"] === "[REDACTED]", "Cookie text must be redacted.");
  assertCondition(fields["redacted05"] === "[REDACTED]", "Session text must be redacted.");
  assertCondition(fields["redacted06"] === "[REDACTED]", "OpenAI-shaped key text must be redacted.");
  assertCondition(fields["redacted07"] === "[REDACTED]", "GitHub-shaped key text must be redacted.");
  assertCondition(fields["redacted08"] === "[REDACTED]", "Plain URL userinfo must be redacted.");
  assertCondition(fields["redacted09"] === "[REDACTED]", "Escaped URL userinfo must be redacted.");
  assertCondition(fields["redacted10"] === "[REDACTED]", "Username-only URL userinfo must be redacted.");
  assertCondition(
    fields["redacted11"] === "[REDACTED]",
    "Escaped username-only URL userinfo must be redacted.",
  );
  assertCondition(
    fields["safeAuthority"] === "https://example.invalid",
    "Safe URI authorities must be preserved.",
  );
  assertCondition(
    fields["endOfStringLabel"] === "token",
    "End-of-string sensitive labels without values must be preserved.",
  );
  assertCondition(
    fields["malformedEscape"] === "https%3A%2F%2Fexample.invalid%ZZ/path",
    "Malformed non-secret escapes must be preserved.",
  );
  assertCondition(
    fields["longSafeString"] === `${"s".repeat(8192)}[TRUNCATED]`,
    "Safe strings must truncate after 8192 characters.",
  );

  const accessorValue = fields["accessorObject"];
  assertCondition(isLogObject(accessorValue), "Accessor container must remain an object.");
  assertCondition(accessorValue["accessorValue"] === "[UNREADABLE_VALUE]", "Accessors must not execute.");
  assertCondition(fields["unreadableObject"] === "[UNREADABLE_OBJECT]", "Unreadable objects must be marked.");
  const prototypeThrowingContainer = fields["prototypeThrowingContainer"];
  assertCondition(
    isLogObject(prototypeThrowingContainer),
    "Prototype-throwing container must remain an object.",
  );
  assertCondition(
    prototypeThrowingContainer["nested"] === "[UNREADABLE_OBJECT]",
    "Prototype access failures must not escape serialization.",
  );

  const serializedError = fields["errorWithCause"];
  assertCondition(isLogObject(serializedError), "Errors must serialize to objects.");
  assertCondition(serializedError["stack"] === "safe stack", "Safe error stack must be preserved.");
  const serializedCause = serializedError["cause"];
  assertCondition(isLogObject(serializedCause), "Safe error cause must be serialized.");
  assertCondition(serializedCause["nestedCause"] === "safe cause", "Nested error cause must be preserved.");

  const serializedDescriptorlessError = fields["descriptorlessError"];
  assertCondition(
    isLogObject(serializedDescriptorlessError),
    "Descriptorless error must serialize to an object.",
  );
  assertCondition(
    !Object.hasOwn(serializedDescriptorlessError, "stack") &&
      !Object.hasOwn(serializedDescriptorlessError, "cause"),
    "Removed error stack and cause descriptors must not be serialized.",
  );
  assertCondition(
    !JSON.stringify(record).includes(REDACTION_SENTINEL),
    "Serialized record must not contain the secret sentinel.",
  );
}
