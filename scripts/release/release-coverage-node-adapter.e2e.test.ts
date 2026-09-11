import { describe, expect, test } from "vitest";

import {
  createNodeReleaseCoverageChildPort,
  createNodeReleaseCoverageDependencies,
  createReleaseCoverageCommand,
  runReleaseCoverageEntrypoint,
  type RawNodeChild,
  type RawNodeSpawn,
  type ReleaseCoverageChildInput,
} from "./release-coverage";

class EventChild implements RawNodeChild {
  readonly listeners = new Map<string, (...values: unknown[]) => void>();

  once(eventName: string, listener: (...values: unknown[]) => void): RawNodeChild {
    this.listeners.set(eventName, listener);
    return this;
  }

  emit(eventName: "close" | "error", ...values: unknown[]): void {
    const listener = this.listeners.get(eventName);
    if (listener === undefined) throw new Error(`missing ${eventName} listener`);
    listener(...values);
  }
}

const command: ReleaseCoverageChildInput = {
  argv: ["node", "node_modules/vitest/vitest.mjs", "run"],
  cwd: "/trusted/repository",
  env: Object.freeze({ PATH: "/usr/bin" }),
};

describe("release coverage Node adapter", () => {
  test("uses fixed spawn arguments and resolves only the close event result", async () => {
    const child = new EventChild();
    const calls: (readonly [string, readonly string[], unknown])[] = [];
    const spawn: RawNodeSpawn = (executable, argv, options) => {
      calls.push([executable, argv, options]);
      return child;
    };
    const result = createNodeReleaseCoverageChildPort(spawn)(command);
    child.emit("close", 0, undefined);
    await expect(result).resolves.toEqual({ signal: undefined, status: 0 });
    expect(calls).toEqual([
      [
        "node",
        ["node_modules/vitest/vitest.mjs", "run"],
        { cwd: "/trusted/repository", env: { PATH: "/usr/bin" }, shell: false, stdio: "ignore" },
      ],
    ]);
  });

  test("redacts child error details and rejects missing executables before spawning", async () => {
    const child = new EventChild();
    let calls = 0;
    const port = createNodeReleaseCoverageChildPort(() => {
      calls += 1;
      return child;
    });
    const pending = port(command);
    child.emit("error", new Error("secret child stderr"));
    await expect(pending).rejects.toThrow("coverage child failed");
    await expect(port({ ...command, argv: [] })).rejects.toThrow("invalid coverage child command");
    expect(calls).toBe(1);
  });

  test("normalizes untrusted close values before the coverage command validates them", async () => {
    for (const [status, signal, expected] of [
      ["0", "SIGTERM", { signal: "SIGTERM", status: undefined }],
      [undefined, undefined, { signal: undefined, status: undefined }],
    ] as const) {
      const child = new EventChild();
      const result = createNodeReleaseCoverageChildPort(() => child)(command);
      child.emit("close", status, signal);
      await expect(result).resolves.toEqual(expected);
    }
  });

  test("composes sanitized Node dependencies with the public command factory", () => {
    const dependencies = createNodeReleaseCoverageDependencies(
      "/trusted/repository",
      { NODE: "/tmp/bun-node-selected/node", PATH: "/tmp/bun-node-selected:/usr/bin", SAFE: "yes" },
      "/tmp",
      () => Promise.resolve({ signal: undefined, status: 0 }),
    );
    expect(dependencies.environment).toEqual({ PATH: "/usr/bin", SAFE: "yes" });
    expect(Object.isFrozen(dependencies)).toBe(true);
    expect(createReleaseCoverageCommand(["--level=unit"], dependencies)).toBeTypeOf("function");
  });

  test("invokes each production Node coverage reader without exposing its filesystem errors", async () => {
    const dependencies = createNodeReleaseCoverageDependencies(
      process.cwd(),
      { PATH: process.env["PATH"] ?? "" },
      "/tmp",
      () => Promise.resolve({ signal: undefined, status: 0 }),
    );
    const reports = await Promise.allSettled([
      dependencies.readUnitCoverageSummary(),
      dependencies.readUnitLcov(),
      dependencies.readE2eCoverageSummary(),
      dependencies.readE2eLcov(),
    ]);
    expect(reports).toHaveLength(4);
  });

  test("leaves imported entrypoints inert and maps main success or failures to redacted process state", async () => {
    const imported = { exitCode: 2 };
    let importedCalls = 0;
    await expect(
      runReleaseCoverageEntrypoint({
        argv: [],
        exitCodeTarget: imported,
        isMain: false,
        runCommand: () => {
          importedCalls += 1;
          return Promise.resolve();
        },
        writeStderr: () => {
          throw new Error("unexpected stderr write");
        },
      }),
    ).resolves.toBe(2);
    expect(importedCalls).toBe(0);
    expect(imported.exitCode).toBe(2);

    const success = { exitCode: 2 };
    await expect(
      runReleaseCoverageEntrypoint({
        argv: [],
        exitCodeTarget: success,
        isMain: true,
        runCommand: () => Promise.resolve(),
        writeStderr: () => {
          throw new Error("unexpected stderr write");
        },
      }),
    ).resolves.toBe(0);
    expect(success.exitCode).toBe(0);

    const failure = { exitCode: 2 };
    const stderr: string[] = [];
    await expect(
      runReleaseCoverageEntrypoint({
        argv: [],
        exitCodeTarget: failure,
        isMain: true,
        runCommand: () => Promise.reject(new Error("secret diagnostic")),
        writeStderr: (text) => {
          stderr.push(text);
        },
      }),
    ).resolves.toBe(1);
    expect(failure.exitCode).toBe(1);
    expect(stderr).toEqual(["release coverage failed\n"]);
  });
});
