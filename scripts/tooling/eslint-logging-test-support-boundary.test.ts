import { describe, expect, it } from "bun:test";
import { ESLint } from "eslint";

const source = 'import { RecordingLogger } from "@logging-testing";';
const subpathSource = 'import { RecordingLogger } from "@logging-testing/recording";';
const unrestrictedSource = 'import { Logger } from "@mm-crypto-bot/logging";';

const eslint = new ESLint({
  overrideConfigFile: "eslint.config.js",
});

async function restrictedImportMessages(sourceText: string, filePath: string): Promise<readonly string[]> {
  const [result] = await eslint.lintText(sourceText, { filePath });
  if (result === undefined) {
    throw new Error(`Expected ESLint result for ${filePath}`);
  }

  return result.messages
    .filter((message) => message.ruleId === "no-restricted-imports")
    .map((message) => message.message);
}

describe("logging test-support import boundary", () => {
  it("rejects the alias and its subpaths from every production TypeScript boundary", async () => {
    for (const [filePath, sourceText] of [
      ["apps/bot/src/bot/bot.ts", source],
      ["packages/logging/src/structured-logger.ts", source],
      ["apps/bot/src/bot/bot.ts", subpathSource],
      ["packages/logging/src/structured-logger.ts", subpathSource],
    ] as const) {
      const messages = await restrictedImportMessages(sourceText, filePath);

      expect(messages).toHaveLength(1);
    }
  }, 60_000);

  it("allows the alias only from actual test, test-support, and E2E boundaries", async () => {
    for (const filePath of [
      "apps/bot/src/bot/bot.runtime.test.ts",
      "apps/bot/src/bot/bot.test-support.ts",
      "apps/bot/test/e2e/runtime-driver/position-manager-boundaries.ts",
      "packages/logging/src/serialization.test.ts",
      "packages/logging/test-support/index.ts",
      "packages/logging/test/e2e/logging-e2e-artifact-run.test.ts",
    ]) {
      const messages = await restrictedImportMessages(source, filePath);

      expect(messages).toHaveLength(0);
    }
  }, 60_000);

  it("does not restrict production imports from the logging public API", async () => {
    const messages = await restrictedImportMessages(
      unrestrictedSource,
      "packages/logging/src/structured-logger.ts",
    );

    expect(messages).toHaveLength(0);
  }, 60_000);
});
