// eslint-disable-next-line unicorn/import-style -- Bun's node:path declaration only exposes typed named imports under the E2E project's configured type roots.
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  LOGGING_DIRECTORY,
  LOGGING_SOURCE_DIRECTORY,
  loadLoggingEndToEndScopeManifest,
  parseLoggingEndToEndScopeManifest,
} from "./logging-e2e-scope.ts";

type FakeDirectoryEntryKind = "directory" | "file" | "other" | "symbolic-link";

interface FakeDirectoryEntry {
  readonly name: string;
  readonly isSymbolicLink: () => boolean;
  readonly isDirectory: () => boolean;
  readonly isFile: () => boolean;
}

function directoryEntry(name: string, kind: FakeDirectoryEntryKind): FakeDirectoryEntry {
  return {
    name,
    isSymbolicLink: () => kind === "symbolic-link",
    isDirectory: () => kind === "directory",
    isFile: () => kind === "file",
  };
}

function manifest(runtimeFiles: readonly string[]): unknown {
  return { schemaVersion: 1, runtimeFiles, e2eCases: ["scope-discovery-case"] };
}

function discoveryPort(
  entriesByDirectory: ReadonlyMap<string, readonly FakeDirectoryEntry[]>,
  failures: Readonly<{ readonly directory?: string; readonly file?: string }> = {},
): {
  readonly readDirectory: (directory: string) => readonly FakeDirectoryEntry[];
  readonly assertDirectory: (path: string, root: string, label: string) => void;
  readonly assertFile: (path: string, root: string, label: string) => void;
  readonly calls: string[];
} {
  const calls: string[] = [];
  return {
    readDirectory: (directory) => {
      calls.push(`read:${directory}`);
      return entriesByDirectory.get(directory) ?? [];
    },
    assertDirectory: (path, root, label) => {
      calls.push(`directory:${path}:${root}:${label}`);
      if (path === failures.directory) throw new Error(`directory rejected: ${path}`);
    },
    assertFile: (path, root, label) => {
      calls.push(`file:${path}:${root}:${label}`);
      if (path === failures.file) throw new Error(`file rejected: ${path}`);
    },
    calls,
  };
}

describe("logging E2E scope discovery", () => {
  it("recursively discovers only non-test TypeScript files in sorted repository scope", () => {
    const nestedDirectory = resolve(LOGGING_SOURCE_DIRECTORY, "nested");
    const port = discoveryPort(
      new Map([
        [
          LOGGING_SOURCE_DIRECTORY,
          [
            directoryEntry("zeta.ts", "file"),
            directoryEntry("readme.md", "file"),
            directoryEntry("ignored.test.ts", "file"),
            directoryEntry("socket", "other"),
            directoryEntry("nested", "directory"),
            directoryEntry("alpha.ts", "file"),
          ],
        ],
        [nestedDirectory, [directoryEntry("beta.ts", "file")]],
      ]),
    );
    const runtimeFiles = [
      "packages/logging/src/alpha.ts",
      "packages/logging/src/nested/beta.ts",
      "packages/logging/src/zeta.ts",
    ];

    expect(
      parseLoggingEndToEndScopeManifest(manifest(runtimeFiles), {
        areFilesRequired: false,
        discoveryPort: port,
      }),
    ).toMatchObject({ runtimeFiles });
    expect(port.calls).toContain(`read:${LOGGING_SOURCE_DIRECTORY}`);
    expect(port.calls).toContain(`read:${nestedDirectory}`);
  });

  it("rejects a symbolic link after reading its parent directory", () => {
    const port = discoveryPort(
      new Map([[LOGGING_SOURCE_DIRECTORY, [directoryEntry("linked.ts", "symbolic-link")]]]),
    );

    expect(() =>
      parseLoggingEndToEndScopeManifest(manifest(["packages/logging/src/linked.ts"]), {
        areFilesRequired: false,
        discoveryPort: port,
      }),
    ).toThrow("must not contain symbolic links");
    expect(port.calls).toEqual([
      `directory:${LOGGING_SOURCE_DIRECTORY}:${LOGGING_SOURCE_DIRECTORY}:Logging runtime source directory`,
      `read:${LOGGING_SOURCE_DIRECTORY}`,
    ]);
  });

  it("propagates a rejected nested directory assertion", () => {
    const nestedDirectory = resolve(LOGGING_SOURCE_DIRECTORY, "nested");
    const port = discoveryPort(
      new Map([
        [LOGGING_SOURCE_DIRECTORY, [directoryEntry("nested", "directory")]],
        [nestedDirectory, [directoryEntry("ignored.ts", "file")]],
      ]),
      { directory: nestedDirectory },
    );

    expect(() =>
      parseLoggingEndToEndScopeManifest(manifest(["packages/logging/src/nested/ignored.ts"]), {
        areFilesRequired: false,
        discoveryPort: port,
      }),
    ).toThrow(`directory rejected: ${nestedDirectory}`);
  });

  it("propagates a rejected runtime file assertion", () => {
    const runtimeFile = resolve(LOGGING_SOURCE_DIRECTORY, "runtime.ts");
    const port = discoveryPort(
      new Map([[LOGGING_SOURCE_DIRECTORY, [directoryEntry("runtime.ts", "file")]]]),
      { file: runtimeFile },
    );

    expect(() =>
      parseLoggingEndToEndScopeManifest(manifest(["packages/logging/src/runtime.ts"]), {
        areFilesRequired: false,
        discoveryPort: port,
      }),
    ).toThrow(`file rejected: ${runtimeFile}`);
  });

  it("wraps a missing repository-local manifest read failure with its cause", () => {
    const missingManifest = resolve(LOGGING_DIRECTORY, "missing-e2e-scope-manifest.json");

    try {
      loadLoggingEndToEndScopeManifest(missingManifest);
      throw new Error("Expected a missing manifest to fail.");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(Error);
      if (!(error instanceof Error)) throw error;
      expect(error.message).toBe(`Cannot read logging E2E coverage manifest ${missingManifest}.`);
      expect(error.cause).toBeInstanceOf(Error);
    }
  });
});
