import { describe, expect, expectTypeOf, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createLogger, type Logger } from "@mm-crypto-bot/shared";
import { clamp } from "@mm-crypto-bot/shared/utils";

describe("shared public package API", () => {
  it("exports the logger contract through the package barrel", () => {
    const logger = createLogger({ noFile: true });
    expectTypeOf(logger).toEqualTypeOf<Logger>();
    expect(typeof logger.info).toBe("function");
  });

  it("exports deterministic utility functions through the public subpath", () => {
    expect(clamp(11, 0, 10)).toBe(10);
  });

  it("honors logDir through the public package barrel", () => {
    const logDirectory = mkdtempSync(path.join(tmpdir(), "shared-public-api-"));
    try {
      createLogger({ logDir: logDirectory, logFileBase: "contract" }).info("contract-log");
      const date = new Date().toISOString().slice(0, 10);
      const logPath = path.join(logDirectory, `contract-${date}.log`);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- The contract test reads only its mkdtempSync-owned path.
      expect(readFileSync(logPath, "utf8")).toContain("contract-log");
    } finally {
      rmSync(logDirectory, { recursive: true, force: true });
    }
  });
});
