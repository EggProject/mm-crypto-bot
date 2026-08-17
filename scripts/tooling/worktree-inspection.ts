async function run(command: readonly string[]): Promise<void> {
  const child = Bun.spawn({ cmd: [...command], stderr: "inherit", stdout: "inherit" });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`Worktree inspection failed (${String(exitCode)}): ${command.join(" ")}`);
  }
}

await run(["git", "diff", "--check"]);
await run(["git", "status", "--short"]);
