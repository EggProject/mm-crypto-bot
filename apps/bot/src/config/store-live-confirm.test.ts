import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createTestBotConfig } from "./config-test-fixtures.test-support.js";
import { ConfigLiveConfirmError, ConfigStore, ConfigValidationError } from "./store.js";

function isAuditRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function captureAuditRecord(
  records: Record<string, unknown>[],
): (_auditPath: string, contents: string) => void {
  return (_auditPath, contents) => {
    const parsed: unknown = JSON.parse(contents);
    if (!isAuditRecord(parsed)) {
      throw new Error("Expected a JSON object audit record");
    }
    records.push(parsed);
  };
}

describe("ConfigStore.writeAfterTypedLive", () => {
  let temporaryDirectory: string;
  let configPath: string;

  beforeEach(() => {
    temporaryDirectory = mkdtempSync(path.join(tmpdir(), "mm-bot-live-"));
    configPath = path.join(temporaryDirectory, "mm-bot.toml");
    new ConfigStore(configPath).write(createTestBotConfig());
  });

  afterEach(() => {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it("writes linked pending and committed records around a successful live transition", () => {
    const records: Record<string, unknown>[] = [];
    const store = new ConfigStore(configPath, { appendText: captureAuditRecord(records) });
    const committed = store.writeAfterTypedLive(createTestBotConfig({ bot: { mode: "live" } }), "LIVE");

    expect(committed.status).toBe("committed");
    expect(committed.previousMode).toBe("paper");
    expect(committed.newMode).toBe("live");
    expect(records).toHaveLength(2);
    expect(records[0]?.["status"]).toBe("pending");
    expect(records[0]?.["success"]).toBe(false);
    expect(records[1]?.["status"]).toBe("committed");
    expect(records[1]?.["success"]).toBe(true);
    expect(records[0]?.["transactionId"]).toBe(committed.transactionId);
    expect(records[1]?.["transactionId"]).toBe(committed.transactionId);
    expect(store.read().bot.mode).toBe("live");
  });

  it("derives the previous mode from persisted configuration", () => {
    const records: Record<string, unknown>[] = [];
    const store = new ConfigStore(configPath, { appendText: captureAuditRecord(records) });
    store.write(createTestBotConfig({ bot: { mode: "live" } }));

    expect(
      store.writeAfterTypedLive(createTestBotConfig({ bot: { mode: "live" } }), "LIVE").previousMode,
    ).toBe("live");
  });

  it("rejects confirmation text that is not exactly LIVE before writing an audit record", () => {
    const records: Record<string, unknown>[] = [];
    const store = new ConfigStore(configPath, { appendText: captureAuditRecord(records) });
    expect(() => store.writeAfterTypedLive(createTestBotConfig({ bot: { mode: "live" } }), "live")).toThrow(
      ConfigLiveConfirmError,
    );
    expect(store.read().bot.mode).toBe("paper");
    expect(records).toHaveLength(0);
  });

  it("validates an unknown live candidate before writing a pending audit record", () => {
    const records: Record<string, unknown>[] = [];
    const store = new ConfigStore(configPath, { appendText: captureAuditRecord(records) });
    const invalidCandidate: unknown = { bot: { mode: "live" }, risk: { max_leverage: 15 } };

    expect(() => store.writeAfterTypedLive(invalidCandidate, "LIVE")).toThrow(ConfigValidationError);
    expect(records).toHaveLength(0);
    expect(store.read().bot.mode).toBe("paper");
  });

  it("rejects a valid non-live candidate before writing a pending audit record", () => {
    const records: Record<string, unknown>[] = [];
    const store = new ConfigStore(configPath, { appendText: captureAuditRecord(records) });
    expect(() => store.writeAfterTypedLive(createTestBotConfig(), "LIVE")).toThrow(ConfigLiveConfirmError);
    expect(records).toHaveLength(0);
  });

  it("leaves only a non-success pending record when the atomic write fails", () => {
    const writeFailure = new Error("atomic write failed");
    const records: Record<string, unknown>[] = [];
    const store = new ConfigStore(configPath, {
      appendText: captureAuditRecord(records),
      atomicWrite: () => {
        throw writeFailure;
      },
    });

    expect(() => store.writeAfterTypedLive(createTestBotConfig({ bot: { mode: "live" } }), "LIVE")).toThrow(
      "atomic write failed",
    );
    expect(records).toHaveLength(1);
    expect(records[0]?.["status"]).toBe("pending");
    expect(records[0]?.["success"]).toBe(false);
    expect(store.read().bot.mode).toBe("paper");
  });

  it("fails closed when the pending audit record cannot be appended", () => {
    const auditFailure = new Error("pending audit failed");
    const records: Record<string, unknown>[] = [];
    const store = new ConfigStore(configPath, {
      appendText: () => {
        throw auditFailure;
      },
    });

    expect(() => store.writeAfterTypedLive(createTestBotConfig({ bot: { mode: "live" } }), "LIVE")).toThrow(
      "pending audit failed",
    );
    expect(records).toHaveLength(0);
    expect(store.read().bot.mode).toBe("paper");
  });

  it("leaves recovery evidence without a committed claim when the final audit append fails", () => {
    const finalAuditFailure = new Error("final audit failed");
    const records: Record<string, unknown>[] = [];
    const capture = captureAuditRecord(records);
    let appendCount = 0;
    const store = new ConfigStore(configPath, {
      appendText: (auditPath, contents) => {
        appendCount += 1;
        if (appendCount === 2) throw finalAuditFailure;
        capture(auditPath, contents);
      },
    });

    expect(() => store.writeAfterTypedLive(createTestBotConfig({ bot: { mode: "live" } }), "LIVE")).toThrow(
      "final audit failed",
    );
    expect(records).toHaveLength(1);
    expect(records[0]?.["status"]).toBe("pending");
    expect(records[0]?.["success"]).toBe(false);
    expect(store.read().bot.mode).toBe("live");
  });
});
