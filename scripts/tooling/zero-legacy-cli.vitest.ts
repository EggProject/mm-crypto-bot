import { afterEach, beforeEach, expect, test, vi } from "vitest";

const originalArguments = [...process.argv];
const originalExitCode = process.exitCode;

beforeEach(() => {
  vi.resetModules();
  process.argv = ["bun", "scripts/tooling/zero-legacy-cli.ts", "--repository-root", "/fixture/repository"];
  process.exitCode = undefined;
});

afterEach(() => {
  process.argv = [...originalArguments];
  process.exitCode = originalExitCode;
  vi.doUnmock("./zero-legacy-scanner.ts");
});

test("CLI forwards only user arguments to the scanner and restores the caller exit code", async () => {
  let receivedArguments: readonly string[] | undefined;
  vi.doMock("./zero-legacy-scanner.ts", () => ({
    runZeroLegacyScannerCli: (arguments_: readonly string[]) => {
      receivedArguments = [...arguments_];
      return Promise.resolve({ exitCode: 2 });
    },
  }));

  const savedExitCode = process.exitCode;
  await import("./zero-legacy-cli.ts");

  expect(receivedArguments).toEqual(["--repository-root", "/fixture/repository"]);
  expect(process.exitCode).toBe(2);

  process.exitCode = savedExitCode;
  expect(process.exitCode).toBeUndefined();
});
