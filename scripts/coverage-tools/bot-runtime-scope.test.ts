/* eslint-disable security/detect-non-literal-fs-filename -- every test path is below a fresh mkdtemp directory */
import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
// eslint-disable-next-line unicorn/import-style -- This focused coverage utility retains the established named Node boundary imports.
import { join } from "node:path";

import {
  REPOSITORY_ROOT,
  isRuntimeSourcePath,
  loadScopeManifest,
  missingModifiedRuntimeFiles,
} from "./bot-runtime-scope.ts";
import {
  collectChangedBotSourceFiles,
  createDefaultScopeVerificationPorts,
  isContinuousIntegration,
  runBotRuntimeScopeCli,
  runBotRuntimeScopeEntrypoint,
  runDefaultBotRuntimeScopeCli,
  verifyBotRuntimeScope,
} from "./verify-bot-runtime-scope.ts";
import type { ScopeDiffOptions, ScopeVerificationPorts } from "./verify-bot-runtime-scope.ts";

function runGit(repo: string, arguments_: readonly string[]): string {
  const result = spawnSync("git", arguments_, { cwd: repo, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${arguments_.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout.trim();
}

function createRepo(): { readonly path: string; readonly base: string } {
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

function createScopeVerificationPorts({
  environment = {},
  changedFiles = [],
  missingFiles = [],
  loadManifest = loadScopeManifest,
}: {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly changedFiles?: readonly string[];
  readonly missingFiles?: readonly string[];
  readonly loadManifest?: ScopeVerificationPorts["loadManifest"];
} = {}): {
  readonly output: readonly string[];
  readonly errors: readonly string[];
  readonly options: readonly ScopeDiffOptions[];
  readonly ports: ScopeVerificationPorts;
} {
  const output: string[] = [];
  const errors: string[] = [];
  const options: ScopeDiffOptions[] = [];
  return {
    output,
    errors,
    options,
    ports: {
      environment,
      loadManifest,
      collectChangedBotSourceFiles: (scopeOptions) => {
        options.push(scopeOptions);
        return changedFiles;
      },
      missingModifiedRuntimeFiles: () => missingFiles,
      writeStandardError: (message) => {
        errors.push(message);
      },
      writeStandardOutput: (message) => {
        output.push(message);
      },
    },
  };
}

describe("bot runtime scope completeness", () => {
  it("classifies runtime, test and declaration paths explicitly", () => {
    expect(isRuntimeSourcePath("apps/bot/src/bot/bot.ts")).toBe(true);
    expect(isRuntimeSourcePath("apps/bot/src/bot/bot.runtime.test.ts")).toBe(false);
    expect(isRuntimeSourcePath("apps/bot/src/bot/order-manager.test-support.ts")).toBe(false);
    expect(isRuntimeSourcePath("apps/bot/src/bot/strategy-runner.types.ts")).toBe(false);
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
        "apps/bot/src/bot/bot.runtime.test.ts",
        "apps/bot/src/global-types/write-file-atomic.d.ts",
      ]),
    ).toEqual([omitted]);
  });

  it("accepts the complete owned runtime scope", () => {
    const manifest = loadScopeManifest();
    expect(missingModifiedRuntimeFiles(manifest.runtimeFiles, manifest.runtimeFiles)).toEqual([]);
  });

  it("reports a manifest omission for runtime committed after the explicit PR base", () => {
    const repo = createRepo();
    try {
      const committedPath = "apps/bot/src/committed-runtime.ts";
      writeFileSync(join(repo.path, committedPath), "export const committed = true;\n", "utf8");
      runGit(repo.path, ["add", committedPath]);
      runGit(repo.path, ["commit", "--quiet", "-m", "runtime"]);

      const changed = collectChangedBotSourceFiles({
        repositoryRoot: repo.path,
        baseRevision: repo.base,
        continuousIntegration: true,
      });
      expect(changed).toContain(committedPath);
      expect(missingModifiedRuntimeFiles([], changed)).toEqual([committedPath]);
    } finally {
      rmSync(repo.path, { recursive: true, force: true });
    }
  });

  it("reports local tracked and untracked runtime manifest omissions", () => {
    const repo = createRepo();
    try {
      const trackedPath = "apps/bot/src/existing.ts";
      const untrackedPath = "apps/bot/src/untracked-runtime.ts";
      writeFileSync(join(repo.path, trackedPath), "export const existing = false;\n", "utf8");
      writeFileSync(join(repo.path, untrackedPath), "export const untracked = true;\n", "utf8");

      const changed = collectChangedBotSourceFiles({ repositoryRoot: repo.path });
      expect(changed).toEqual([trackedPath, untrackedPath]);
      expect(missingModifiedRuntimeFiles([], changed)).toEqual([trackedPath, untrackedPath]);
    } finally {
      rmSync(repo.path, { recursive: true, force: true });
    }
  });

  it("orders changed paths by exact code units", () => {
    const repo = createRepo();
    try {
      const upperCasePath = "apps/bot/src/Z-runtime.ts";
      const lowerCasePath = "apps/bot/src/a-runtime.ts";
      writeFileSync(join(repo.path, upperCasePath), "export const upperCase = true;\n", "utf8");
      writeFileSync(join(repo.path, lowerCasePath), "export const lowerCase = true;\n", "utf8");

      expect(collectChangedBotSourceFiles({ repositoryRoot: repo.path })).toEqual([
        upperCasePath,
        lowerCasePath,
      ]);
    } finally {
      rmSync(repo.path, { recursive: true, force: true });
    }
  });

  it("fails closed when CI has no usable base", () => {
    const repo = createRepo();
    try {
      expect(() =>
        collectChangedBotSourceFiles({
          repositoryRoot: repo.path,
          continuousIntegration: true,
        }),
      ).toThrow("MM_BOT_COVERAGE_BASE is required in CI");
      expect(() =>
        collectChangedBotSourceFiles({
          repositoryRoot: repo.path,
          baseRevision: "refs/heads/missing",
          continuousIntegration: true,
        }),
      ).toThrow("git rev-parse --verify refs/heads/missing^{commit} failed");
    } finally {
      rmSync(repo.path, { recursive: true, force: true });
    }
  });

  it("classifies CI from a supplied environment without reading process state", () => {
    expect(isContinuousIntegration({})).toBe(false);
    expect(isContinuousIntegration({ CI: "true" })).toBe(true);
    expect(isContinuousIntegration({ GITHUB_ACTIONS: "true" })).toBe(true);
  });

  it("verifies an injected complete scope and reports the owned runtime count", () => {
    const verification = createScopeVerificationPorts({
      loadManifest: () => ({
        schemaVersion: 1,
        runtimeFiles: ["apps/bot/src/owned-runtime.ts"],
        unitTestFiles: ["apps/bot/src/owned-runtime.test.ts"],
        e2eCases: { "canonical-cli": ["owned-cli"], "runtime-driver": ["owned-driver"] },
      }),
    });

    verifyBotRuntimeScope(verification.ports);

    expect(verification.output).toEqual([
      "Coverage scope verified: 1 owned runtime files; no changed runtime file is missing.",
    ]);
    expect(verification.errors).toEqual([]);
  });

  it("rejects injected runtime omissions before reporting success", () => {
    const verification = createScopeVerificationPorts({ missingFiles: ["apps/bot/src/missing-runtime.ts"] });

    expect(() => {
      verifyBotRuntimeScope(verification.ports);
    }).toThrow("Coverage scope is missing changed bot runtime files:\n  - apps/bot/src/missing-runtime.ts");
    expect(verification.output).toEqual([]);
  });

  it("passes the supplied base revision into injected verification", () => {
    const verification = createScopeVerificationPorts({
      environment: { MM_BOT_COVERAGE_BASE: "base-commit" },
    });

    expect(() => {
      verifyBotRuntimeScope(verification.ports);
    }).not.toThrow();
    expect(verification.options).toEqual([{ baseRevision: "base-commit", continuousIntegration: false }]);
  });

  it("returns zero from a successful CLI verification command", () => {
    const verification = createScopeVerificationPorts();

    expect(runBotRuntimeScopeCli(verification.ports)).toBe(0);
    expect(verification.errors).toEqual([]);
  });

  it("returns two and formats an Error from the CLI verification command", () => {
    const verification = createScopeVerificationPorts({
      loadManifest: () => {
        throw new Error("manifest unavailable");
      },
    });

    expect(runBotRuntimeScopeCli(verification.ports)).toBe(2);
    expect(verification.errors).toEqual(["Coverage scope verification failed: manifest unavailable"]);
  });

  it("returns two and formats a non-Error from the CLI verification command", () => {
    const verification = createScopeVerificationPorts({
      loadManifest: () => {
        const failure: unknown = "manifest unavailable";
        throw failure;
      },
    });

    expect(runBotRuntimeScopeCli(verification.ports)).toBe(2);
    expect(verification.errors).toEqual(["Coverage scope verification failed: manifest unavailable"]);
  });

  it("does not invoke a command or mutate the exit target outside direct execution", () => {
    let callCount = 0;
    const exitCodeTarget: { exitCode?: number } = { exitCode: 7 };

    runBotRuntimeScopeEntrypoint(
      false,
      () => {
        callCount += 1;
        return 0;
      },
      exitCodeTarget,
    );

    expect(callCount).toBe(0);
    expect(exitCodeTarget.exitCode).toBe(7);
  });

  it("writes a successful direct command exit code to the exit target", () => {
    const exitCodeTarget: { exitCode?: number } = {};

    runBotRuntimeScopeEntrypoint(true, () => 0, exitCodeTarget);

    expect(exitCodeTarget.exitCode).toBe(0);
  });

  it("writes a failed direct command exit code to the exit target", () => {
    const exitCodeTarget: { exitCode?: number } = {};

    runBotRuntimeScopeEntrypoint(true, () => 2, exitCodeTarget);

    expect(exitCodeTarget.exitCode).toBe(2);
  });

  it("stops the package scope gate after a direct verifier failure", () => {
    const result = spawnSync("bun", ["run", "coverage:scope"], {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
      env: { ...process.env, MM_BOT_COVERAGE_BASE: "refs/heads/missing" },
    });
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.status).toBe(2);
    expect(output).toContain(
      "Coverage scope verification failed: git rev-parse --verify refs/heads/missing^{commit} failed:",
    );
    expect(output).not.toContain("RUN  v4.1.10");
  });

  it("provides explicit default ports that verify the repository scope", () => {
    const ports = createDefaultScopeVerificationPorts();
    expect(() => {
      verifyBotRuntimeScope(ports);
    }).not.toThrow();
    expect(ports.writeStandardError).toBeTypeOf("function");
    ports.writeStandardError("coverage scope default error writer exercised");
  });

  it("runs the default CLI adapter through its explicit command callback", () => {
    expect(runDefaultBotRuntimeScopeCli()).toBe(0);
  });
});
