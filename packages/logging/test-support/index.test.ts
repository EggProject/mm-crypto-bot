import { describe, expect, it } from "vitest";

import { createNullLogger, RecordingLogger } from "./index.js";

describe("logging test helpers", () => {
  it("records typed calls in their original order", () => {
    const logger = new RecordingLogger();
    logger.debug("bot.debug");
    logger.info("bot.started", { symbol: "BTC/USDT" });
    logger.warn("bot.warning");
    logger.error("bot.failed");
    logger.critical("risk.audit.failed");

    expect(logger.getCalls()).toEqual([
      { level: "debug", event: "bot.debug", fields: undefined },
      { level: "info", event: "bot.started", fields: { symbol: "BTC/USDT" } },
      { level: "warn", event: "bot.warning", fields: undefined },
      { level: "error", event: "bot.failed", fields: undefined },
      { level: "critical", event: "risk.audit.failed", fields: undefined },
    ]);
  });

  it("returns an inert test logger that rejects critical audit events", () => {
    const logger = createNullLogger();
    logger.debug("bot.debug");
    logger.info("bot.info");
    logger.warn("bot.warn");
    logger.error("bot.error");
    expect(() => {
      logger.critical("bot.critical");
    }).toThrow("cannot accept a critical audit event");
    expect(Object.isFrozen(logger)).toBe(true);
  });
});
