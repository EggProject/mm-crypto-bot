import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import type * as NodeExecutableProtocol from "./node-executable-protocol.ts";
import type * as StagedFileValidation from "./staged-file-validation.ts";

const executeFile = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "../..");
const nvmDirectory = "/home/eggp/.nvm";
const nvmBin = path.join(nvmDirectory, "versions", "node", "v24.21.0", "bin");
const nodeExecutable = path.join(nvmBin, "node");

async function run(command: string, arguments_: readonly string[], cwd: string): Promise<void> {
  await executeFile(command, arguments_, { cwd });
}

async function createTemporaryGitRepo(): Promise<string> {
  const temporaryRepo = await mkdtemp(path.join(tmpdir(), "mm-node-protocol-e2e-"));
  await run("git", ["init", "--initial-branch=main"], temporaryRepo);
  const links: readonly (readonly [string, string])[] = [
    [path.join(repoRoot, "scripts"), "scripts"],
    [path.join(repoRoot, "node_modules"), "node_modules"],
    [path.join(repoRoot, "eslint.config.js"), "eslint.config.js"],
  ];
  for (const [source, destination] of links) {
    await run("ln", ["-s", source, destination], temporaryRepo);
  }
  await run("cp", [path.join(repoRoot, "eslint.config.js"), "sample.js"], temporaryRepo);
  await run("node_modules/prettier/bin/prettier.cjs", ["--write", "sample.js"], temporaryRepo);
  await run("git", ["add", "sample.js"], temporaryRepo);
  return temporaryRepo;
}

async function inTemporaryRepo<T>(temporaryRepo: string, action: () => Promise<T>): Promise<T> {
  const initialCwd = process.cwd();
  process.chdir(temporaryRepo);
  try {
    return await action();
  } finally {
    process.chdir(initialCwd);
  }
}

async function loadProductionEntrypoints(): Promise<{
  readonly protocol: typeof NodeExecutableProtocol;
  readonly stagedFileValidation: typeof StagedFileValidation;
}> {
  const [protocol, stagedFileValidation] = await Promise.all([
    import("./node-executable-protocol.ts"),
    import("./staged-file-validation.ts"),
  ]);
  return Object.freeze({ protocol, stagedFileValidation });
}

function localEnvironment(): Readonly<Record<string, string>> {
  return Object.freeze({
    ...process.env,
    MM_CRYPTO_BOT_NODE_EXECUTABLE: nodeExecutable,
    MM_CRYPTO_BOT_NODE_PROVENANCE: "local",
    NVM_BIN: nvmBin,
    NVM_DIR: nvmDirectory,
  });
}

function publicScriptEnvironment(): Readonly<Record<string, string>> {
  const {
    MM_CRYPTO_BOT_NODE_EXECUTABLE: _nodeExecutable,
    MM_CRYPTO_BOT_NODE_PROVENANCE: _nodeProvenance,
    NODE_OPTIONS: _nodeOptions,
    NODE_PATH: _nodePath,
    ...environment
  } = process.env;
  return Object.freeze({ ...environment, NVM_BIN: nvmBin, NVM_DIR: nvmDirectory });
}

test("public runtime entrypoints validate a real staged Git path through verified NVM Node", async () => {
  const temporaryRepo = await createTemporaryGitRepo();
  await inTemporaryRepo(temporaryRepo, async () => {
    const environment = localEnvironment();
    const { protocol, stagedFileValidation } = await loadProductionEntrypoints();
    const protocolExitCode = { exitCode: undefined as number | undefined };
    await expect(
      protocol.runVerifiedNodeGateEntrypoint(["--gate=staged-eslint"], environment, protocolExitCode, true),
    ).resolves.toBe(0);

    const formatExitCode = { exitCode: undefined as number | undefined };
    await expect(
      stagedFileValidation.runStagedFileValidationEntrypoint(["--mode=format"], formatExitCode, true),
    ).resolves.toBe(0);
  });
});

test("public runtime entrypoints fail closed for malformed gates, provenance, and staged worktree drift", async () => {
  const temporaryRepo = await createTemporaryGitRepo();
  await run("cp", [path.join(repoRoot, "eslint.config.js"), "invalid.js"], temporaryRepo);
  await run("node_modules/prettier/bin/prettier.cjs", ["--write", "invalid.js"], temporaryRepo);
  await run("sed", ["-i", "$a invalid syntax", "invalid.js"], temporaryRepo);
  await run("git", ["add", "invalid.js"], temporaryRepo);
  await inTemporaryRepo(temporaryRepo, async () => {
    const { protocol, stagedFileValidation } = await loadProductionEntrypoints();
    const invalidGateExitCode = { exitCode: undefined as number | undefined };
    await expect(
      protocol.runVerifiedNodeGateEntrypoint(
        ["--gate=unknown"],
        localEnvironment(),
        invalidGateExitCode,
        true,
      ),
    ).resolves.toBe(1);
    const invalidProvenanceExitCode = { exitCode: undefined as number | undefined };
    await expect(
      protocol.runVerifiedNodeGateEntrypoint(
        ["--gate=staged-eslint"],
        { ...localEnvironment(), MM_CRYPTO_BOT_NODE_PROVENANCE: "unknown" },
        invalidProvenanceExitCode,
        true,
      ),
    ).resolves.toBe(1);
    const invalidLintExitCode = { exitCode: undefined as number | undefined };
    await expect(
      stagedFileValidation.runStagedFileValidationEntrypoint(["--mode=lint"], invalidLintExitCode, true),
    ).resolves.toBe(1);
  });
  await run("sed", ["-i", "$a // worktree drift", "sample.js"], temporaryRepo);
  await inTemporaryRepo(temporaryRepo, async () => {
    const { stagedFileValidation } = await loadProductionEntrypoints();
    const driftExitCode = { exitCode: undefined as number | undefined };
    await expect(
      stagedFileValidation.runStagedFileValidationEntrypoint(["--mode=lint"], driftExitCode, true),
    ).resolves.toBe(1);
  });
});

test("public runtime entrypoints accept only the real CI-shaped Node cache and empty staged Git state", async () => {
  const temporaryRepo = await createTemporaryGitRepo();
  const ciToolCache = path.join(temporaryRepo, "tool-cache");
  const ciNodeDirectory = path.join(ciToolCache, "node", "24.21.0", "x64", "bin");
  await run("mkdir", ["-p", ciNodeDirectory], temporaryRepo);
  const ciNodeExecutable = path.join(ciNodeDirectory, "node");
  await run("cp", [nodeExecutable, ciNodeExecutable], temporaryRepo);
  await inTemporaryRepo(temporaryRepo, async () => {
    const { protocol, stagedFileValidation } = await loadProductionEntrypoints();
    const ciExitCode = { exitCode: undefined as number | undefined };
    await expect(
      protocol.runVerifiedNodeGateEntrypoint(
        ["--gate=staged-prettier"],
        {
          ...localEnvironment(),
          MM_CRYPTO_BOT_NODE_EXECUTABLE: ciNodeExecutable,
          MM_CRYPTO_BOT_NODE_PROVENANCE: "ci",
          RUNNER_ARCH: "x64",
          RUNNER_TOOL_CACHE: ciToolCache,
        },
        ciExitCode,
        true,
      ),
    ).resolves.toBe(0);
    const importedExitCode = { exitCode: undefined as number | undefined };
    await expect(
      protocol.runVerifiedNodeGateEntrypoint(
        ["--gate=staged-prettier"],
        localEnvironment(),
        importedExitCode,
        false,
      ),
    ).resolves.toBeUndefined();
    await run("git", ["reset", "--quiet"], temporaryRepo);
    const emptyExitCode = { exitCode: undefined as number | undefined };
    await expect(
      stagedFileValidation.runStagedFileValidationEntrypoint(["--mode=lint"], emptyExitCode, true),
    ).resolves.toBe(0);
  });
});

test("public entrypoints reject missing provenance paths and skip lint when a real Git index contains only Markdown", async () => {
  const temporaryRepo = await createTemporaryGitRepo();
  await run("cp", [path.join(repoRoot, "package.json"), "guide.md"], temporaryRepo);
  await run("git", ["reset", "--quiet"], temporaryRepo);
  await run("git", ["add", "guide.md"], temporaryRepo);
  await inTemporaryRepo(temporaryRepo, async () => {
    const { protocol, stagedFileValidation } = await loadProductionEntrypoints();
    const missingExecutableExitCode = { exitCode: undefined as number | undefined };
    await expect(
      protocol.runVerifiedNodeGateEntrypoint(
        ["--gate=staged-eslint"],
        { ...localEnvironment(), MM_CRYPTO_BOT_NODE_EXECUTABLE: "/tmp/missing-node" },
        missingExecutableExitCode,
        true,
      ),
    ).resolves.toBe(1);
    const missingInputExitCode = { exitCode: undefined as number | undefined };
    await expect(
      protocol.runVerifiedNodeGateEntrypoint(["--gate=staged-eslint"], {}, missingInputExitCode, true),
    ).resolves.toBe(1);
    const mismatchedLocalExitCode = { exitCode: undefined as number | undefined };
    await expect(
      protocol.runVerifiedNodeGateEntrypoint(
        ["--gate=staged-eslint"],
        { ...localEnvironment(), NVM_BIN: "/tmp" },
        mismatchedLocalExitCode,
        true,
      ),
    ).resolves.toBe(1);
    const mismatchedCiExitCode = { exitCode: undefined as number | undefined };
    await expect(
      protocol.runVerifiedNodeGateEntrypoint(
        ["--gate=staged-eslint"],
        {
          ...localEnvironment(),
          MM_CRYPTO_BOT_NODE_PROVENANCE: "ci",
          RUNNER_ARCH: "x64",
          RUNNER_TOOL_CACHE: "/tmp",
        },
        mismatchedCiExitCode,
        true,
      ),
    ).resolves.toBe(1);
    const invalidCiArchitectureExitCode = { exitCode: undefined as number | undefined };
    await expect(
      protocol.runVerifiedNodeGateEntrypoint(
        ["--gate=staged-eslint"],
        {
          ...localEnvironment(),
          MM_CRYPTO_BOT_NODE_PROVENANCE: "ci",
          RUNNER_ARCH: "X64",
          RUNNER_TOOL_CACHE: "/tmp",
        },
        invalidCiArchitectureExitCode,
        true,
      ),
    ).resolves.toBe(1);
    const markdownLintExitCode = { exitCode: undefined as number | undefined };
    await expect(
      stagedFileValidation.runStagedFileValidationEntrypoint(["--mode=lint"], markdownLintExitCode, true),
    ).resolves.toBe(0);
  });
});

test("public release coverage scripts establish local NVM provenance without ambient MM variables", async () => {
  for (const script of ["coverage:release:unit", "coverage:release:e2e", "coverage:release"] as const) {
    await executeFile("bun", ["run", script], { cwd: repoRoot, env: publicScriptEnvironment() });
  }
}, 30_000);

test("public protocol runtime rejects hostile Node environment and foreign expected repository cwd", async () => {
  const temporaryRepo = await createTemporaryGitRepo();
  await inTemporaryRepo(temporaryRepo, async () => {
    const { protocol } = await loadProductionEntrypoints();
    const hostileExitCode = { exitCode: undefined as number | undefined };
    await expect(
      protocol.runVerifiedNodeGateEntrypoint(
        ["--gate=staged-eslint"],
        { ...localEnvironment(), NODE_OPTIONS: "" },
        hostileExitCode,
        true,
      ),
    ).resolves.toBe(1);
    await expect(protocol.runVerifiedNodeGate(localEnvironment(), "staged-eslint", repoRoot)).rejects.toThrow(
      "unverified Node executable",
    );
  });
});
