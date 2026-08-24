import { mkdtempSync, readFileSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { describe, expect, it } from "vitest";

import {
  createLoggingE2eArtifactRun as createArtifactRun,
  LoggingE2eArtifactError as ArtifactRunError,
} from "./logging-e2e-artifact-run.ts";
import { collectLoggingEndToEndCoverage } from "./logging-e2e-gate.ts";
import { loadLoggingEndToEndScopeManifest } from "./logging-e2e-scope.ts";

function firstCaseId(): string {
  const caseId = loadLoggingEndToEndScopeManifest().e2eCases.at(0);
  if (caseId === undefined) throw new Error("Expected the logging E2E manifest to declare a case.");
  return caseId;
}

function writeExternalArtifact(path: string, contents: Uint8Array): void {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- This exact path belongs to this test's fresh artifact directory.
  writeFileSync(path, contents);
}

describe("logging E2E gate raw artifacts", () => {
  it("reads an adopted raw artifact before rejecting malformed JSON", () => {
    const run = createArtifactRun();
    const manifest = loadLoggingEndToEndScopeManifest();
    const caseId = firstCaseId();
    const filename = `${caseId}-123.json`;
    try {
      writeExternalArtifact(nodePath.join(run.paths.raw, filename), new Uint8Array([123]));

      let thrown: unknown;
      try {
        collectLoggingEndToEndCoverage({ artifactRun: run, manifest });
      } catch (error: unknown) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(Error);
      if (!(thrown instanceof Error)) throw new Error("Expected malformed JSON to throw an error.");
      expect(thrown.message).toBe(`Malformed raw logging E2E coverage JSON ${filename}.`);
      expect(thrown.cause).toBeInstanceOf(SyntaxError);
    } finally {
      run.cleanup();
    }
  });

  it("rejects a raw symbolic link before reading its target", () => {
    const run = createArtifactRun();
    const manifest = loadLoggingEndToEndScopeManifest();
    const caseId = firstCaseId();
    const targetDirectory = mkdtempSync(nodePath.join(tmpdir(), "mm-crypto-bot-logging-e2e-target-"));
    const targetPath = nodePath.join(targetDirectory, "target.json");
    const linkPath = nodePath.join(run.paths.raw, `${caseId}-123.json`);
    try {
      writeExternalArtifact(targetPath, new Uint8Array([123]));
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- The link and target paths are created by this test.
      symlinkSync(targetPath, linkPath);

      let thrown: unknown;
      try {
        collectLoggingEndToEndCoverage({ artifactRun: run, manifest });
      } catch (error: unknown) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(ArtifactRunError);
      if (!(thrown instanceof ArtifactRunError)) throw new Error("Expected an artifact run error.");
      expect(thrown.code).toBe("SYMLINK");
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- The target path is owned by this test's fresh temporary directory.
      expect([...readFileSync(targetPath)]).toEqual([123]);
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
