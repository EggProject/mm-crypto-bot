import { describe, expect, it } from "vitest";

import { createLoggingEndToEndFixture } from "./logging-e2e-fixture.ts";
import { readRawLoggingEndToEndFiles } from "./logging-e2e-raw-artifact-ingestion.ts";

describe("logging E2E raw artifact ingestion", () => {
  it("returns lexically ordered frozen raw artifacts with their exact bytes", () => {
    const run = createLoggingEndToEndFixture();
    try {
      run.writeFile("raw", "zeta.json", new Uint8Array([122, 101, 116, 97]));
      run.writeFile("raw", "alpha.json", new Uint8Array([97, 108, 112, 104, 97]));

      const artifacts = readRawLoggingEndToEndFiles(run);

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
    const run = createLoggingEndToEndFixture();
    try {
      expect(() => {
        readRawLoggingEndToEndFiles(run);
      }).toThrow("No raw logging E2E coverage files were produced.");
    } finally {
      run.cleanup();
    }
  });

  it("rejects 1025 raw artifacts", () => {
    const run = createLoggingEndToEndFixture();
    try {
      for (let index = 0; index < 1025; index += 1) {
        run.writeFile("raw", `coverage-${String(index)}.json`, new Uint8Array([0]));
      }

      expect(() => {
        readRawLoggingEndToEndFiles(run);
      }).toThrow("Too many raw logging E2E coverage files: 1025.");
    } finally {
      run.cleanup();
    }
  });
});
