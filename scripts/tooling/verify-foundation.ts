export const foundationVerificationGates = [
  "format:check",
  "lint",
  "typecheck",
  "test:tooling",
  "build",
  "test",
  "coverage:bot:unit",
  "coverage:bot:e2e",
  "coverage:scope",
  "coverage:full",
] as const;

export type FoundationVerificationGate = (typeof foundationVerificationGates)[number];

export type FoundationVerificationRunner = (gate: FoundationVerificationGate) => Promise<number>;

export async function runFoundationVerification(runGate: FoundationVerificationRunner): Promise<void> {
  for (const gate of foundationVerificationGates) {
    const exitCode = await runGate(gate);
    if (exitCode !== 0) {
      throw new Error(`Foundation verification gate failed (${String(exitCode)}): ${gate}`);
    }
  }
}

const runWithBun: FoundationVerificationRunner = async (gate) => {
  const child = Bun.spawn({
    cmd: ["bun", "run", gate],
    stderr: "inherit",
    stdout: "inherit",
  });
  return child.exited;
};

if (import.meta.main) {
  await runFoundationVerification(runWithBun);
}
