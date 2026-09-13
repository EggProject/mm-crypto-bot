import { runVerifiedNodeGate } from "../tooling/node-executable-protocol.ts";
import type { NodeGate } from "../tooling/node-executable-protocol-contract.ts";

type ReleaseCoverageLevel = "unit" | "e2e";
type Environment = Readonly<Record<string, string | undefined>>;
export type VerifiedNodeGateRunner = (environment: Environment, gate: NodeGate) => Promise<void>;

export function runReleaseCoverageNodeGate(
  level: ReleaseCoverageLevel,
  environment: Environment,
  runGate: VerifiedNodeGateRunner = runVerifiedNodeGate,
): Promise<void> {
  return runGate(environment, level === "unit" ? "release-coverage-unit" : "release-coverage-e2e");
}
