/* eslint-disable security/detect-non-literal-fs-filename -- tests write only below their fresh mkdtemp directory */
import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { collectBotE2eCoverage } from "./bot-e2e-gate.ts";
import { loadScopeManifest, parseScopeManifest } from "./bot-runtime-scope.ts";

const manifest = loadScopeManifest();
const location = {
  start: { line: 1, column: 0 },
  end: { line: 1, column: 1 },
};

function fileCoverage(path: string, count = 1) {
  return {
    path,
    statementMap: { "0": location },
    fnMap: { "0": { name: "covered", decl: location, loc: location, line: 1 } },
    branchMap: { "0": { loc: location, type: "if", locations: [location, location], line: 1 } },
    s: { "0": count },
    f: { "0": count },
    b: { "0": [count, count] },
  };
}

function fullCoverage(missedFile?: string) {
  return Object.fromEntries(
    manifest.runtimeFiles.map((file) => {
      const absolute = resolve(file);
      return [absolute, fileCoverage(absolute, file === missedFile ? 0 : 1)];
    }),
  );
}

function writeEnvelope(
  directory: string,
  pid: number,
  entryKind: "canonical-cli" | "runtime-driver",
  caseId: string,
  coverage = fullCoverage(),
) {
  writeFileSync(
    join(directory, `${String(pid)}.json`),
    JSON.stringify({
      schemaVersion: 1,
      pid,
      entryKind,
      caseId,
      coverage,
    }),
  );
}

function writeAllRequiredCases(directory: string, coverage = fullCoverage()) {
  let pid = 1000;
  for (const [kind, ids] of Object.entries(manifest.e2eCases)) {
    for (const id of ids) {
      if (kind !== "canonical-cli" && kind !== "runtime-driver") {
        throw new Error(`unexpected manifest entry kind: ${kind}`);
      }
      writeEnvelope(directory, pid++, kind, id, coverage);
    }
  }
}

function withRawDirectory(run: (directory: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), "mm-bot-e2e-gate-test-"));
  try {
    run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("bot subprocess E2E coverage gate", () => {
  it("passes only exact four-metric coverage with all entry kinds and cases", () => {
    withRawDirectory((directory) => {
      writeAllRequiredCases(directory);
      const summary = collectBotE2eCoverage({ rawDirectory: directory });
      expect(summary.passed).toBe(true);
      expect(summary.failures).toEqual([]);
      expect(summary.caseIds).toHaveLength(
        Object.values(manifest.e2eCases).reduce((total, ids) => total + ids.length, 0),
      );
    });
  });

  it("reports an exact metric miss as a gate failure", () => {
    withRawDirectory((directory) => {
      writeAllRequiredCases(directory, fullCoverage(manifest.runtimeFiles[0]));
      const summary = collectBotE2eCoverage({ rawDirectory: directory });
      expect(summary.passed).toBe(false);
      expect(summary.failures).toEqual(["statements", "branches", "functions", "lines"]);
    });
  });

  it("hard-fails when no PID coverage file exists", () => {
    withRawDirectory((directory) => {
      expect(() => collectBotE2eCoverage({ rawDirectory: directory })).toThrow("no PID coverage files");
    });
  });

  it("hard-fails a missing or mismatched PID", () => {
    withRawDirectory((directory) => {
      writeEnvelope(directory, 1000, "canonical-cli", "help");
      const original = join(directory, "1000.json");
      writeFileSync(
        original,
        JSON.stringify({
          schemaVersion: 1,
          entryKind: "canonical-cli",
          caseId: "help",
          coverage: fullCoverage(),
        }),
      );
      expect(() => collectBotE2eCoverage({ rawDirectory: directory })).toThrow("PID does not match filename");
    });
  });

  it("hard-fails malformed JSON", () => {
    withRawDirectory((directory) => {
      writeFileSync(join(directory, "1000.json"), "{not-json");
      expect(() => collectBotE2eCoverage({ rawDirectory: directory })).toThrow("malformed raw coverage JSON");
    });
  });

  it("hard-fails an empty coverage payload", () => {
    withRawDirectory((directory) => {
      writeEnvelope(directory, 1000, "canonical-cli", "help", {});
      expect(() => collectBotE2eCoverage({ rawDirectory: directory })).toThrow("payload is empty");
    });
  });

  it("hard-fails when an owned runtime source is missing", () => {
    withRawDirectory((directory) => {
      const firstRuntimeFile = manifest.runtimeFiles[0];
      if (firstRuntimeFile === undefined) throw new Error("coverage manifest has no runtime file");
      const missingFile = resolve(firstRuntimeFile);
      const coverage = Object.fromEntries(
        Object.entries(fullCoverage()).filter(([file]) => file !== missingFile),
      );
      writeAllRequiredCases(directory, coverage);
      expect(() => collectBotE2eCoverage({ rawDirectory: directory })).toThrow("missing owned runtime files");
    });
  });

  it("hard-fails a duplicate manifest scope path", () => {
    expect(() =>
      parseScopeManifest(
        {
          ...manifest,
          runtimeFiles: [manifest.runtimeFiles[0], manifest.runtimeFiles[0]],
        },
        { requireFiles: false },
      ),
    ).toThrow("duplicate path");
  });
});
