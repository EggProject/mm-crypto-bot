export interface CommandResult {
  readonly exitCode: number;
}

export type CommandRunner = (command: readonly string[]) => Promise<CommandResult>;

export const preCommitCommands = [
  ["bun", "run", "lint:hook"],
  ["bun", "run", "format:check"],
  ["bun", "run", "clean:artifacts"],
  ["bun", "run", "worktree:inspect"],
] as const;

export async function runPreCommitPipeline(run: CommandRunner): Promise<void> {
  for (const command of preCommitCommands) {
    const result = await run(command);
    if (result.exitCode !== 0) {
      throw new Error(`Pre-commit command failed (${String(result.exitCode)}): ${command.join(" ")}`);
    }
  }
}

async function runProcess(command: readonly string[]): Promise<CommandResult> {
  const processResult = Bun.spawn({ cmd: [...command], stderr: "inherit", stdout: "inherit" });
  return { exitCode: await processResult.exited };
}

if (import.meta.main) {
  await runPreCommitPipeline(runProcess);
}
