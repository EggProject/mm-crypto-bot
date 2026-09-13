import { spawnSync } from "node:child_process";
import path from "node:path";

import {
  assertSafeNodeEnvironment,
  assertNodeVersion,
  nodeGateArguments,
  parseNodeGateArguments,
  verifiedNodeOutput,
  type NodeGate,
  type RawProcessObservation,
} from "./node-executable-protocol-contract.ts";

interface Environment {
  readonly MM_CRYPTO_BOT_NODE_EXECUTABLE?: string;
  readonly MM_CRYPTO_BOT_NODE_PROVENANCE?: string;
  readonly NVM_BIN?: string;
  readonly NVM_DIR?: string;
  readonly RUNNER_ARCH?: string;
  readonly RUNNER_TOOL_CACHE?: string;
  readonly [name: string]: string | undefined;
}

const nodeRelativePath = ["versions", "node", "v24.21.0", "bin", "node"] as const;
const fs = await import("node:fs/promises");

function requiredAbsolute(value: string | undefined): string {
  if (value === undefined || !path.isAbsolute(value)) throw new Error("unverified Node executable");
  return value;
}

async function safeRealpath(target: string): Promise<string> {
  try {
    return await fs.realpath(target);
  } catch {
    throw new Error("unverified Node executable");
  }
}

async function verifiedExecutable(environment: Environment): Promise<string> {
  const executable = await safeRealpath(requiredAbsolute(environment.MM_CRYPTO_BOT_NODE_EXECUTABLE));
  if (environment.MM_CRYPTO_BOT_NODE_PROVENANCE === "local") {
    const nvmDirectory = await safeRealpath(requiredAbsolute(environment.NVM_DIR));
    const nvmBin = await safeRealpath(requiredAbsolute(environment.NVM_BIN));
    const expected = path.join(nvmDirectory, ...nodeRelativePath);
    if (executable !== expected || nvmBin !== path.dirname(expected))
      throw new Error("unverified Node executable");
    return executable;
  }
  if (environment.MM_CRYPTO_BOT_NODE_PROVENANCE === "ci") {
    const architecture = environment.RUNNER_ARCH;
    if (architecture === undefined || !/^[a-z0-9_]+$/u.test(architecture)) {
      throw new Error("unverified Node executable");
    }
    const toolCache = await safeRealpath(requiredAbsolute(environment.RUNNER_TOOL_CACHE));
    const expected = path.join(toolCache, "node", "24.21.0", architecture, "bin", "node");
    if (executable !== expected) throw new Error("unverified Node executable");
    return executable;
  }
  throw new Error("unverified Node executable");
}

async function verifiedWorkingDirectory(expectedRepoRoot: string): Promise<string> {
  const expected = await safeRealpath(requiredAbsolute(expectedRepoRoot));
  const ambient = await safeRealpath(process.cwd());
  if (ambient !== expected) throw new Error("unverified Node executable");
  return expected;
}

function observeNode(
  executable: string,
  argv: readonly string[],
  cwd: string,
  environment: Environment,
): RawProcessObservation {
  const result = spawnSync(executable, argv, {
    cwd,
    env: Object.fromEntries(Object.entries(environment).filter(([, value]) => value !== undefined)),
    shell: false,
    stdio: ["ignore", "pipe", "inherit"],
  });
  return Object.freeze({
    error: result.error,
    signal: result.signal,
    status: result.status,
    stdout: result.stdout,
  });
}

export async function runVerifiedNodeGate(
  environment: Environment,
  gate: NodeGate,
  expectedRepoRoot: string,
): Promise<void> {
  assertSafeNodeEnvironment(environment);
  const cwd = await verifiedWorkingDirectory(expectedRepoRoot);
  const executable = await verifiedExecutable(environment);
  assertNodeVersion(verifiedNodeOutput(observeNode(executable, ["--version"], cwd, environment), true));
  verifiedNodeOutput(observeNode(executable, nodeGateArguments(gate), cwd, environment), false);
}

export async function runVerifiedNodeGateEntrypoint(
  argv: readonly unknown[],
  environment: Environment,
  exitCodeTarget: { exitCode: string | number | null | undefined },
  isMain: boolean,
): Promise<string | number | null | undefined> {
  if (!isMain) return exitCodeTarget.exitCode;
  try {
    await runVerifiedNodeGate(environment, parseNodeGateArguments(argv), process.cwd());
    exitCodeTarget.exitCode = 0;
  } catch {
    exitCodeTarget.exitCode = 1;
  }
  return exitCodeTarget.exitCode;
}

process.exitCode = await runVerifiedNodeGateEntrypoint(
  process.argv.slice(2),
  process.env,
  process,
  import.meta.main,
);
