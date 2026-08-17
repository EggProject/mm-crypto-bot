/* eslint-disable security/detect-non-literal-fs-filename -- every test path is below a fresh mkdtemp directory */
import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isRuntimeSourcePath, loadScopeManifest, missingModifiedRuntimeFiles } from "./bot-runtime-scope.ts";
import { collectChangedBotSourceFiles } from "./verify-bot-runtime-scope.ts";

function runGit(repository: string, arguments_: readonly string[]): string {
  const result = spawnSync("git", arguments_, { cwd: repository, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${arguments_.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout.trim();
}

function createRepository(): { readonly path: string; readonly base: string } {
  const path = mkdtempSync(join(tmpdir(), "mm-bot-scope-git-"));
  mkdirSync(join(path, "apps/bot/src"), { recursive: true });
  runGit(path, ["init", "--quiet"]);
  runGit(path, ["config", "user.name", "Coverage Test"]);
  runGit(path, ["config", "user.email", "coverage@example.invalid"]);
  writeFileSync(join(path, "apps/bot/src/existing.ts"), "export const existing = true;\n", "utf8");
  runGit(path, ["add", "apps/bot/src/existing.ts"]);
  runGit(path, ["commit", "--quiet", "-m", "initial"]);
  return { path, base: runGit(path, ["rev-parse", "HEAD"]) };
}

describe("bot runtime scope completeness", () => {
  it("classifies runtime, test and declaration paths explicitly", () => {
    expect(isRuntimeSourcePath("apps/bot/src/bot/bot.ts")).toBe(true);
    expect(isRuntimeSourcePath("apps/bot/src/bot/bot.test.ts")).toBe(false);
    expect(isRuntimeSourcePath("apps/bot/src/global-types/example.d.ts")).toBe(false);
    expect(isRuntimeSourcePath("packages/core/src/index.ts")).toBe(false);
  });

  it("reports every modified runtime file omitted from the manifest", () => {
    const manifest = loadScopeManifest();
    const omitted = manifest.runtimeFiles[0];
    if (omitted === undefined) throw new Error("coverage manifest has no runtime file");
    const incomplete = manifest.runtimeFiles.filter((file) => file !== omitted);
    expect(
      missingModifiedRuntimeFiles(incomplete, [
        omitted,
        "apps/bot/src/bot/bot.test.ts",
        "apps/bot/src/global-types/write-file-atomic.d.ts",
      ]),
    ).toEqual([omitted]);
  });

  it("accepts the complete owned runtime scope", () => {
    const manifest = loadScopeManifest();
    expect(missingModifiedRuntimeFiles(manifest.runtimeFiles, manifest.runtimeFiles)).toEqual([]);
  });

  it("reports a manifest omission for runtime committed after the explicit PR base", () => {
    const repository = createRepository();
    try {
      const committedPath = "apps/bot/src/committed-runtime.ts";
      writeFileSync(join(repository.path, committedPath), "export const committed = true;\n", "utf8");
      runGit(repository.path, ["add", committedPath]);
      runGit(repository.path, ["commit", "--quiet", "-m", "runtime"]);

      const changed = collectChangedBotSourceFiles({
        repositoryRoot: repository.path,
        baseRevision: repository.base,
        continuousIntegration: true,
      });
      expect(changed).toContain(committedPath);
      expect(missingModifiedRuntimeFiles([], changed)).toEqual([committedPath]);
    } finally {
      rmSync(repository.path, { recursive: true, force: true });
    }
  });

  it("reports local tracked and untracked runtime manifest omissions", () => {
    const repository = createRepository();
    try {
      const trackedPath = "apps/bot/src/existing.ts";
      const untrackedPath = "apps/bot/src/untracked-runtime.ts";
      writeFileSync(join(repository.path, trackedPath), "export const existing = false;\n", "utf8");
      writeFileSync(join(repository.path, untrackedPath), "export const untracked = true;\n", "utf8");

      const changed = collectChangedBotSourceFiles({ repositoryRoot: repository.path });
      expect(changed).toEqual([trackedPath, untrackedPath]);
      expect(missingModifiedRuntimeFiles([], changed)).toEqual([trackedPath, untrackedPath]);
    } finally {
      rmSync(repository.path, { recursive: true, force: true });
    }
  });

  it("fails closed when CI has no usable base", () => {
    const repository = createRepository();
    try {
      expect(() =>
        collectChangedBotSourceFiles({
          repositoryRoot: repository.path,
          continuousIntegration: true,
        }),
      ).toThrow("MM_BOT_COVERAGE_BASE is required in CI");
      expect(() =>
        collectChangedBotSourceFiles({
          repositoryRoot: repository.path,
          baseRevision: "refs/heads/missing",
          continuousIntegration: true,
        }),
      ).toThrow("git rev-parse --verify refs/heads/missing^{commit} failed");
    } finally {
      rmSync(repository.path, { recursive: true, force: true });
    }
  });
});
