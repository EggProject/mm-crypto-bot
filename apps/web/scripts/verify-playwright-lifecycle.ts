import { spawn, spawnSync } from "node:child_process";
import { createConnection } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 7913;

async function isPortOpen(): Promise<boolean> {
  return await new Promise<boolean>((resolveResult) => {
    const socket = createConnection({ host: "127.0.0.1", port: PORT });
    let settled = false;
    const settle = (open: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveResult(open);
    };
    socket.once("connect", () => settle(true));
    socket.once("error", () => settle(false));
    socket.setTimeout(250, () => settle(false));
  });
}

async function waitForPortFree(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isPortOpen())) return true;
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  return !(await isPortOpen());
}

function signalOwnedProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // The group already exited, which is the desired postcondition.
  }
}

async function main(): Promise<void> {
  if (await isPortOpen()) {
    throw new Error(`Port ${String(PORT)} is already occupied; lifecycle ownership is ambiguous.`);
  }

  const build = spawnSync("bun", ["run", "build"], {
    cwd: APP_DIR,
    stdio: "inherit",
  });
  if (build.status !== 0) throw new Error("Dashboard build failed before lifecycle verification.");

  const runner = spawn(
    "bunx",
    ["playwright", "test", "--config=playwright-lifecycle.config.ts"],
    { cwd: APP_DIR, detached: true, stdio: "inherit" },
  );
  if (runner.pid === undefined) throw new Error("Playwright runner did not expose a process id.");
  const runnerPid = runner.pid;
  const deadline = setTimeout(() => signalOwnedProcessGroup(runnerPid, "SIGTERM"), 90_000);
  const exitCode = await new Promise<number | null>((resolveExit, rejectExit) => {
    runner.once("error", rejectExit);
    runner.once("exit", (code) => resolveExit(code));
  }).finally(() => clearTimeout(deadline));

  let portFree = await waitForPortFree(5_000);
  if (!portFree) {
    signalOwnedProcessGroup(runnerPid, "SIGTERM");
    portFree = await waitForPortFree(5_000);
  }
  if (!portFree) {
    signalOwnedProcessGroup(runnerPid, "SIGKILL");
    portFree = await waitForPortFree(2_000);
  }
  if (!portFree) throw new Error(`Owned preview did not release port ${String(PORT)}.`);
  if (exitCode !== 0) throw new Error(`Focused Playwright lifecycle test exited ${String(exitCode)}.`);

  console.log(`Playwright lifecycle verified: owned preview exited and port ${String(PORT)} is free.`);
}

await main();
