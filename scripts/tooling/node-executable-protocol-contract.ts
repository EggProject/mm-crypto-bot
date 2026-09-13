export const nodeGates = [
  "release-coverage-unit",
  "release-coverage-e2e",
  "node-executable-protocol-unit",
  "node-executable-protocol-e2e",
  "vitest-list-all-configs",
  "bot-config-command-coverage",
  "bot-e2e-preload-coverage",
  "bot-runtime-scope-coverage",
  "bot-unit-scope",
  "bot-unit-coverage",
  "assert-test",
  "assert-coverage",
  "backtest-tools-dydx-r3-coverage",
  "backtest-coverage",
  "exchange-bybit-eu-adapter-coverage",
  "logging-test",
  "logging-coverage",
  "numeric-test",
  "numeric-coverage",
  "paper-coverage",
  "shared-test",
  "shared-coverage",
  "typeguard-test",
  "typeguard-coverage",
  "typing-test",
  "typing-coverage",
  "ci-foundation-coverage",
  "ci-test-junit",
  "coverage-full-test",
  "staged-eslint",
  "staged-prettier",
] as const;

export type NodeGate = (typeof nodeGates)[number];

export interface RawProcessObservation {
  readonly error: unknown;
  readonly signal: unknown;
  readonly status: unknown;
  readonly stdout: unknown;
}

const vitestEntrypoint = "node_modules/vitest/vitest.mjs";
const nodeGateValues: readonly string[] = nodeGates;

const releaseCoverageConfigs: ReadonlyMap<NodeGate, string> = new Map([
  ["release-coverage-unit", "scripts/release/vitest.config.ts"],
  ["release-coverage-e2e", "scripts/release/vitest.e2e.config.ts"],
  ["node-executable-protocol-unit", "scripts/tooling/vitest.node-executable-protocol.unit.config.mjs"],
  ["node-executable-protocol-e2e", "scripts/tooling/vitest.node-executable-protocol.e2e.config.mjs"],
]);

const configByGate: ReadonlyMap<NodeGate, string> = new Map([
  ["bot-config-command-coverage", "apps/bot/vitest.config-command.config.mjs"],
  ["bot-e2e-preload-coverage", "scripts/coverage-tools/vitest.bot-e2e-preload.config.mjs"],
  ["bot-runtime-scope-coverage", "scripts/coverage-tools/vitest.bot-runtime-scope.config.mjs"],
  ["bot-unit-coverage", "apps/bot/vitest.config.ts"],
  ["assert-test", "packages/assert/vitest.config.ts"],
  ["assert-coverage", "packages/assert/vitest.config.ts"],
  ["backtest-tools-dydx-r3-coverage", "packages/backtest-tools/vitest.dydx-r3.config.mjs"],
  ["backtest-coverage", "packages/backtest/vitest.config.ts"],
  ["exchange-bybit-eu-adapter-coverage", "packages/exchange/vitest.bybit-eu-adapter.config.mjs"],
  ["logging-test", "packages/logging/vitest.config.ts"],
  ["logging-coverage", "packages/logging/vitest.config.ts"],
  ["numeric-test", "packages/numeric/vitest.config.ts"],
  ["numeric-coverage", "packages/numeric/vitest.config.ts"],
  ["paper-coverage", "packages/paper/vitest.config.ts"],
  ["shared-test", "packages/shared/vitest.config.ts"],
  ["shared-coverage", "packages/shared/vitest.config.ts"],
  ["typeguard-test", "packages/typeguard/vitest.config.ts"],
  ["typeguard-coverage", "packages/typeguard/vitest.config.ts"],
  ["typing-test", "packages/typing/vitest.config.ts"],
  ["typing-coverage", "packages/typing/vitest.config.ts"],
  ["ci-foundation-coverage", "scripts/tooling/vitest.verify-foundation.config.mjs"],
]);

export function isNodeGate(value: unknown): value is NodeGate {
  return typeof value === "string" && nodeGateValues.includes(value);
}

export function parseNodeGateArguments(argv: readonly unknown[]): NodeGate {
  if (argv.length !== 1 || typeof argv[0] !== "string" || !argv[0].startsWith("--gate=")) {
    throw new Error("invalid Node gate arguments");
  }
  const gate = argv[0].slice("--gate=".length);
  if (!isNodeGate(gate)) throw new Error("invalid Node gate arguments");
  return gate;
}

export function nodeGateArguments(gate: NodeGate): readonly string[] {
  const releaseConfig = releaseCoverageConfigs.get(gate);
  if (releaseConfig !== undefined) return [vitestEntrypoint, "run", "--config", releaseConfig, "--coverage"];
  if (gate === "staged-eslint") return ["scripts/tooling/staged-file-validation.ts", "--mode=lint"];
  if (gate === "staged-prettier") return ["scripts/tooling/staged-file-validation.ts", "--mode=format"];
  if (gate === "vitest-list-all-configs") {
    return [vitestEntrypoint, "list", "--config", "scripts/tooling/vitest.pre-commit.config.mjs"];
  }
  if (gate === "bot-unit-scope") return ["scripts/coverage-tools/verify-bot-runtime-scope.ts"];
  if (gate === "ci-test-junit") {
    return [
      "node_modules/turbo/bin/turbo",
      "run",
      "test",
      "--",
      "--reporter=junit",
      "--reporter-outfile=./junit.xml",
    ];
  }
  if (gate === "coverage-full-test") return ["node_modules/turbo/bin/turbo", "run", "test", "--force"];
  const config = configByGate.get(gate);
  if (config === undefined) throw new Error("invalid Node gate arguments");
  return [vitestEntrypoint, "run", "--config", config, "--coverage"];
}

export function verifiedNodeOutput(observation: RawProcessObservation, shouldCaptureOutput: boolean): string {
  assertSuccessfulProcess(observation, "verified Node gate failed");
  if (!shouldCaptureOutput) return "";
  if (!(observation.stdout instanceof Uint8Array)) throw new Error("verified Node gate failed");
  return new TextDecoder("utf-8", { fatal: true }).decode(observation.stdout).trim();
}

export function assertNodeVersion(observedVersion: string): void {
  if (observedVersion !== "v24.21.0") throw new Error("unverified Node executable");
}

export function assertSafeNodeEnvironment(environment: Readonly<Record<string, string | undefined>>): void {
  if (Object.hasOwn(environment, "NODE_OPTIONS") || Object.hasOwn(environment, "NODE_PATH")) {
    throw new Error("unverified Node environment");
  }
}

function assertSuccessfulProcess(observation: RawProcessObservation, message: string): void {
  if (observation.error !== undefined || Boolean(observation.signal) || observation.status !== 0) {
    throw new Error(message);
  }
}
