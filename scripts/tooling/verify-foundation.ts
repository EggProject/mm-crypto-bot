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

export interface FoundationVerificationGateResult {
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | null;
}

export type FoundationVerificationRunner = (
  gate: FoundationVerificationGate,
) => Promise<FoundationVerificationGateResult>;

export interface BunFoundationVerificationProcess {
  readonly exited: Promise<number>;
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | null;
}

export interface BunFoundationVerificationSpawnOptions {
  readonly cmd: string[];
  readonly stderr: "inherit";
  readonly stdout: "inherit";
}

export type BunFoundationVerificationSpawn = (
  options: BunFoundationVerificationSpawnOptions,
) => BunFoundationVerificationProcess;

export class FoundationVerificationFailure extends Error {
  public readonly exitCode: number | null;
  public readonly gate: FoundationVerificationGate;
  public readonly signalCode: NodeJS.Signals | null;

  public constructor(gate: FoundationVerificationGate, result: FoundationVerificationGateResult) {
    super(
      `Foundation verification gate failed (exit=${result.exitCode === null ? "none" : String(result.exitCode)}, signal=${result.signalCode ?? "none"}): ${gate}`,
    );
    this.name = "FoundationVerificationFailure";
    this.exitCode = result.exitCode;
    this.gate = gate;
    this.signalCode = result.signalCode;
  }
}

const isSuccessfulResult = (result: FoundationVerificationGateResult): boolean =>
  result.exitCode === 0 && result.signalCode === null;

export async function runFoundationVerification(runGate: FoundationVerificationRunner): Promise<void> {
  for (const gate of foundationVerificationGates) {
    const result = await runGate(gate);
    if (!isSuccessfulResult(result)) {
      throw new FoundationVerificationFailure(gate, result);
    }
  }
}

export function createBunFoundationVerificationRunner(
  spawn: BunFoundationVerificationSpawn = Bun.spawn,
): FoundationVerificationRunner {
  return async (gate) => {
    const child = spawn({
      cmd: ["bun", "run", gate],
      stderr: "inherit",
      stdout: "inherit",
    });
    await child.exited;
    return { exitCode: child.exitCode, signalCode: child.signalCode };
  };
}

export type FoundationVerificationDiagnosticWriter = (message: string) => void;

const writeFoundationVerificationDiagnostic: FoundationVerificationDiagnosticWriter = (message) => {
  console.error(message);
};

export async function runFoundationVerificationCli(
  runGate: FoundationVerificationRunner = createBunFoundationVerificationRunner(),
  writeDiagnostic: FoundationVerificationDiagnosticWriter = writeFoundationVerificationDiagnostic,
): Promise<number> {
  try {
    await runFoundationVerification(runGate);
    return 0;
  } catch (error: unknown) {
    if (!(error instanceof FoundationVerificationFailure)) {
      throw error;
    }

    writeDiagnostic(error.message);
    return error.signalCode === null && error.exitCode !== null ? error.exitCode : 1;
  }
}

export type FoundationVerificationCommandRunner = () => Promise<number>;

export interface FoundationVerificationExitCodeTarget {
  exitCode?: number | string | null;
}

export async function runFoundationVerificationEntrypoint(
  isMain: boolean,
  runCommand: FoundationVerificationCommandRunner,
  exitCodeTarget: FoundationVerificationExitCodeTarget,
): Promise<void> {
  if (!isMain) {
    return;
  }

  exitCodeTarget.exitCode = await runCommand();
}

// eslint-disable-next-line unicorn/no-top-level-side-effects -- Direct execution must start the foundation verification command.
await runFoundationVerificationEntrypoint(import.meta.main, runFoundationVerificationCli, process);
