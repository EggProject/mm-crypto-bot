import { describe, expect, it } from "bun:test";
import { ESLint } from "eslint";
import tseslint from "typescript-eslint";

const topLevelInvocation = `export const preloadEntryPoint = "logging";
function install(): void {
  globalThis;
}
install();`;
const eslint = new ESLint({
  overrideConfigFile: "eslint.config.js",
  overrideConfig: {
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      parserOptions: {
        project: false,
        projectService: false,
      },
    },
  },
});

async function topLevelSideEffectRuleIds(filePath: string): Promise<readonly string[]> {
  const [result] = await eslint.lintText(topLevelInvocation, { filePath });
  if (result === undefined) {
    throw new Error(`Expected ESLint result for ${filePath}`);
  }

  return result.messages
    .filter((message) => message.ruleId === "unicorn/no-top-level-side-effects")
    .map((message) => message.ruleId ?? "");
}

describe("logging E2E entrypoint lint boundary", () => {
  it("allows the required top-level installer only for exact E2E entrypoints", async () => {
    expect(await topLevelSideEffectRuleIds("packages/logging/test/e2e/logging-e2e-preload.ts")).toEqual([]);
    expect(
      await topLevelSideEffectRuleIds("packages/logging/test/e2e/run-logging-e2e-coverage-cli.ts"),
    ).toEqual([]);
  }, 60_000);

  it("rejects the same top-level installer from every other E2E module", async () => {
    expect(await topLevelSideEffectRuleIds("packages/logging/test/e2e/other.ts")).toEqual([
      "unicorn/no-top-level-side-effects",
    ]);
  }, 60_000);

  it("rejects the same top-level installer from production source", async () => {
    expect(await topLevelSideEffectRuleIds("packages/logging/src/structured-logger.ts")).toEqual([
      "unicorn/no-top-level-side-effects",
    ]);
  }, 60_000);
});
