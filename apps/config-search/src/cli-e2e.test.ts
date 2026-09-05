import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "bun:test";

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(sourceDirectory, "..");
const unavailableResult =
  '{"available":false,"code":"CONFIG_SEARCH_UNAVAILABLE","operation":"config-search","reason":"exact-strategy-run-corridor-unavailable","schema":"mm-crypto-bot.config-search.result/v1"}\n';

interface ExecutableResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

function runExecutable(executable: string, arguments_: readonly string[]): ExecutableResult {
  const result = spawnSync(executable, arguments_, { encoding: "utf8" });

  if (result.error !== undefined) throw result.error;
  if (result.status === null) throw new Error("The compiled config-search CLI did not exit.");

  return { exitCode: result.status, stderr: result.stderr, stdout: result.stdout };
}

describe("compiled config-search CLI", () => {
  it("preserves the unavailable CLI contract", () => {
    const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "mm-config-search-cli-"));
    const executable = path.join(temporaryDirectory, "mm-crypto-bot-config-search");

    try {
      const build = spawnSync(
        "bun",
        ["build", "src/index.ts", "--compile", "--target=bun-linux-x64", "--outfile", executable],
        { cwd: packageRoot, encoding: "utf8" },
      );
      if (build.error !== undefined) throw build.error;
      expect(build.status, build.stderr).toBe(0);

      const noArgumentResult = runExecutable(executable, []);
      expect(noArgumentResult).toEqual({
        exitCode: 1,
        stderr: "",
        stdout: unavailableResult,
      });
      const statusResult = runExecutable(executable, ["--status"]);
      expect(statusResult).toEqual({
        exitCode: 1,
        stderr: "",
        stdout: unavailableResult,
      });
      const helpResult = runExecutable(executable, ["--help"]);
      expect(helpResult).toEqual({
        exitCode: 0,
        stderr: "",
        stdout: "Usage: mm-crypto-bot-config-search [--status | --help]\n",
      });
      const unsupportedArgumentResult = runExecutable(executable, ["--run"]);
      expect(unsupportedArgumentResult).toEqual({
        exitCode: 2,
        stderr: "config-search: unsupported argument\n",
        stdout: "",
      });
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
