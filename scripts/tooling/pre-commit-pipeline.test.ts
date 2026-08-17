import { expect, test } from "bun:test";
import { preCommitCommands, runPreCommitPipeline } from "./pre-commit-pipeline.ts";

test("pre-commit pipeline runs approved stages in order", async () => {
  const commands: string[] = [];
  await runPreCommitPipeline((command) => {
    commands.push(command.join(" "));
    return Promise.resolve({ exitCode: 0 });
  });
  expect(commands).toEqual(preCommitCommands.map((command) => command.join(" ")));
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
    expect(error).toHaveProperty("message", "Pre-commit command failed (7): bun run format:check");
  }
  expect(commands).toHaveLength(2);
});
