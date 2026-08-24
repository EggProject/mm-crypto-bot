/* eslint-disable security/detect-non-literal-fs-filename -- Tests operate only beneath a fresh artifact root that the primitive owns. */
/* eslint-disable unicorn/name-replacements -- E2E is the established logging test-domain acronym. */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import nodePath from "node:path";
import { describe, expect, it } from "vitest";

import {
  createLoggingE2eArtifactRun,
  LoggingE2eArtifactError,
  type LoggingE2eArtifactErrorCode,
} from "./logging-e2e-artifact-run.ts";

function expectCode(action: () => void, code: LoggingE2eArtifactErrorCode): void {
  let thrown: unknown;
  try {
    action();
  } catch (error: unknown) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(LoggingE2eArtifactError);
  if (thrown instanceof LoggingE2eArtifactError) expect(thrown.code).toBe(code);
}

function cleanupRun(run: ReturnType<typeof createLoggingE2eArtifactRun>): void {
  if (existsSync(run.paths.root)) run.cleanup();
}

describe("logging E2E artifact run", () => {
  it("creates immutable private descriptor-anchored directories and writes, reads, and cleans files", () => {
    const run = createLoggingE2eArtifactRun();
    try {
      expect(Object.isFrozen(run.paths)).toBe(true);
      expect(Object.isFrozen(run.identities)).toBe(true);
      expect(run.paths.root).toContain("mm-crypto-bot-logging-e2e-");
      run.revalidateDirectories();
      run.writeExclusiveFile("raw", "record.json", new TextEncoder().encode("safe"));
      expect(new TextDecoder().decode(run.readFile("raw", "record.json"))).toBe("safe");
      expectCode(() => {
        run.writeExclusiveFile("raw", "record.json", new Uint8Array());
      }, "EXISTS");
    } finally {
      cleanupRun(run);
    }
    expect(existsSync(run.paths.root)).toBe(false);
  });

  it("rejects symbolic-link targets without touching their sentinel", () => {
    const run = createLoggingE2eArtifactRun();
    const sentinel = nodePath.join(run.paths.raw, "sentinel.json");
    try {
      run.writeExclusiveFile("raw", "sentinel.json", new TextEncoder().encode("untouched"));
      symlinkSync(sentinel, nodePath.join(run.paths.raw, "link.json"));
      expectCode(() => {
        run.readFile("raw", "link.json");
      }, "SYMLINK");
      expect(readFileSync(sentinel, "utf8")).toBe("untouched");
    } finally {
      unlinkSync(nodePath.join(run.paths.raw, "link.json"));
      cleanupRun(run);
    }
  });

  it("rejects a directory identity swap", () => {
    const run = createLoggingE2eArtifactRun();
    const movedRaw = `${run.paths.raw}-moved`;
    try {
      renameSync(run.paths.raw, movedRaw);
      mkdirSync(run.paths.raw, { mode: 0o700 });
      expectCode(() => {
        run.revalidateDirectories();
      }, "IDENTITY");
    } finally {
      rmdirSync(run.paths.raw);
      renameSync(movedRaw, run.paths.raw);
      cleanupRun(run);
    }
  });

  it("rejects replacement after a read descriptor opens", () => {
    let replacementPath = "";
    const run = createLoggingE2eArtifactRun({
      afterReadFileOpen: (path) => {
        replacementPath = `${path}.old`;
        renameSync(path, replacementPath);
        writeFileSync(path, "replacement");
      },
    });
    try {
      run.writeExclusiveFile("raw", "record.json", new TextEncoder().encode("original"));
      expectCode(() => {
        run.readFile("raw", "record.json");
      }, "IDENTITY");
    } finally {
      if (replacementPath !== "") {
        unlinkSync(nodePath.join(run.paths.raw, "record.json"));
        renameSync(replacementPath, nodePath.join(run.paths.raw, "record.json"));
      }
      cleanupRun(run);
    }
  });

  it("fails cleanup on an identity swap without deleting an external sentinel", () => {
    const run = createLoggingE2eArtifactRun();
    const movedBundle = `${run.paths.bundle}-moved`;
    try {
      run.writeExclusiveFile("bundle", "bundle.json", new Uint8Array([1]));
      renameSync(run.paths.bundle, movedBundle);
      mkdirSync(run.paths.bundle, { mode: 0o700 });
      expectCode(() => {
        run.cleanup();
      }, "IDENTITY");
      expect(existsSync(nodePath.join(movedBundle, "bundle.json"))).toBe(true);
    } finally {
      rmdirSync(run.paths.bundle);
      renameSync(movedBundle, run.paths.bundle);
      cleanupRun(run);
    }
  });

  it("fails cleanup when an unknown entry keeps a directory nonempty", () => {
    const run = createLoggingE2eArtifactRun();
    try {
      writeFileSync(nodePath.join(run.paths.raw, "unknown.json"), "unknown");
      expectCode(() => {
        run.cleanup();
      }, "CLEANUP");
    } finally {
      unlinkSync(nodePath.join(run.paths.raw, "unknown.json"));
      cleanupRun(run);
    }
  });
});
