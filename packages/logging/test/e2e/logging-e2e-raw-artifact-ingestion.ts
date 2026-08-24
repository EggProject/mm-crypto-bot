// eslint-disable-next-line unicorn/name-replacements -- Established public E2E artifact contract.
import { type LoggingE2eArtifactRun } from "./logging-e2e-artifact-run.ts";

const MAX_RAW_FILES = 1024;

// eslint-disable-next-line unicorn/name-replacements -- Established public E2E artifact contract.
export function readAdoptedRawLoggingE2eArtifacts(
  artifactRun: LoggingE2eArtifactRun,
): readonly Readonly<{ readonly name: string; readonly contents: Uint8Array }>[] {
  const names = artifactRun.adoptExternalFiles("raw");
  if (names.length === 0) throw new Error("No raw logging E2E coverage files were produced.");
  if (names.length > MAX_RAW_FILES) {
    throw new Error(`Too many raw logging E2E coverage files: ${String(names.length)}.`);
  }
  return Object.freeze(
    names.map((name) => Object.freeze({ name, contents: artifactRun.readFile("raw", name) })),
  );
}
