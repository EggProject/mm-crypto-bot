/* eslint-disable security/detect-non-literal-fs-filename -- candidates come from PATH; output cleanup has an exact parent guard */
import { existsSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { spawn } from "node:child_process";

import { REPOSITORY_ROOT } from "./bot-runtime-scope.ts";

const UNIT_DIRECTORY = resolve(REPOSITORY_ROOT, "apps/bot/coverage/unit");
const COVERAGE_DIRECTORY = resolve(REPOSITORY_ROOT, "apps/bot/coverage");

function findNativeNode(): string {
  const executable = process.platform === "win32" ? "node.exe" : "node";
  for (const directory of (process.env["PATH"] ?? "").split(delimiter)) {
    if (directory.length === 0 || directory.includes("bun-node-")) continue;
    const candidate = join(directory, executable);
    if (!existsSync(candidate)) continue;
    const real = realpathSync(candidate);
    if (real !== process.execPath && !real.includes("/bun")) return candidate;
  }
  throw new Error("native Node.js executable was not found; Vitest coverage must not run under Bun");
}

const nativeNode = findNativeNode();

if (resolve(UNIT_DIRECTORY, "..") !== COVERAGE_DIRECTORY) {
  console.error(`refusing to clean unexpected unit coverage directory: ${UNIT_DIRECTORY}`);
  process.exit(2);
}
rmSync(UNIT_DIRECTORY, { recursive: true, force: true });
mkdirSync(UNIT_DIRECTORY, { recursive: true });

function run(command: string, arguments_: readonly string[]): Promise<number> {
  return new Promise<number>((resolveExit) => {
    const child = spawn(command, arguments_, { cwd: REPOSITORY_ROOT, stdio: "inherit" });
    child.once("error", (error) => {
      console.error(error.message);
      resolveExit(2);
    });
    child.once("exit", (code, signal) => {
      if (signal !== null) console.error(`${command} terminated by ${signal}`);
      resolveExit(code ?? 2);
    });
  });
}

const scopeStatus = await run(nativeNode, [
  resolve(REPOSITORY_ROOT, "scripts/coverage-tools/verify-bot-runtime-scope.ts"),
]);
if (scopeStatus !== 0) process.exit(scopeStatus);

const status = await run(nativeNode, [
  resolve(REPOSITORY_ROOT, "node_modules/vitest/vitest.mjs"),
  "run",
  "--config",
  resolve(REPOSITORY_ROOT, "apps/bot/vitest.config.ts"),
  "--coverage",
  `--coverage.reportsDirectory=${UNIT_DIRECTORY}`,
]);
process.exit(status);
