import { expect, test } from "bun:test";
import path from "node:path";

import { createNodeZeroLegacyScannerPort, type ZeroLegacyPathKind } from "./zero-legacy-scanner.ts";
import type { ZeroLegacySecureIo } from "./zero-legacy-secure-io.ts";

function createSecureIo(kinds: ReadonlyMap<string, ZeroLegacyPathKind>): ZeroLegacySecureIo {
  const secureIo: ZeroLegacySecureIo = {
    canonicalize: (absolutePath) => Promise.resolve(`${absolutePath}/canonical`),
    inspectPath: (_repoRoot, absolutePath) =>
      absolutePath === "missing"
        ? Promise.resolve(undefined)
        : Promise.resolve(Object.freeze({ kind: kinds.get(absolutePath) ?? "other" })),
    readDirectory: () => Promise.resolve(Object.freeze(["alpha", "beta"])),
    readUtf8: () => Promise.resolve("fixture source"),
  };
  return Object.freeze(secureIo);
}

test("node port factory forwards typed read-only dependencies and distinguishes every node kind", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const kinds = new Map<string, ZeroLegacyPathKind>([
    ["directory", "directory"],
    ["file", "file"],
    ["symlink", "symlink"],
    ["other", "other"],
  ]);
  let receivedGitInvocation: readonly string[] | undefined;
  const port = createNodeZeroLegacyScannerPort({
    execFile: (_file, arguments_, _options, callback) => {
      receivedGitInvocation = [...arguments_];
      callback(undefined, "/fixture/repository\n");
    },
    secureIo: createSecureIo(kinds),
    writeStderr: (message) => {
      stderr.push(message);
    },
    writeStdout: (message) => {
      stdout.push(message);
    },
  });

  expect(Object.isFrozen(port)).toBeTrue();
  expect(await port.canonicalize("/fixture")).toBe("/fixture/canonical");
  expect(await port.getGitTopLevel("/fixture")).toBe("/fixture/repository");
  expect(receivedGitInvocation).toEqual(["-C", "/fixture", "rev-parse", "--show-toplevel"]);
  expect(await port.inspectPath("/fixture", "directory")).toEqual({ kind: "directory" });
  expect(await port.inspectPath("/fixture", "file")).toEqual({ kind: "file" });
  expect(await port.inspectPath("/fixture", "symlink")).toEqual({ kind: "symlink" });
  expect(await port.inspectPath("/fixture", "other")).toEqual({ kind: "other" });
  expect(await port.inspectPath("/fixture", "missing")).toBeUndefined();
  expect(await port.readDirectory("/fixture", "/fixture")).toEqual(["alpha", "beta"]);
  expect(await port.readUtf8("/fixture", "/fixture/file.ts")).toBe("fixture source");
  port.writeStdout("out");
  port.writeStderr("err");
  expect(stdout).toEqual(["out"]);
  expect(stderr).toEqual(["err"]);
});

test("default node port exposes only secure read operations", async () => {
  const port = createNodeZeroLegacyScannerPort();
  const currentWorkingDirectory = process.cwd();

  expect(await port.canonicalize(currentWorkingDirectory)).toBe(currentWorkingDirectory);
  expect(await port.getGitTopLevel(currentWorkingDirectory)).toBe(currentWorkingDirectory);
  const rootMetadata = await port.inspectPath(currentWorkingDirectory, currentWorkingDirectory);
  expect(rootMetadata?.kind).toBe("directory");
  const directoryEntries = await port.readDirectory(
    currentWorkingDirectory,
    currentWorkingDirectory,
    rootMetadata?.identity,
  );
  expect(directoryEntries.length).toBeGreaterThan(0);
  const packagePath = path.join(currentWorkingDirectory, "package.json");
  const packageMetadata = await port.inspectPath(currentWorkingDirectory, packagePath);
  expect(await port.readUtf8(currentWorkingDirectory, packagePath, packageMetadata?.identity)).toContain(
    '"name"',
  );
  port.writeStdout("");
  port.writeStderr("");
});

test("node port preserves typed secure-IO failures", async () => {
  const port = createNodeZeroLegacyScannerPort({
    secureIo: Object.freeze({
      canonicalize: (absolutePath: string) => Promise.resolve(absolutePath),
      inspectPath: () => Promise.reject(new Error("permission denied")),
      readDirectory: () => Promise.resolve(Object.freeze([])),
      readUtf8: () => Promise.resolve(""),
    }),
  });

  let error: unknown;
  try {
    await port.inspectPath("/fixture", "/fixture/forbidden");
  } catch (error_: unknown) {
    error = error_;
  }
  expect(error).toBeInstanceOf(Error);
  if (error instanceof Error) {
    expect(error.message).toBe("permission denied");
  }
});

test("node port propagates Git top-level lookup failures", async () => {
  const port = createNodeZeroLegacyScannerPort({
    execFile: (_file, _arguments, _options, callback) => {
      callback(new Error("Git unavailable"), "");
    },
  });

  let error: unknown;
  try {
    await port.getGitTopLevel("/fixture");
  } catch (error_: unknown) {
    error = error_;
  }
  expect(error).toBeInstanceOf(Error);
  if (error instanceof Error) {
    expect(error.message).toBe("Git top-level could not be resolved");
  }
});
