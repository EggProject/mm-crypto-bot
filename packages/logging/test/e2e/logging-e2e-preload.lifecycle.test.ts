import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LOGGING_E2E_CASE_IDS } from "./logging-e2e-case-contract.ts";
import {
  createLoggingE2eArtifactRun as createLoggingEndToEndArtifactRun,
  type LoggingE2eArtifactRun as LoggingEndToEndArtifactRun,
} from "./logging-e2e-artifact-run.ts";

type PreloadEvent = "beforeExit" | "exit";

interface PreloadEnvironment {
  readonly rawDirectory: string | undefined;
  readonly rawDevice: string | undefined;
  readonly rawInode: string | undefined;
  readonly caseId: string | undefined;
}

interface CoverageWriteRequest {
  readonly directoryPath: string;
  readonly expectedDirectoryIdentity: Readonly<{ device: bigint; inode: bigint }>;
  readonly fileName: string;
  readonly contents: Uint8Array;
  readonly label: string;
}

interface PreloadPort {
  readonly environment: PreloadEnvironment;
  readonly registerOnce: (event: PreloadEvent, callback: () => void) => void;
  readonly readCoverageDescriptor: () => PropertyDescriptor | undefined;
  readonly pid: number;
  readonly writeExclusiveFile: (request: CoverageWriteRequest) => void;
}

interface PreloadHarness {
  readonly callbacks: Readonly<Record<PreloadEvent, (() => void)[]>>;
  readonly port: PreloadPort;
  readonly writes: CoverageWriteRequest[];
}

interface EnvironmentSnapshot {
  readonly rawDirectory: string | undefined;
  readonly rawDevice: string | undefined;
  readonly rawInode: string | undefined;
  readonly caseId: string | undefined;
}

interface LifecycleFixture {
  artifactRun: LoggingEndToEndArtifactRun | undefined;
  beforeExitListenerCount: number;
  exitListenerCount: number;
  addedBeforeExitListeners: readonly NodeJS.BeforeExitListener[];
  addedExitListeners: readonly NodeJS.ExitListener[];
  installer: ((port: PreloadPort) => void) | undefined;
  originalEnvironment: EnvironmentSnapshot | undefined;
}

const lifecycleFixture: LifecycleFixture = {
  artifactRun: undefined,
  beforeExitListenerCount: 0,
  exitListenerCount: 0,
  addedBeforeExitListeners: [],
  addedExitListeners: [],
  installer: undefined,
  originalEnvironment: undefined,
};
const defaultCoveragePayload = Object.freeze({ path: "coverage" });

function baseEnvironment(): PreloadEnvironment {
  return {
    rawDirectory: "/coverage/raw",
    rawDevice: "4",
    rawInode: "8",
    caseId: LOGGING_E2E_CASE_IDS[0],
  };
}

function requireInstaller(): (port: PreloadPort) => void {
  if (lifecycleFixture.installer === undefined) throw new Error("Preload installer was not imported.");
  return lifecycleFixture.installer;
}

function requireArtifactRun(): LoggingEndToEndArtifactRun {
  if (lifecycleFixture.artifactRun === undefined) throw new Error("Preload artifact run was not created.");
  return lifecycleFixture.artifactRun;
}

function requireBeforeExitListener(): NodeJS.BeforeExitListener {
  const listener = lifecycleFixture.addedBeforeExitListeners[0];
  if (listener === undefined) throw new Error("Default beforeExit listener was not registered.");
  return listener;
}

function requireExitListener(): NodeJS.ExitListener {
  const listener = lifecycleFixture.addedExitListeners[0];
  if (listener === undefined) throw new Error("Default exit listener was not registered.");
  return listener;
}

function createHarness(
  environment: PreloadEnvironment = baseEnvironment(),
  coverage: unknown = defaultCoveragePayload,
  hasCoverageDescriptor = true,
  onWrite?: (request: CoverageWriteRequest) => void,
): PreloadHarness {
  const callbacks: Record<PreloadEvent, (() => void)[]> = { beforeExit: [], exit: [] };
  const writes: CoverageWriteRequest[] = [];
  return {
    callbacks,
    port: {
      environment: Object.freeze(environment),
      registerOnce: (event: PreloadEvent, callback: () => void): void => {
        const registeredCallbacks: (() => void)[] = Reflect.get(callbacks, event);
        registeredCallbacks.push(callback);
      },
      readCoverageDescriptor: (): PropertyDescriptor | undefined =>
        hasCoverageDescriptor ? { value: coverage } : undefined,
      pid: 42,
      writeExclusiveFile: (request: CoverageWriteRequest): void => {
        writes.push(request);
        onWrite?.(request);
      },
    },
    writes,
  };
}

function invokeCallbacks(callbacks: readonly (() => void)[]): void {
  for (const callback of callbacks) callback();
}

function captureEnvironment(): EnvironmentSnapshot {
  return Object.freeze({
    rawDirectory: readEnvironmentValue("MM_LOGGING_E2E_COVERAGE_RAW_DIR"),
    rawDevice: readEnvironmentValue("MM_LOGGING_E2E_COVERAGE_RAW_DEVICE"),
    rawInode: readEnvironmentValue("MM_LOGGING_E2E_COVERAGE_RAW_INODE"),
    caseId: readEnvironmentValue("MM_LOGGING_E2E_CASE_ID"),
  });
}

function readEnvironmentValue(name: string): string | undefined {
  const value: unknown = Reflect.get(process.env, name);
  return typeof value === "string" ? value : undefined;
}

function restoreEnvironmentValue(name: string, value: string | undefined): void {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, name);
    return;
  }
  Reflect.set(process.env, name, value);
}

function restoreEnvironment(snapshot: EnvironmentSnapshot): void {
  restoreEnvironmentValue("MM_LOGGING_E2E_COVERAGE_RAW_DIR", snapshot.rawDirectory);
  restoreEnvironmentValue("MM_LOGGING_E2E_COVERAGE_RAW_DEVICE", snapshot.rawDevice);
  restoreEnvironmentValue("MM_LOGGING_E2E_COVERAGE_RAW_INODE", snapshot.rawInode);
  restoreEnvironmentValue("MM_LOGGING_E2E_CASE_ID", snapshot.caseId);
}

function restoreCoverageDescriptor(descriptor: PropertyDescriptor | undefined): void {
  if (descriptor === undefined) {
    Reflect.deleteProperty(globalThis, "__coverage__");
    return;
  }
  Object.defineProperty(globalThis, "__coverage__", descriptor);
}

beforeAll(async () => {
  lifecycleFixture.originalEnvironment = captureEnvironment();
  lifecycleFixture.artifactRun = createLoggingEndToEndArtifactRun();
  const artifactRun = lifecycleFixture.artifactRun;
  Reflect.set(process.env, "MM_LOGGING_E2E_COVERAGE_RAW_DIR", artifactRun.paths.raw);
  Reflect.set(
    process.env,
    "MM_LOGGING_E2E_COVERAGE_RAW_DEVICE",
    artifactRun.identities.raw.device.toString(),
  );
  Reflect.set(process.env, "MM_LOGGING_E2E_COVERAGE_RAW_INODE", artifactRun.identities.raw.inode.toString());
  Reflect.set(process.env, "MM_LOGGING_E2E_CASE_ID", LOGGING_E2E_CASE_IDS[0]);
  lifecycleFixture.beforeExitListenerCount = process.listeners("beforeExit").length;
  lifecycleFixture.exitListenerCount = process.listeners("exit").length;
  const module = await import("./logging-e2e-preload.ts");
  lifecycleFixture.installer = module.installLoggingEndToEndPreload;
  lifecycleFixture.addedBeforeExitListeners = process
    .listeners("beforeExit")
    .slice(lifecycleFixture.beforeExitListenerCount);
  lifecycleFixture.addedExitListeners = process.listeners("exit").slice(lifecycleFixture.exitListenerCount);
});

afterAll(() => {
  for (const listener of lifecycleFixture.addedBeforeExitListeners)
    process.removeListener("beforeExit", listener);
  for (const listener of lifecycleFixture.addedExitListeners) process.removeListener("exit", listener);
  if (lifecycleFixture.originalEnvironment !== undefined)
    restoreEnvironment(lifecycleFixture.originalEnvironment);
  lifecycleFixture.artifactRun?.cleanup();
});

describe("logging E2E preload lifecycle", () => {
  it("registers exactly one removable default listener for each lifecycle event", () => {
    expect(lifecycleFixture.addedBeforeExitListeners).toHaveLength(1);
    expect(lifecycleFixture.addedExitListeners).toHaveLength(1);
    expect(process.listeners("beforeExit")).toHaveLength(lifecycleFixture.beforeExitListenerCount + 1);
    expect(process.listeners("exit")).toHaveLength(lifecycleFixture.exitListenerCount + 1);
  });

  it("writes one exact envelope through the default adapter and real verified writer", () => {
    const originalCoverageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "__coverage__");
    const coverage = Object.freeze({ defaultAdapter: true });
    Object.defineProperty(globalThis, "__coverage__", {
      configurable: true,
      enumerable: true,
      value: coverage,
      writable: true,
    });
    try {
      requireBeforeExitListener()(0);
      const artifactRun = requireArtifactRun();
      const fileName = `${LOGGING_E2E_CASE_IDS[0]}-${String(process.pid)}.json`;
      expect(artifactRun.adoptExternalFiles("raw")).toEqual([fileName]);
      expect(new TextDecoder().decode(artifactRun.readFile("raw", fileName))).toBe(
        `{"schemaVersion":1,"pid":${String(process.pid)},"caseId":"${LOGGING_E2E_CASE_IDS[0]}","coverage":{"defaultAdapter":true}}\n`,
      );
      requireExitListener()(0);
      expect(artifactRun.adoptExternalFiles("raw")).toEqual([fileName]);
    } finally {
      restoreCoverageDescriptor(originalCoverageDescriptor);
    }
  });

  it("rejects missing, empty, and relative raw directories", () => {
    for (const rawDirectory of [undefined, "", "relative/raw"]) {
      const harness = createHarness({ ...baseEnvironment(), rawDirectory });
      expect(() => {
        requireInstaller()(harness.port);
      }).toThrow("MM_LOGGING_E2E_COVERAGE_RAW_DIR must be a non-empty absolute path.");
    }
  });

  it("rejects malformed canonical raw directory identities", () => {
    const invalidIdentities: readonly (readonly [string, string | undefined])[] = [
      ["rawDevice", undefined],
      ["rawDevice", "-1"],
      ["rawDevice", "01"],
      ["rawDevice", "+1"],
      ["rawDevice", "1.5"],
      ["rawInode", undefined],
      ["rawInode", "-1"],
      ["rawInode", "01"],
      ["rawInode", "+1"],
      ["rawInode", "not-decimal"],
    ];
    for (const [name, value] of invalidIdentities) {
      const environment =
        name === "rawDevice"
          ? { ...baseEnvironment(), rawDevice: value }
          : { ...baseEnvironment(), rawInode: value };
      const harness = createHarness(environment);
      expect(() => {
        requireInstaller()(harness.port);
      }).toThrow(
        `${name === "rawDevice" ? "MM_LOGGING_E2E_COVERAGE_RAW_DEVICE" : "MM_LOGGING_E2E_COVERAGE_RAW_INODE"} must be a canonical nonnegative decimal BigInt.`,
      );
    }
  });

  it("rejects missing and undeclared case IDs", () => {
    for (const caseId of [undefined, "not-a-contract-case"]) {
      const harness = createHarness({ ...baseEnvironment(), caseId });
      expect(() => {
        requireInstaller()(harness.port);
      }).toThrow("MM_LOGGING_E2E_CASE_ID must be a declared logging E2E case ID.");
    }
  });

  it("does not write absent, primitive, or array coverage payloads", () => {
    const absentHarness = createHarness(baseEnvironment(), undefined, false);
    requireInstaller()(absentHarness.port);
    invokeCallbacks(absentHarness.callbacks.beforeExit);
    invokeCallbacks(absentHarness.callbacks.exit);
    expect(absentHarness.writes).toHaveLength(0);
    for (const coverage of [false, []]) {
      const harness = createHarness(baseEnvironment(), coverage);
      requireInstaller()(harness.port);
      invokeCallbacks(harness.callbacks.beforeExit);
      invokeCallbacks(harness.callbacks.exit);
      expect(harness.writes).toHaveLength(0);
    }
  });

  it("writes the exact envelope only once when beforeExit precedes exit", () => {
    const harness = createHarness(baseEnvironment(), { covered: true });
    requireInstaller()(harness.port);
    invokeCallbacks(harness.callbacks.beforeExit);
    invokeCallbacks(harness.callbacks.exit);
    expect(harness.writes).toHaveLength(1);
    expect(harness.writes[0]).toMatchObject({
      directoryPath: "/coverage/raw",
      expectedDirectoryIdentity: { device: 4n, inode: 8n },
      fileName: `${LOGGING_E2E_CASE_IDS[0]}-42.json`,
      label: "Logging E2E raw coverage",
    });
    expect(new TextDecoder().decode(harness.writes[0]?.contents)).toBe(
      `{"schemaVersion":1,"pid":42,"caseId":"${LOGGING_E2E_CASE_IDS[0]}","coverage":{"covered":true}}\n`,
    );
  });

  it("writes only once when exit precedes beforeExit", () => {
    const harness = createHarness();
    requireInstaller()(harness.port);
    invokeCallbacks(harness.callbacks.exit);
    invokeCallbacks(harness.callbacks.beforeExit);
    expect(harness.writes).toHaveLength(1);
  });

  it("propagates writer failures without retrying", () => {
    const failure = new Error("write failure");
    const harness = createHarness(baseEnvironment(), { covered: true }, true, () => {
      throw failure;
    });
    requireInstaller()(harness.port);
    expect(() => {
      invokeCallbacks(harness.callbacks.beforeExit);
    }).toThrow(failure);
    invokeCallbacks(harness.callbacks.exit);
    expect(harness.writes).toHaveLength(1);
  });
});
