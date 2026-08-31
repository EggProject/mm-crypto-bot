import { expect, test } from "bun:test";
import path from "node:path";

import { createNodeZeroLegacyScannerPort } from "./zero-legacy-scanner.ts";

test("node port factory uses ordinary read-only filesystem operations", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let receivedGitInvocation: readonly string[] | undefined;
  const port = createNodeZeroLegacyScannerPort({
    execFile: (_file, arguments_, _options, callback) => {
      receivedGitInvocation = [...arguments_];
      callback(undefined, "/fixture/repository\n");
    },
    writeStderr: (message) => {
      stderr.push(message);
    },
    writeStdout: (message) => {
      stdout.push(message);
    },
  });

  expect(Object.isFrozen(port)).toBeTrue();
  const currentWorkingDirectory = process.cwd();
  const packagePath = path.join(currentWorkingDirectory, "package.json");
  expect(await port.canonicalize(currentWorkingDirectory)).toBe(currentWorkingDirectory);
  expect(await port.getGitTopLevel(currentWorkingDirectory)).toBe("/fixture/repository");
  expect(receivedGitInvocation).toEqual(["-C", currentWorkingDirectory, "rev-parse", "--show-toplevel"]);
  const workingDirectoryMetadata = await port.inspectPath(currentWorkingDirectory);
  const packageMetadata = await port.inspectPath(packagePath);
  expect(workingDirectoryMetadata?.kind).toBe("directory");
  expect(packageMetadata?.kind).toBe("file");
  expect(workingDirectoryMetadata?.identity).toMatch(/^\d+:\d+$/u);
  expect(packageMetadata?.identity).toMatch(/^\d+:\d+$/u);
  expect(await port.inspectPath(path.join(currentWorkingDirectory, "missing"))).toBeUndefined();
  const directoryEntries = await port.readDirectory(currentWorkingDirectory);
  expect(directoryEntries.length).toBeGreaterThan(0);
  expect(await port.readUtf8(packagePath)).toContain('"name"');
  port.writeStdout("out");
  port.writeStderr("err");
  expect(stdout).toEqual(["out"]);
  expect(stderr).toEqual(["err"]);
});

test("default node port exposes only ordinary read operations", async () => {
  const port = createNodeZeroLegacyScannerPort();
  const currentWorkingDirectory = process.cwd();

  expect(await port.canonicalize(currentWorkingDirectory)).toBe(currentWorkingDirectory);
  expect(await port.getGitTopLevel(currentWorkingDirectory)).toBe(currentWorkingDirectory);
  const rootMetadata = await port.inspectPath(currentWorkingDirectory);
  expect(rootMetadata?.kind).toBe("directory");
  const directoryEntries = await port.readDirectory(currentWorkingDirectory);
  expect(directoryEntries.length).toBeGreaterThan(0);
  const packagePath = path.join(currentWorkingDirectory, "package.json");
  const packageMetadata = await port.inspectPath(packagePath);
  expect(packageMetadata?.kind).toBe("file");
  expect(await port.readUtf8(packagePath)).toContain('"name"');
  port.writeStdout("");
  port.writeStderr("");
});

test("node port propagates ordinary filesystem read failures", async () => {
  const port = createNodeZeroLegacyScannerPort();

  let thrown: unknown;
  try {
    await port.readUtf8(process.cwd());
  } catch (error: unknown) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(Error);
});

test("node port classifies ordinary filesystem paths and propagates inspection errors", async () => {
  const port = createNodeZeroLegacyScannerPort();
  const executableLinkPath = path.join(process.cwd(), "node_modules", ".bin", "prettier");
  const executableLinkMetadata = await port.inspectPath(executableLinkPath);
  const nullMetadata = await port.inspectPath("/dev/null");
  expect(executableLinkMetadata?.kind).toBe("symlink");
  expect(nullMetadata?.kind).toBe("other");

  let thrown: unknown;
  try {
    await port.inspectPath(path.join(process.cwd(), "package.json", "child"));
  } catch (error: unknown) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(Error);
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
