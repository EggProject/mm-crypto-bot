import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const readRepoFile = (relativePath: string): Promise<string> =>
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Test inputs are fixed repository-relative paths declared in this file.
  readFile(new URL(`../../${relativePath}`, import.meta.url), "utf8");

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

test("Lefthook is not trusted and no configuration activates it automatically", async () => {
  const [manifest, lefthook] = await Promise.all([
    readRepoFile("package.json"),
    readRepoFile("lefthook.yml"),
  ]);

  expect(manifest).toMatch(/"trustedDependencies":\s*\[\s*"ccxt"\s*\]/u);
  expect(manifest).not.toMatch(/"trustedDependencies":\s*\[[^\]]*"lefthook"/u);
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

test("Slice A maps the approved hook order and governing sentence", async () => {
  const [standards, lefthook, pipeline, prettier] = await Promise.all([
    readRepoFile(".codex/ENGINEERING-STANDARDS.md"),
    readRepoFile("lefthook.yml"),
    readRepoFile("scripts/tooling/pre-commit-pipeline.ts"),
    readRepoFile(".prettierrc.json"),
  ]);

  expect(standards).toContain(
    "Lefthook MUST run ESLint before Prettier at pre-commit, then run only the allowlisted clean:artifacts command and worktree inspection.",
  );
  expect(lefthook).toContain("run: bun run hook:pre-commit");
  expect(pipeline.indexOf('"bun", "run", "lint:hook"')).toBeLessThan(
    pipeline.indexOf('"bun", "run", "format:check"'),
  );
  expect(pipeline.indexOf('"bun", "run", "format:check"')).toBeLessThan(
    pipeline.indexOf('"bun", "run", "clean:artifacts"'),
  );
  expect(pipeline.indexOf('"bun", "run", "clean:artifacts"')).toBeLessThan(
    pipeline.indexOf('"bun", "run", "worktree:inspect"'),
  );
  expect(prettier).toContain('"printWidth": 110');
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
