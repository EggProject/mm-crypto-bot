import { StderrJsonSink } from "../../src/index.ts";
import {
  assertCanonicalInvalidRecord,
  assertCondition,
  assertUnreadableFields,
  FIXED_TIMESTAMP,
  isUnknownRecord,
  readSerializedRecord,
  RecordingStderrJsonWritable,
  REDACTION_SENTINEL,
} from "./logging-e2e-contract-serialization-support.ts";

export function runPublicStderrUntrustedRecordBoundary(): Promise<void> {
  const writable = new RecordingStderrJsonWritable();
  const sink = new StderrJsonSink(writable);
  let getterAccessCount = 0;
  const getterRecord = Object.defineProperties(
    {},
    {
      component: {
        enumerable: true,
        get(): string {
          getterAccessCount += 1;
          return "must-not-be-read";
        },
      },
      fields: {
        enumerable: true,
        get(): string {
          getterAccessCount += 1;
          return "must-not-be-read";
        },
      },
    },
  );
  const invalidRecord = Object.defineProperty(
    {
      component: `token-${REDACTION_SENTINEL}`,
      correlationId: "invalid identifier",
      event: "not a valid event",
      level: "critical",
      runId: "",
      timestamp: "not-a-timestamp",
    },
    "fields",
    {
      enumerable: true,
      get(): string {
        getterAccessCount += 1;
        return "must-not-be-read";
      },
    },
  );
  const descriptorThrowingProxy = new Proxy(
    {},
    {
      getOwnPropertyDescriptor(): never {
        throw new Error("Descriptor reads must fail closed.");
      },
    },
  );
  const unreadableFieldsRoot = new Proxy(
    {},
    {
      ownKeys(): never {
        throw new Error("Field keys must fail closed.");
      },
    },
  );
  const malformedRoots: readonly unknown[] = [
    undefined,
    7,
    getterRecord,
    invalidRecord,
    descriptorThrowingProxy,
  ];
  const additionalMalformedRecords: readonly unknown[] = [
    {
      component: "logging-e2e",
      correlationId: "correlation-e2e-1",
      event: "logging.e2e",
      fields: unreadableFieldsRoot,
      level: "info",
      runId: "run-e2e-1",
      timestamp: FIXED_TIMESTAMP,
    },
    {
      component: "logging-e2e",
      correlationId: "correlation-e2e-1",
      event: ".logging",
      fields: {},
      level: "info",
      runId: "run-e2e-1",
      timestamp: FIXED_TIMESTAMP,
    },
    {
      component: "logging-e2e",
      correlationId: "correlation-e2e-1",
      event: "logging.Évent",
      fields: {},
      level: "info",
      runId: "run-e2e-1",
      timestamp: FIXED_TIMESTAMP,
    },
    {
      component: "logging-e2e",
      correlationId: "correlation-e2e-1",
      event: `logging.${"a".repeat(153)}`,
      fields: {},
      level: "info",
      runId: "run-e2e-1",
      timestamp: FIXED_TIMESTAMP,
    },
  ];

  for (const malformedRoot of malformedRoots) {
    Reflect.apply(sink.write.bind(sink), sink, [malformedRoot]);
  }
  for (const malformedRecord of additionalMalformedRecords) {
    Reflect.apply(sink.write.bind(sink), sink, [malformedRecord]);
  }

  assertCondition(getterAccessCount === 0, "Untrusted record accessors must never execute.");
  const serializedRecords = writable.getWrittenChunks().map((chunk) => readSerializedRecord(chunk));
  assertCondition(
    serializedRecords.length === malformedRoots.length + additionalMalformedRecords.length,
    "Every malformed root must produce JSONL.",
  );
  for (const serializedRecord of serializedRecords.slice(0, malformedRoots.length)) {
    assertCanonicalInvalidRecord(serializedRecord);
  }
  const unreadableFieldsRecord = serializedRecords[malformedRoots.length];
  assertCondition(unreadableFieldsRecord !== undefined, "Unreadable fields root record must be serialized.");
  assertCondition(
    unreadableFieldsRecord["timestamp"] === FIXED_TIMESTAMP,
    "Valid timestamps must be preserved.",
  );
  assertCondition(unreadableFieldsRecord["level"] === "info", "Valid levels must be preserved.");
  assertCondition(unreadableFieldsRecord["event"] === "logging.e2e", "Valid events must be preserved.");
  assertCondition(
    unreadableFieldsRecord["component"] === "logging-e2e",
    "Valid components must be preserved.",
  );
  assertCondition(unreadableFieldsRecord["runId"] === "run-e2e-1", "Valid run IDs must be preserved.");
  assertCondition(
    unreadableFieldsRecord["correlationId"] === "correlation-e2e-1",
    "Valid correlation IDs must be preserved.",
  );
  assertUnreadableFields(unreadableFieldsRecord, "[UNREADABLE_OBJECT]");

  const invalidEventRecords = serializedRecords.slice(malformedRoots.length + 1);
  for (const serializedRecord of invalidEventRecords) {
    assertCondition(serializedRecord["timestamp"] === FIXED_TIMESTAMP, "Valid timestamps must be preserved.");
    assertCondition(serializedRecord["level"] === "info", "Valid levels must be preserved.");
    assertCondition(
      serializedRecord["event"] === "logging.invalid.record",
      "Invalid events must use the canonical event.",
    );
    assertCondition(serializedRecord["component"] === "logging-e2e", "Valid components must be preserved.");
    assertCondition(serializedRecord["runId"] === "run-e2e-1", "Valid run IDs must be preserved.");
    assertCondition(
      serializedRecord["correlationId"] === "correlation-e2e-1",
      "Valid correlation IDs must be preserved.",
    );
    const fields = serializedRecord["fields"];
    assertCondition(isUnknownRecord(fields), "Valid empty fields must remain an object.");
    assertCondition(Object.keys(fields).length === 0, "Valid empty fields must be preserved.");
  }
  return Promise.resolve();
}
