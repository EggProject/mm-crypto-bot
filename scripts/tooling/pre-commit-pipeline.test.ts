import { expect, test } from "bun:test";
import { createBunCommandRunner, preCommitCommands, runPreCommitPipeline } from "./pre-commit-pipeline.ts";

test("pre-commit pipeline runs approved stages in order", async () => {
  const commands: string[] = [];
  await runPreCommitPipeline((command) => {
    commands.push(command.join(" "));
    return Promise.resolve({ exitCode: 0 });
  });
  expect(commands).toEqual(preCommitCommands.map((command) => command.join(" ")));
  expect(commands).toEqual([
    "bun run lint:hook",
    "bun run format:hook",
    "bun run clean:artifacts",
    "bun run worktree:inspect",
  ]);
});

test("pre-commit pipeline fails fast", async () => {
  const commands: string[] = [];
  try {
    await runPreCommitPipeline((command) => {
      commands.push(command.join(" "));
      return Promise.resolve({ exitCode: commands.length === 2 ? 7 : 0 });
    });
    throw new Error("Expected fail-fast rejection");
  } catch (error: unknown) {
    expect(error).toHaveProperty("message", "Pre-commit command failed (7): bun run format:hook");
  }
  expect(commands).toHaveLength(2);
});

test("Bun command runner preserves direct command argv and child exit code", async () => {
  const options: { readonly cmd: readonly string[]; readonly stderr: string; readonly stdout: string }[] = [];
  const run = createBunCommandRunner((commandOptions) => {
    options.push(commandOptions);
    return { exited: Promise.resolve(9) };
  });

  const result = await run(["bun", "run", "lint:hook"]);
  expect(result).toEqual({ exitCode: 9 });
  expect(options).toEqual([{ cmd: ["bun", "run", "lint:hook"], stderr: "inherit", stdout: "inherit" }]);
});
