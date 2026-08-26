import { expect, test } from "bun:test";
import { ESLint } from "eslint";
import path from "node:path";
import { getParsedCommandLineOfConfigFile, sys } from "typescript";
import type { ParseConfigHost } from "typescript";

const botLintProject = "./apps/bot/tsconfig.eslint.json";
const representativeBotTest = "apps/bot/src/cli/commands/config.test.ts";
const botBuildProject = "apps/bot/tsconfig.json";
const repoRoot = path.resolve(import.meta.dir, "../..");
const botTestPatterns = [
  "apps/bot/**/*.test.ts",
  "apps/bot/**/*.spec.ts",
  "apps/bot/**/*.test.tsx",
  "apps/bot/**/*.spec.tsx",
  "apps/bot/**/*.test.mts",
  "apps/bot/**/*.spec.mts",
  "apps/bot/**/*.test.cts",
  "apps/bot/**/*.spec.cts",
] as const;
const syntheticBotTestPaths = [
  "apps/bot/src/cli/commands/config.spec.ts",
  "apps/bot/src/cli/commands/config.test.tsx",
  "apps/bot/src/cli/commands/config.spec.mts",
  "apps/bot/src/cli/commands/config.test.cts",
] as const;
const botBuildTestExcludes = [
  "**/*.test.ts",
  "**/*.spec.ts",
  "**/*.test.tsx",
  "**/*.spec.tsx",
  "**/*.test.mts",
  "**/*.spec.mts",
  "**/*.test.cts",
  "**/*.spec.cts",
] as const;

const eslint = new ESLint({
  overrideConfigFile: "eslint.config.js",
});

const asRecord = (candidate: unknown, label: string): Readonly<Record<string, unknown>> => {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    throw new Error(`Expected ${label} to be an object`);
  }

  return candidate;
};

const asStringArray = (candidate: unknown, label: string): readonly string[] => {
  if (!Array.isArray(candidate)) {
    throw new TypeError(`Expected ${label} to be an array of strings`);
  }

  const strings: string[] = [];
  for (const entry of candidate) {
    if (typeof entry !== "string") {
      throw new TypeError(`Expected ${label} to be an array of strings`);
    }

    strings.push(entry);
  }

  return strings;
};

const parseProject = (projectPath: string) => {
  const host: ParseConfigHost = {
    ...sys,
    onUnRecoverableConfigFileDiagnostic: () => {
      throw new Error(`TypeScript project is unreadable: ${projectPath}`);
    },
  };
  const parsed = getParsedCommandLineOfConfigFile(projectPath, {}, host);
  if (parsed === undefined) {
    throw new Error(`Unable to parse TypeScript project: ${projectPath}`);
  }

  if (parsed.errors.length > 0) {
    throw new Error(`TypeScript project contains diagnostics: ${projectPath}`);
  }

  return parsed;
};

const expectDedicatedTestProject = async (testPath: string): Promise<void> => {
  const effectiveConfig: unknown = await eslint.calculateConfigForFile(testPath);
  const languageOptions = asRecord(
    asRecord(effectiveConfig, "effective ESLint config").languageOptions,
    "language options",
  );
  const parserOptions = asRecord(languageOptions.parserOptions, "parser options");

  expect(parserOptions.project).toBe(botLintProject);
  expect(parserOptions.projectService).toBe(false);
  expect(parserOptions.allowDefaultProject).toBeUndefined();
};

const expectBotBuildTestBoundary = (
  noEmit: boolean | undefined,
  testPaths: readonly string[],
  buildFileNames: readonly string[],
  buildExcludes: readonly string[],
): void => {
  if (noEmit === true) {
    expect(noEmit).toBe(true);
    return;
  }

  for (const testExclude of botBuildTestExcludes) {
    expect(buildExcludes).toContain(testExclude);
  }

  for (const testPath of testPaths) {
    expect(buildFileNames).not.toContain(path.resolve(repoRoot, testPath));
  }
};

test("bot test and spec variants use a dedicated non-emitting TypeScript project", async () => {
  for (const testPath of syntheticBotTestPaths) {
    await expectDedicatedTestProject(testPath);
  }
});

test("the bot test lint project includes every test without joining an emitting build", async () => {
  const lintProject = parseProject(botLintProject);
  const buildProject = parseProject(botBuildProject);
  const buildConfig: unknown = JSON.parse(await Bun.file(path.resolve(repoRoot, botBuildProject)).text());
  const buildExcludes = asStringArray(
    asRecord(buildConfig, "bot build config").exclude,
    "bot build excludes",
  );
  const testPaths = botTestPatterns
    .flatMap((pattern) => [...new Bun.Glob(pattern).scanSync()])
    .toSorted((left, right) => left.localeCompare(right));

  expect(lintProject.options.noEmit).toBe(true);
  expect(lintProject.options.composite).toBe(false);
  expect(lintProject.options.rootDir).toBe(repoRoot);
  expect(testPaths).not.toHaveLength(0);

  for (const testPath of testPaths) {
    const absoluteTestPath = path.resolve(repoRoot, testPath);
    expect(lintProject.fileNames).toContain(absoluteTestPath);
  }

  expectBotBuildTestBoundary(buildProject.options.noEmit, testPaths, buildProject.fileNames, buildExcludes);
});

test("a non-emitting bot build permits test inclusion without build excludes", () => {
  const testPath = representativeBotTest;
  expectBotBuildTestBoundary(true, [testPath], [path.resolve(repoRoot, testPath)], []);
});

test("a representative bot test has no fatal typed-lint parsing failure", async () => {
  const lintResults: readonly unknown[] = await eslint.lintFiles([representativeBotTest]);
  const result = lintResults[0];
  if (result === undefined) {
    throw new Error(`Expected ESLint result for ${representativeBotTest}`);
  }

  expect(asRecord(result, "ESLint result").fatalErrorCount).toBe(0);
});
