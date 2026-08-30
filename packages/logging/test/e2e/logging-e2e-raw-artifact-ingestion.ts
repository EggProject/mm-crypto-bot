import type { LoggingEndToEndFixture } from "./logging-e2e-fixture.ts";

const MAX_RAW_FILES = 1024;

export function readRawLoggingEndToEndFiles(
  fixture: LoggingEndToEndFixture,
): readonly Readonly<{ readonly name: string; readonly contents: Uint8Array }>[] {
  const names = fixture.listFiles("raw");
  if (names.length === 0) throw new Error("No raw logging E2E coverage files were produced.");
  if (names.length > MAX_RAW_FILES) {
    throw new Error(`Too many raw logging E2E coverage files: ${String(names.length)}.`);
  }
  return Object.freeze(names.map((name) => Object.freeze({ name, contents: fixture.readFile("raw", name) })));
}
