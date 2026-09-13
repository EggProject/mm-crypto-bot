import { describe, expect, test } from "vitest";

import {
  createNodeReleaseCoverageGateRunner,
  createNodeReleaseCoverageDependencies,
  createReleaseCoverageCommand,
  runReleaseCoverageEntrypoint,
} from "./release-coverage";
import { runReleaseCoverageNodeGate } from "./release-coverage-node-gate";

describe("release coverage verified Node adapter", () => {
  test("rejects unknown child tags and accepts only the two sealed coverage tags", async () => {
    const gates: string[] = [];
    const runChild = createNodeReleaseCoverageGateRunner((gate) => {
      gates.push(gate);
      return Promise.resolve();
    });
    await expect(runChild({ argv: ["unknown"], cwd: "/repo", env: {} })).rejects.toThrow(
      "invalid coverage child command",
    );
    await expect(runChild({ argv: ["release-coverage-unit"], cwd: "/repo", env: {} })).resolves.toEqual({
      signal: undefined,
      status: 0,
    });
    await expect(runChild({ argv: ["release-coverage-e2e"], cwd: "/repo", env: {} })).resolves.toEqual({
      signal: undefined,
      status: 0,
    });
    expect(gates).toEqual(["unit", "e2e"]);
  });

  test("constructs the production sealed runner without ambient execution", () => {
    expect(createNodeReleaseCoverageGateRunner()).toBeTypeOf("function");
  });
  test("maps both release levels through the sealed protocol boundary", async () => {
    const gates: string[] = [];
    for (const level of ["unit", "e2e"] as const) {
      await runReleaseCoverageNodeGate(level, {}, (_environment, gate) => {
        gates.push(gate);
        return Promise.resolve();
      });
    }
    expect(gates).toEqual(["release-coverage-unit", "release-coverage-e2e"]);
  });

  test("keeps readers inert until the public command runs", async () => {
    const dependencies = createNodeReleaseCoverageDependencies(
      process.cwd(),
      { NODE: "/untrusted/node", PATH: process.env["PATH"] ?? "" },
      "/tmp",
      () => Promise.resolve({ signal: undefined, status: 0 }),
    );
    expect(dependencies.environment).toEqual({ PATH: process.env["PATH"] ?? "" });
    expect(createReleaseCoverageCommand).toBeTypeOf("function");
    await expect(
      runReleaseCoverageEntrypoint({
        argv: [],
        exitCodeTarget: { exitCode: undefined },
        isMain: false,
        runCommand: () => Promise.reject(new Error("must remain inert")),
        writeStderr: () => {
          throw new Error("must remain inert");
        },
      }),
    ).resolves.toBeUndefined();
    const reports = await Promise.allSettled([
      dependencies.readUnitCoverageSummary(),
      dependencies.readUnitLcov(),
      dependencies.readE2eCoverageSummary(),
      dependencies.readE2eLcov(),
    ]);
    expect(reports).toHaveLength(4);
  });

  test("maps executable success and failure to a redacted process result", async () => {
    const success = { exitCode: undefined as number | undefined };
    await expect(
      runReleaseCoverageEntrypoint({
        argv: [],
        exitCodeTarget: success,
        isMain: true,
        runCommand: () => Promise.resolve(),
        writeStderr: () => {
          throw new Error("unexpected stderr");
        },
      }),
    ).resolves.toBe(0);
    const failure = { exitCode: undefined as number | undefined };
    const output: string[] = [];
    await expect(
      runReleaseCoverageEntrypoint({
        argv: [],
        exitCodeTarget: failure,
        isMain: true,
        runCommand: () => Promise.reject(new Error("secret")),
        writeStderr: (text) => {
          output.push(text);
        },
      }),
    ).resolves.toBe(1);
    expect(output).toEqual(["release coverage failed\n"]);
  });
});
