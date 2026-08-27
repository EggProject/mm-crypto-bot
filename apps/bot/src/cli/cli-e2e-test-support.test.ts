import { fileURLToPath } from "node:url";

function buildChildEnvironment(caseId: string): Record<string, string> {
  const inherited = Object.entries(process.env).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return Object.fromEntries([
    ...inherited,
    ["MM_BOT_E2E_ENTRY_KIND", "canonical-cli"],
    ["MM_BOT_E2E_CASE_ID", caseId],
  ]);
}

export async function runCli(
  arguments_: readonly string[],
  options: { readonly caseId: string; readonly timeoutMs?: number },
): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }> {
  const workspaceRoot = fileURLToPath(new URL("../../../..", import.meta.url));
  const entry = process.env["MM_BOT_E2E_ENTRY"] ?? fileURLToPath(new URL("../index.ts", import.meta.url));
  const preload = process.env["MM_BOT_E2E_COVERAGE_PRELOAD"];
  const command =
    preload === undefined
      ? ["bun", "run", entry, ...arguments_]
      : ["bun", "--preload", preload, entry, ...arguments_];
  const process_ = Bun.spawn({
    cmd: command,
    cwd: workspaceRoot,
    env: buildChildEnvironment(options.caseId),
    stdout: "pipe",
    stderr: "pipe",
  });
  const timer = setTimeout(() => {
    process_.kill();
  }, options.timeoutMs ?? 30_000);
  const [stdout, stderr, code] = await Promise.all([
    new Response(process_.stdout).text(),
    new Response(process_.stderr).text(),
    process_.exited,
  ]);
  clearTimeout(timer);
  return { code, stdout, stderr };
}

export async function waitForFile(path: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await Bun.file(path).exists())) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${path}`);
    await Bun.sleep(10);
  }
}
