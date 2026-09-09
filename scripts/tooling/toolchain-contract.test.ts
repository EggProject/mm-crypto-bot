import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { lstat, readFile } from "node:fs/promises";
import { preCommitCommands } from "./pre-commit-pipeline.ts";

const readRepoFile = (relativePath: string): Promise<string> =>
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Test inputs are fixed repository-relative paths declared in this file.
  readFile(new URL(`../../${relativePath}`, import.meta.url), "utf8");

type Lstat = (path: string | URL) => Promise<unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

const isMissingPathError = (error: unknown): error is { code: string } => {
  if (!(error instanceof Error)) {
    return false;
  }

  if (!("code" in error) || typeof Reflect.get(error, "code") !== "string") {
    return false;
  }

  const code = Reflect.get(error, "code");
  return code === "ENOENT" || code === "ENOTDIR";
};

const assertPathMissing = async (relativePath: string, stat: Lstat = lstat): Promise<void> => {
  const target = fileURLToPath(new URL(`../../${relativePath}`, import.meta.url));

  try {
    await stat(target);
  } catch (error: unknown) {
    if (isMissingPathError(error)) {
      return;
    }

    throw error;
  }

  throw new Error(`Expected path to be absent but found: ${relativePath}`);
};

test("Slice A pins the approved runtime and tooling metadata", async () => {
  const [manifest, bunfig] = await Promise.all([readRepoFile("package.json"), readRepoFile("bunfig.toml")]);

  for (const requirement of [
    '"bun": "1.3.14"',
    '"node": "24.19.0"',
    '"@eslint/js": "10.0.1"',
    '"eslint": "10.8.1"',
    '"typescript": "6.0.3"',
    '"prettier": "3.9.6"',
    '"eslint-config-prettier": "10.1.8"',
    '"eslint-plugin-unicorn": "73.0.0"',
    '"lefthook": "2.1.10"',
  ]) {
    expect(manifest).toContain(requirement);
  }
  expect(bunfig).toContain("exact = true");
});

test("CCXT and Lefthook are untrusted and no configuration activates either automatically", async () => {
  const [manifest, lefthook] = await Promise.all([
    readRepoFile("package.json"),
    readRepoFile("lefthook.yml"),
  ]);

  expect(manifest).not.toContain('"trustedDependencies"');
  expect(manifest).not.toContain('"postinstall"');
  expect(lefthook).toContain("run: bun run hook:pre-commit");
});

test("CI invokes only the explicitly incomplete foundation verifier", async () => {
  const [manifest, workflow] = await Promise.all([
    readRepoFile("package.json"),
    readRepoFile(".github/workflows/ci.yml"),
  ]);

  expect(manifest).toContain('"verify:foundation": "bun scripts/tooling/verify-foundation.ts"');
  expect(manifest).not.toContain('"verify":');
  expect(workflow).toContain("  verify-foundation:\n");
  expect(workflow).toContain("name: Foundation verification (incomplete)");
  expect(workflow).not.toContain("  verify:\n");
  expect(workflow).toContain("bun run verify:foundation");
  expect(workflow).not.toContain("bun run verify\n");
});

test("root release verification consumer command invokes the artifact verifier", async () => {
  const manifest: unknown = JSON.parse(await readRepoFile("package.json"));

  if (!isRecord(manifest) || !isRecord(manifest["scripts"])) {
    throw new Error("Expected root package manifest scripts to be a record");
  }

  expect(manifest["scripts"]["release:verify"]).toBe("bun scripts/release/verify.ts");
});

test("root release coverage consumers use the exact publication-independent commands", async () => {
  // Catches a missing or altered public release coverage consumer command.
  const manifest: unknown = JSON.parse(await readRepoFile("package.json"));

  if (!isRecord(manifest) || !isRecord(manifest["scripts"])) {
    throw new Error("Expected root package manifest scripts to be a record");
  }

  expect(manifest["scripts"]["coverage:release:unit"]).toBe(
    "bun scripts/release/release-coverage.ts --level=unit",
  );
  expect(manifest["scripts"]["coverage:release:e2e"]).toBe(
    "bun scripts/release/release-coverage.ts --level=e2e",
  );
  expect(manifest["scripts"]["coverage:release"]).toBe("bun scripts/release/release-coverage.ts --level=all");
});

test("Slice A maps the approved hook integration and formatting contract", async () => {
  const [standards, lefthook, prettier] = await Promise.all([
    readRepoFile(".codex/ENGINEERING-STANDARDS.md"),
    readRepoFile("lefthook.yml"),
    readRepoFile(".prettierrc.json"),
  ]);

  expect(standards).toContain(
    "Lefthook MUST run ESLint before Prettier at pre-commit, then run only the allowlisted clean:artifacts command and worktree inspection.",
  );
  expect(lefthook).toContain("run: bun run hook:pre-commit");
  expect(preCommitCommands).toEqual([
    ["bun", "run", "lint:hook"],
    ["bun", "run", "format:hook"],
    ["bun", "run", "clean:artifacts"],
    ["bun", "run", "worktree:inspect"],
  ]);
  expect(prettier).toContain('"printWidth": 110');
});

test("artifact cleanup scripts reserve trusted authority for the explicit maintenance command", async () => {
  interface PackageManifest {
    readonly scripts: Record<string, string>;
  }

  const manifest = JSON.parse(await readRepoFile("package.json")) as PackageManifest;
  const defaultCleanup = manifest.scripts["clean:artifacts"];
  const dryRunCleanup = manifest.scripts["clean:artifacts:dry-run"];
  const trustedCleanup = manifest.scripts["clean:artifacts:trusted"];

  for (const inspectionScript of [defaultCleanup, dryRunCleanup]) {
    expect(inspectionScript).toContain('mode: "inspect"');
    expect(inspectionScript).not.toContain("trusted-cleanup");
  }
  expect(trustedCleanup).toContain('mode: "trusted-cleanup"');
  expect(trustedCleanup).toContain("cleanArtifacts");
});

test("pre-commit V8 coverage includes the artifact cleaner contract at complete thresholds", async () => {
  const configModule: unknown = await import("./vitest.pre-commit.config.mjs");
  if (!isRecord(configModule) || !isRecord(configModule["default"])) {
    throw new Error("Expected a pre-commit Vitest configuration module");
  }
  const testConfig = configModule["default"]["test"];

  if (!isRecord(testConfig)) {
    throw new Error("Expected a single pre-commit Vitest configuration");
  }
  const coverageConfig = testConfig["coverage"];
  if (!isRecord(coverageConfig)) {
    throw new Error("Expected pre-commit Vitest coverage configuration");
  }
  if (!isStringArray(testConfig["include"]) || !isStringArray(coverageConfig["include"])) {
    throw new Error("Expected explicit pre-commit Vitest include lists");
  }
  if (!isRecord(coverageConfig["thresholds"])) {
    throw new Error("Expected explicit pre-commit Vitest coverage thresholds");
  }

  for (const expectedTestFile of [
    "scripts/tooling/clean-artifacts.test.ts",
    "scripts/tooling/pre-commit-pipeline.test.ts",
    "scripts/tooling/staged-file-validation.test.ts",
  ]) {
    expect(testConfig["include"]).toContain(expectedTestFile);
  }
  for (const expectedSourceFile of [
    "scripts/tooling/clean-artifacts.ts",
    "scripts/tooling/pre-commit-pipeline.ts",
    "scripts/tooling/staged-file-validation.ts",
  ]) {
    expect(coverageConfig["include"]).toContain(expectedSourceFile);
  }
  expect(coverageConfig["thresholds"]).toEqual({
    branches: 100,
    functions: 100,
    lines: 100,
    statements: 100,
  });
});

test("lint scripts must stay fail-closed against temp reintroduction", async () => {
  interface PackageManifest {
    readonly scripts: Record<string, string>;
  }

  const manifest = (JSON.parse(await readRepoFile("package.json")) as PackageManifest).scripts;
  const expectedFullRepoLintScript =
    "eslint --config eslint.config.js apps packages scripts search-best-config eslint.config.js --max-warnings=0";
  const expectedFullRepoFormatScript = "prettier --check --ignore-unknown .";
  const expectedPreCommitHookScript =
    "bun --eval 'const { createBunCommandRunner, runPreCommitPipeline } = await import(\"./scripts/tooling/pre-commit-pipeline.ts\"); await runPreCommitPipeline(createBunCommandRunner(Bun.spawn));'";
  const expectedLintHookScript =
    'bun --eval \'const { createBunGitCommandRunner, createBunProcessCommandRunner, runStagedFileValidation } = await import("./scripts/tooling/staged-file-validation.ts"); await runStagedFileValidation("lint", { runGit: createBunGitCommandRunner(Bun.spawn), runProcess: createBunProcessCommandRunner(Bun.spawn) });\'';
  const expectedFormatHookScript =
    'bun --eval \'const { createBunGitCommandRunner, createBunProcessCommandRunner, runStagedFileValidation } = await import("./scripts/tooling/staged-file-validation.ts"); await runStagedFileValidation("format", { runGit: createBunGitCommandRunner(Bun.spawn), runProcess: createBunProcessCommandRunner(Bun.spawn) });\'';

  expect(manifest["lint"]).toBe(expectedFullRepoLintScript);
  expect(manifest["format:check"]).toBe(expectedFullRepoFormatScript);
  expect(manifest["hook:pre-commit"]).toBe(expectedPreCommitHookScript);
  expect(manifest["lint:hook"]).toBe(expectedLintHookScript);
  expect(manifest["format:hook"]).toBe(expectedFormatHookScript);
  expect(manifest["lint"]).not.toContain(" temp");
  expect(manifest["lint:hook"]).not.toContain(" temp");
  expect(manifest["lint"]).not.toContain("temp/");
  expect(manifest["lint:hook"]).not.toContain("temp/");
  await assertPathMissing("temp/ts");
  await assertPathMissing("temp/ts/rxjs");
});

test("lint-script temp absence guard reports present when stat indicates path exists", async () => {
  let actualError: unknown;
  try {
    await assertPathMissing("temp/ts", () => Promise.resolve(undefined));
  } catch (error: unknown) {
    actualError = error;
  }
  expect(actualError).toBeInstanceOf(Error);
  if (!(actualError instanceof Error)) {
    throw new Error("Expected assertPathMissing to throw Error");
  }
  expect(actualError.message).toContain("Expected path to be absent but found: temp/ts");
});

test("lint-script temp absence guard rethrows non-path-missing errors", async () => {
  const eaccesError = Object.assign(new Error("permission denied"), { code: "EACCES" });
  let actualError: unknown;

  try {
    await assertPathMissing("temp/ts/rxjs", () => Promise.reject(eaccesError));
  } catch (error: unknown) {
    actualError = error;
  }

  expect(actualError).toBe(eaccesError);
});

test("workspace manifests use exact external pins and have no install-time alias mutation", async () => {
  const manifestPaths = [
    "package.json",
    "apps/bot/package.json",
    "packages/backtest-tools/package.json",
    "packages/backtest/package.json",
    "packages/core/package.json",
    "packages/exchange/package.json",
    "packages/paper/package.json",
    "packages/shared/package.json",
  ];
  const manifests = await Promise.all(manifestPaths.map((manifestPath) => readRepoFile(manifestPath)));

  for (const manifest of manifests) {
    expect(manifest).not.toMatch(/": "[~^]/u);
  }

  const [rootManifest, botManifest, installerExists, binExists] = await Promise.all([
    readRepoFile("package.json"),
    readRepoFile("apps/bot/package.json"),
    Bun.file(new URL("../../scripts/install-mm-bot.sh", import.meta.url)).exists(),
    Bun.file(new URL("../../bin/mm-bot", import.meta.url)).exists(),
  ]);
  expect(rootManifest).toContain('"@tsconfig/bases": "1.0.27"');
  expect(rootManifest).toContain('"@types/node": "24.13.3"');
  expect(rootManifest).toContain('"turbo": "2.10.10"');
  expect(rootManifest).toContain('"protobufjs": "8.7.2"');
  expect(rootManifest).toContain('"smol-toml": "1.8.0"');
  expect(rootManifest).toContain('"write-file-atomic": "8.0.0"');
  expect(rootManifest).not.toContain('"postinstall"');
  expect(rootManifest).not.toContain('"mm-bot"');
  expect(botManifest).toContain('"picocolors": "1.1.1"');
  expect(botManifest).not.toContain('"bin"');
  expect(installerExists).toBe(false);
  expect(binExists).toBe(false);
});

test("the active bot operator surface has no binary command reference", async () => {
  const command = [
    "rg",
    "-nP",
    String.raw`mm-bot(?!\.toml|\.toml\.bak)`,
    "apps/bot/src/cli",
    "apps/bot/src/index.ts",
    "apps/bot/README.md",
    "--glob",
    "!*.test.ts",
    "--glob",
    "!*.spec.ts",
  ];
  const child = Bun.spawn({ cmd: command, stderr: "pipe", stdout: "pipe" });
  const exitCode = await child.exited;
  const output = await new Response(child.stdout).text();

  expect(exitCode).toBe(1);
  expect(output).toBe("");
  expect(await readRepoFile("apps/bot/README.md")).toContain("bun run apps/bot/src/index.ts");
});
