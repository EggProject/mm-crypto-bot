import { closeSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import nodePath from "node:path";
import { describe, expect, it } from "vitest";

import {
  createLoggingE2eArtifactRun as createArtifactRun,
  createNodeArtifactRunFileSystem,
  LoggingE2eArtifactError as ArtifactRunError,
  type LoggingE2eArtifactErrorCode as ArtifactRunErrorCode,
} from "./logging-e2e-artifact-run.ts";
import {
  artifactPathMetadata,
  createArtifactRunFileSystem,
  TestArtifactFileSystemError,
} from "./logging-e2e-artifact-run.test-support.ts";

function expectArtifactError(
  action: () => void,
  code: ArtifactRunErrorCode,
  expectedCause?: unknown,
): ArtifactRunError {
  let thrown: unknown;
  try {
    action();
  } catch (error: unknown) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(ArtifactRunError);
  if (!(thrown instanceof ArtifactRunError)) throw new Error("Expected a logging artifact error.");
  expect(thrown.code).toBe(code);
  if (expectedCause !== undefined) expect(thrown.cause).toBe(expectedCause);
  return thrown;
}

function writeExternalArtifact(path: string, contents: Uint8Array): void {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- This exact path belongs to this test's fresh artifact directory.
  writeFileSync(path, contents);
}

function removeExternalArtifact(path: string): void {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- This exact path belongs to this test's fresh artifact directory.
  unlinkSync(path);
}

describe("logging E2E artifact run adoption", () => {
  it.each<readonly [readonly string[]]>([[["zeta.json", "alpha.json"]], [["alpha.json", "zeta.json"]]])(
    "adopts real raw files in lexical order for filesystem enumeration %o",
    (enumerationOrder) => {
      const sourceFileSystem = createNodeArtifactRunFileSystem();
      let readdirOverride: readonly string[] | undefined;
      const run = createArtifactRun(
        {},
        createArtifactRunFileSystem({
          readdir: (path) => readdirOverride ?? sourceFileSystem.readdir(path),
        }),
      );
      const alphaPath = nodePath.join(run.paths.raw, "alpha.json");
      const zetaPath = nodePath.join(run.paths.raw, "zeta.json");
      try {
        writeExternalArtifact(alphaPath, new Uint8Array([97]));
        writeExternalArtifact(zetaPath, new Uint8Array([122]));

        readdirOverride = enumerationOrder;
        expect(run.adoptExternalFiles("raw")).toEqual(["alpha.json", "zeta.json"]);
      } finally {
        readdirOverride = undefined;
        run.cleanup();
      }
    },
  );

  it("adopts real external files in lexical order, reads exact bytes, and cleans them", () => {
    const run = createArtifactRun();
    const rawPath = nodePath.join(run.paths.raw, "raw.json");
    const zetaPath = nodePath.join(run.paths.bundle, "zeta.json");
    const alphaPath = nodePath.join(run.paths.bundle, "alpha.json");
    try {
      writeExternalArtifact(rawPath, new Uint8Array([114, 97, 119]));
      writeExternalArtifact(zetaPath, new Uint8Array([122]));
      writeExternalArtifact(alphaPath, new Uint8Array([97]));

      const rawFiles = run.adoptExternalFiles("raw");
      const bundleFiles = run.adoptExternalFiles("bundle");

      expect(rawFiles).toEqual(["raw.json"]);
      expect(bundleFiles).toEqual(["alpha.json", "zeta.json"]);
      expect(Object.isFrozen(rawFiles)).toBe(true);
      expect(Object.isFrozen(bundleFiles)).toBe(true);
      expect([...run.readFile("raw", "raw.json")]).toEqual([114, 97, 119]);
      expect([...run.readFile("bundle", "alpha.json")]).toEqual([97]);
      expect([...run.readFile("bundle", "zeta.json")]).toEqual([122]);
    } finally {
      run.cleanup();
    }
  });

  it("adopts an empty directory as a frozen empty list", () => {
    const run = createArtifactRun();
    try {
      const adopted = run.adoptExternalFiles("raw");
      expect(adopted).toEqual([]);
      expect(Object.isFrozen(adopted)).toBe(true);
    } finally {
      run.cleanup();
    }
  });

  it("adopts the same unchanged external file idempotently", () => {
    const run = createArtifactRun();
    const filePath = nodePath.join(run.paths.raw, "repeat.json");
    try {
      writeExternalArtifact(filePath, new Uint8Array([1]));
      expect(run.adoptExternalFiles("raw")).toEqual(["repeat.json"]);
      expect(run.adoptExternalFiles("raw")).toEqual(["repeat.json"]);
    } finally {
      run.cleanup();
    }
  });

  it("rejects adoption after cleanup", () => {
    const run = createArtifactRun();
    run.cleanup();
    expectArtifactError(() => {
      run.adoptExternalFiles("raw");
    }, "CLEANUP");
  });

  it("maps external-directory listing EIO to IO with its cause", () => {
    const sourceFileSystem = createNodeArtifactRunFileSystem();
    const cause = new TestArtifactFileSystemError("EIO");
    let isFailureEnabled = true;
    const run = createArtifactRun(
      {},
      createArtifactRunFileSystem({
        readdir: (path) => {
          if (isFailureEnabled) throw cause;
          return sourceFileSystem.readdir(path);
        },
      }),
    );
    try {
      expectArtifactError(
        () => {
          run.adoptExternalFiles("raw");
        },
        "IO",
        cause,
      );
    } finally {
      isFailureEnabled = false;
      run.cleanup();
    }
  });

  it("rejects an invalid external entry before opening it", () => {
    const sourceFileSystem = createNodeArtifactRunFileSystem();
    let isInvalidEntryEnabled = true;
    let openCalls = 0;
    const run = createArtifactRun(
      {},
      createArtifactRunFileSystem({
        open: (path, flags, mode) => {
          openCalls += 1;
          return mode === undefined
            ? sourceFileSystem.open(path, flags)
            : sourceFileSystem.open(path, flags, mode);
        },
        readdir: (path) => (isInvalidEntryEnabled ? ["../escape"] : sourceFileSystem.readdir(path)),
      }),
    );
    try {
      openCalls = 0;
      expectArtifactError(() => {
        run.adoptExternalFiles("raw");
      }, "TYPE");
      expect(openCalls).toBe(0);
    } finally {
      isInvalidEntryEnabled = false;
      run.cleanup();
    }
  });

  it("maps external file open ELOOP and EIO to their typed adoption errors", () => {
    const sourceFileSystem = createNodeArtifactRunFileSystem();
    const symlinkCause = new TestArtifactFileSystemError("ELOOP");
    const ioCause = new TestArtifactFileSystemError("EIO");
    let failure: Error | undefined;
    const run = createArtifactRun(
      {},
      createArtifactRunFileSystem({
        open: (path, flags, mode) => {
          if (failure !== undefined && mode === undefined && path.endsWith("/external.json")) throw failure;
          return mode === undefined
            ? sourceFileSystem.open(path, flags)
            : sourceFileSystem.open(path, flags, mode);
        },
      }),
    );
    const filePath = nodePath.join(run.paths.raw, "external.json");
    try {
      writeExternalArtifact(filePath, new Uint8Array([1]));
      failure = symlinkCause;
      expectArtifactError(
        () => {
          run.adoptExternalFiles("raw");
        },
        "SYMLINK",
        symlinkCause,
      );
      failure = ioCause;
      expectArtifactError(
        () => {
          run.adoptExternalFiles("raw");
        },
        "IO",
        ioCause,
      );
    } finally {
      failure = undefined;
      removeExternalArtifact(filePath);
      run.cleanup();
    }
  });

  it("maps non-file and fstat I/O external descriptors to typed adoption errors", () => {
    const sourceFileSystem = createNodeArtifactRunFileSystem();
    const cause = new TestArtifactFileSystemError("EIO");
    let externalDescriptor: number | undefined;
    let fault: "type" | "io" | undefined;
    const run = createArtifactRun(
      {},
      createArtifactRunFileSystem({
        fstat: (descriptor) => {
          if (descriptor === externalDescriptor && fault === "type") return artifactPathMetadata("other");
          if (descriptor === externalDescriptor && fault === "io") throw cause;
          return sourceFileSystem.fstat(descriptor);
        },
        open: (path, flags, mode) => {
          const descriptor =
            mode === undefined
              ? sourceFileSystem.open(path, flags)
              : sourceFileSystem.open(path, flags, mode);
          if (mode === undefined && path.endsWith("/external.json")) externalDescriptor = descriptor;
          return descriptor;
        },
      }),
    );
    const filePath = nodePath.join(run.paths.raw, "external.json");
    try {
      writeExternalArtifact(filePath, new Uint8Array([1]));
      fault = "type";
      const typeError = expectArtifactError(() => {
        run.adoptExternalFiles("raw");
      }, "TYPE");
      expect(typeError.cause).toBeUndefined();
      fault = "io";
      expectArtifactError(
        () => {
          run.adoptExternalFiles("raw");
        },
        "IO",
        cause,
      );
    } finally {
      fault = undefined;
      removeExternalArtifact(filePath);
      run.cleanup();
    }
  });

  it("rejects an external file identity mismatch after it opens", () => {
    const sourceFileSystem = createNodeArtifactRunFileSystem();
    const run = createArtifactRun(
      {},
      createArtifactRunFileSystem({
        lstat: (path) =>
          path.endsWith("/external.json")
            ? artifactPathMetadata("file", 9n, 9n)
            : sourceFileSystem.lstat(path),
      }),
    );
    const filePath = nodePath.join(run.paths.raw, "external.json");
    try {
      writeExternalArtifact(filePath, new Uint8Array([1]));
      expectArtifactError(() => {
        run.adoptExternalFiles("raw");
      }, "IDENTITY");
    } finally {
      removeExternalArtifact(filePath);
      run.cleanup();
    }
  });

  it("rejects an atomically replaced external file after its first adoption", () => {
    const run = createArtifactRun();
    const filePath = nodePath.join(run.paths.bundle, "external.json");
    const originalPath = `${filePath}.original`;
    try {
      writeExternalArtifact(filePath, new Uint8Array([1]));
      run.adoptExternalFiles("bundle");
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- These exact paths belong to this test's fresh artifact directory.
      renameSync(filePath, originalPath);
      writeExternalArtifact(filePath, new Uint8Array([2]));
      expectArtifactError(() => {
        run.readFile("bundle", "external.json");
      }, "IDENTITY");
      expectArtifactError(() => {
        run.adoptExternalFiles("bundle");
      }, "IDENTITY");
    } finally {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- These exact paths belong to this test's fresh artifact directory.
      unlinkSync(filePath);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- These exact paths belong to this test's fresh artifact directory.
      renameSync(originalPath, filePath);
      run.cleanup();
    }
  });

  it("reports an adoption close I/O failure only after closing the descriptor and permits cleanup", () => {
    const sourceFileSystem = createNodeArtifactRunFileSystem();
    const cause = new TestArtifactFileSystemError("ECLOSE");
    let externalDescriptor: number | undefined;
    let isCloseFailureEnabled = true;
    const closedDescriptors: number[] = [];
    const run = createArtifactRun(
      {},
      createArtifactRunFileSystem({
        close: (descriptor) => {
          sourceFileSystem.close(descriptor);
          closedDescriptors.push(descriptor);
          if (isCloseFailureEnabled && descriptor === externalDescriptor) throw cause;
        },
        open: (path, flags, mode) => {
          const descriptor =
            mode === undefined
              ? sourceFileSystem.open(path, flags)
              : sourceFileSystem.open(path, flags, mode);
          if (mode === undefined && path.endsWith("/external.json")) externalDescriptor = descriptor;
          return descriptor;
        },
      }),
    );
    const filePath = nodePath.join(run.paths.raw, "external.json");
    try {
      writeExternalArtifact(filePath, new Uint8Array([1]));
      expectArtifactError(
        () => {
          run.adoptExternalFiles("raw");
        },
        "IO",
        cause,
      );
      if (externalDescriptor === undefined) throw new Error("Expected an external descriptor.");
      expect(closedDescriptors).toContain(externalDescriptor);
    } finally {
      isCloseFailureEnabled = false;
      run.cleanup();
    }
  });

  it("preserves primary identity and type adoption errors when descriptor close also fails", () => {
    const sourceFileSystem = createNodeArtifactRunFileSystem();
    const closeCause = new TestArtifactFileSystemError("ECLOSE");
    let externalDescriptor: number | undefined;
    let fault: "identity" | "type" | undefined;
    let isCloseFailureEnabled = true;
    const run = createArtifactRun(
      {},
      createArtifactRunFileSystem({
        close: (descriptor) => {
          closeSync(descriptor);
          if (isCloseFailureEnabled && descriptor === externalDescriptor) throw closeCause;
        },
        fstat: (descriptor) =>
          descriptor === externalDescriptor && fault === "type"
            ? artifactPathMetadata("other")
            : sourceFileSystem.fstat(descriptor),
        lstat: (path) =>
          fault === "identity" && path.endsWith("/external.json")
            ? artifactPathMetadata("file", 9n, 9n)
            : sourceFileSystem.lstat(path),
        open: (path, flags, mode) => {
          const descriptor =
            mode === undefined
              ? sourceFileSystem.open(path, flags)
              : sourceFileSystem.open(path, flags, mode);
          if (mode === undefined && path.endsWith("/external.json")) externalDescriptor = descriptor;
          return descriptor;
        },
      }),
    );
    const filePath = nodePath.join(run.paths.raw, "external.json");
    try {
      writeExternalArtifact(filePath, new Uint8Array([1]));
      fault = "identity";
      const identityError = expectArtifactError(() => {
        run.adoptExternalFiles("raw");
      }, "IDENTITY");
      expect(identityError.cause).toBeUndefined();
      fault = "type";
      const typeError = expectArtifactError(() => {
        run.adoptExternalFiles("raw");
      }, "TYPE");
      expect(typeError.cause).toBeUndefined();
    } finally {
      fault = undefined;
      isCloseFailureEnabled = false;
      removeExternalArtifact(filePath);
      run.cleanup();
    }
  });
});
