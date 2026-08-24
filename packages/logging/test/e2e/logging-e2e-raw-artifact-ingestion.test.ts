import { mkdtempSync, readFileSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { describe, expect, it } from "vitest";

import {
  createLoggingE2eArtifactRun as createArtifactRun,
  LoggingE2eArtifactError as ArtifactRunError,
} from "./logging-e2e-artifact-run.ts";
// eslint-disable-next-line unicorn/name-replacements -- Established public E2E artifact contract.
import { readAdoptedRawLoggingE2eArtifacts } from "./logging-e2e-raw-artifact-ingestion.ts";

function writeExternalArtifact(path: string, contents: Uint8Array): void {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- This exact path belongs to this test's fresh artifact directory.
  writeFileSync(path, contents);
}

describe("logging E2E raw artifact ingestion", () => {
  it("returns lexically ordered frozen raw artifacts with their exact bytes", () => {
    const run = createArtifactRun();
    try {
      writeExternalArtifact(nodePath.join(run.paths.raw, "zeta.json"), new Uint8Array([122, 101, 116, 97]));
      writeExternalArtifact(
        nodePath.join(run.paths.raw, "alpha.json"),
        new Uint8Array([97, 108, 112, 104, 97]),
      );

      const artifacts = readAdoptedRawLoggingE2eArtifacts(run);

      expect(artifacts.map((artifact) => artifact.name)).toEqual(["alpha.json", "zeta.json"]);
      expect(artifacts.map((artifact) => [...artifact.contents])).toEqual([
        [97, 108, 112, 104, 97],
        [122, 101, 116, 97],
      ]);
      expect(Object.isFrozen(artifacts)).toBe(true);
      expect(artifacts.every((artifact) => Object.isFrozen(artifact))).toBe(true);
    } finally {
      run.cleanup();
    }
  });

  it("rejects an empty raw artifact directory", () => {
    const run = createArtifactRun();
    try {
      expect(() => {
        readAdoptedRawLoggingE2eArtifacts(run);
      }).toThrow("No raw logging E2E coverage files were produced.");
    } finally {
      run.cleanup();
    }
  });

  it("rejects 1025 raw artifacts", () => {
    const run = createArtifactRun();
    try {
      for (let index = 0; index < 1025; index += 1) {
        writeExternalArtifact(
          nodePath.join(run.paths.raw, `coverage-${String(index)}.json`),
          new Uint8Array([0]),
        );
      }

      expect(() => {
        readAdoptedRawLoggingE2eArtifacts(run);
      }).toThrow("Too many raw logging E2E coverage files: 1025.");
    } finally {
      run.cleanup();
    }
  });

  it("propagates a symbolic-link artifact rejection without reading its target", () => {
    const run = createArtifactRun();
    const targetDirectory = mkdtempSync(nodePath.join(tmpdir(), "mm-crypto-bot-logging-e2e-target-"));
    const targetPath = nodePath.join(targetDirectory, "target.json");
    const linkPath = nodePath.join(run.paths.raw, "linked.json");
    try {
      writeExternalArtifact(targetPath, new Uint8Array([116, 97, 114, 103, 101, 116]));
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- The link and target paths are created by this test.
      symlinkSync(targetPath, linkPath);

      let thrown: unknown;
      try {
        readAdoptedRawLoggingE2eArtifacts(run);
      } catch (error: unknown) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(ArtifactRunError);
      if (!(thrown instanceof ArtifactRunError)) throw new Error("Expected an artifact run error.");
      expect(thrown.code).toBe("SYMLINK");
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- The target path is owned by this test's fresh temporary directory.
      expect([...readFileSync(targetPath)]).toEqual([116, 97, 114, 103, 101, 116]);
    } finally {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- The link path belongs to this test's fresh artifact directory.
      unlinkSync(linkPath);
      run.cleanup();
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- The target path is owned by this test's fresh temporary directory.
      unlinkSync(targetPath);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- The directory is owned by this test's fresh temporary directory.
      rmdirSync(targetDirectory);
    }
  });
});
