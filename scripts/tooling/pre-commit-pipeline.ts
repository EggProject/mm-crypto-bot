export interface CommandResult {
  readonly exitCode: number;
}

export type CommandRunner = (command: readonly string[]) => Promise<CommandResult>;

export interface BunCommandProcess {
  readonly exited: Promise<number>;
}

export type BunCommandSpawn = (options: {
  readonly cmd: readonly string[];
  readonly stderr: "inherit";
  readonly stdout: "inherit";
}) => BunCommandProcess;

export const preCommitCommands = [
  ["bun", "run", "lint:hook"],
  ["bun", "run", "format:hook"],
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

export const createBunCommandRunner =
  (spawn: BunCommandSpawn): CommandRunner =>
  async (command) => {
    const processResult = spawn({ cmd: command, stderr: "inherit", stdout: "inherit" });
    return { exitCode: await processResult.exited };
  };
