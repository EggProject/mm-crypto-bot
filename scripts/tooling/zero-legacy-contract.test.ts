import { expect, test } from "bun:test";

import { zeroLegacyScannerConfig } from "./zero-legacy-config.ts";
import { evaluateZeroLegacyContract, type ZeroLegacySemanticEntry } from "./zero-legacy-contract.ts";

function entry(
  signal: ZeroLegacySemanticEntry["signal"],
  path: string,
  target?: string,
): ZeroLegacySemanticEntry {
  return { signal, path, location: `${path}:1`, ...(target !== undefined && { target }) };
}

test("terminal paths and descendants are legacy findings", () => {
  const evaluation = evaluateZeroLegacyContract([
    entry("legacy-directory", "docs/legacy"),
    entry("legacy-file", "docs/legacy/old.md"),
    entry("legacy-file", "bin/mm-bot"),
    entry("legacy-file", "run-bot/launcher.ts"),
    entry("legacy-file", "search-best-config/config.ts"),
    entry("legacy-file", "scripts/install-mm-bot.sh"),
  ]);

  expect(evaluation.status).toBe("fail");
  expect(evaluation.findings.map((finding) => finding.category)).toEqual([
    "legacy-directory",
    "legacy-file",
    "legacy-file",
    "legacy-file",
    "legacy-file",
    "legacy-file",
  ]);
});

test("a safe non-terminal directory is not a legacy finding", () => {
  const evaluation = evaluateZeroLegacyContract([
    entry("legacy-directory", "docs/current"),
    entry("legacy-file", "scripts/current-tool.ts"),
  ]);

  expect(evaluation.findings).toEqual([]);
  expect(evaluation.status).toBe("incomplete");
});

test("evidence content is inert while active evidence uses are findings", () => {
  const evaluation = evaluateZeroLegacyContract([
    entry("import", "plans/full-refactor/ARCHITECTURE.md", "mm-bot"),
    entry("import", "apps/bot/src/main.ts", "plans/full-refactor/ARCHITECTURE.md"),
    entry("export", "apps/bot/src/main.ts", "data/reports/2026/report.html"),
    entry("runtime-reference", "apps/bot/src/main.ts", "data/reports/2026/report.html"),
    entry("config-reference", "package.json", "AGENTS.md"),
    entry("route", "apps/bot/src/main.ts", ".codex/ENGINEERING-STANDARDS.md"),
    entry("served-asset", "apps/bot/src/main.ts", "plans/full-refactor/image.svg"),
  ]);

  expect(evaluation.findings.map((finding) => finding.category)).toEqual([
    "evidence-path-configured",
    "evidence-path-executed",
    "evidence-path-imported",
    "evidence-path-imported",
    "evidence-path-routed",
    "evidence-path-served",
  ]);
});

test("evidence-only command paths are executed while evidence source contents stay inert", () => {
  const evaluation = evaluateZeroLegacyContract([
    entry("command", "package.json", "plans/full-refactor/tool.ts"),
    entry("config-reference", "package.json", "plans/full-refactor/tool.ts"),
    entry("command", "plans/full-refactor/evidence/record.md", "run-bot"),
  ]);

  expect(evaluation.findings.map((finding) => finding.category)).toEqual([
    "evidence-path-configured",
    "evidence-path-executed",
  ]);
  expect(evaluation.status).toBe("fail");
});

test("unparseable sources fail closed with a frozen diagnostic-only finding", () => {
  const evaluation = evaluateZeroLegacyContract([
    entry("unparseable-source", "apps/bot/src/main.ts", "parser-detail-unexpected-token"),
  ]);

  expect(evaluation.status).toBe("fail");
  expect(evaluation.findings).toHaveLength(1);
  expect(
    evaluation.findings.map((finding) => ({
      finding,
      frozen: Object.isFrozen(finding),
      keys: Object.keys(finding),
      hasCause: "cause" in finding,
      hasPayload: "payload" in finding,
    })),
  ).toEqual([
    {
      finding: {
        category: "unparseable-source",
        path: "apps/bot/src/main.ts",
        location: "apps/bot/src/main.ts:1",
      },
      frozen: true,
      keys: ["category", "path", "location"],
      hasCause: false,
      hasPayload: false,
    },
  ]);
});

test("unparseable evidence-only sources stay inert", () => {
  const evaluation = evaluateZeroLegacyContract([
    entry("unparseable-source", "plans/full-refactor/evidence/record.md", "apps/bot/src/main.ts"),
  ]);

  expect(evaluation.findings).toEqual([]);
  expect(evaluation.status).toBe("incomplete");
});

test("unsafe paths take precedence over unparseable source diagnostics", () => {
  const evaluation = evaluateZeroLegacyContract([
    entry("unparseable-source", "apps/bot/src/main.ts", "../outside.ts"),
  ]);

  expect(evaluation.findings).toEqual([
    {
      category: "unsafe-path",
      path: "apps/bot/src/main.ts",
      location: "apps/bot/src/main.ts:1",
      target: "../outside.ts",
    },
  ]);
});

test("unparseable, unreadable, and unsafe findings retain deterministic ordering", () => {
  const evaluation = evaluateZeroLegacyContract([
    entry("unreadable-target", "apps/z.ts", "packages/missing"),
    entry("unparseable-source", "apps/a.ts"),
    entry("unparseable-source", "../outside.ts"),
  ]);

  expect(evaluation.findings.map((finding) => `${finding.category}:${finding.path}`)).toEqual([
    "unparseable-source:apps/a.ts",
    "unreadable-target:apps/z.ts",
    "unsafe-path:../outside.ts",
  ]);
});

test("semantic signal categories require an exact legacy target", () => {
  const evaluation = evaluateZeroLegacyContract([
    entry("import", "apps/a.ts", "mm-bot"),
    entry("export", "apps/a.ts", "run-bot"),
    entry("route", "apps/a.ts", "search-best-config"),
    entry("command", "package.json", "mm-bot:built"),
    entry("runtime-reference", "apps/a.ts", "headless"),
    entry("config-reference", "package.json", "bot:*"),
    entry("current-doc-reference", "docs/current.md", "phase-27-ready"),
    entry("served-asset", "apps/a.ts", "bin"),
    entry("compatibility-shim", "apps/a.ts", "postinstall"),
    entry("unreadable-target", "apps/a.ts", "packages/missing"),
  ]);

  expect(evaluation.findings.map((finding) => finding.category)).toEqual([
    "legacy-command",
    "legacy-compatibility-shim",
    "legacy-config-reference",
    "legacy-current-doc-reference",
    "legacy-export",
    "legacy-import",
    "legacy-route",
    "legacy-runtime-reference",
    "legacy-served-asset",
    "unreadable-target",
  ]);
});

test("harmless words are not global legacy findings", () => {
  const evaluation = evaluateZeroLegacyContract([
    entry("current-doc-reference", "docs/current.md", "legacy migration notes"),
    entry("current-doc-reference", "docs/current.md", "phase approach"),
    entry("current-doc-reference", "docs/current.md", "compatibility discussion"),
  ]);

  expect(evaluation.findings).toEqual([]);
  expect(evaluation.status).toBe("incomplete");
});

test("unsafe paths fail closed and findings use a stable order", () => {
  const evaluation = evaluateZeroLegacyContract([
    entry("import", "apps/z.ts", "mm-bot"),
    entry("import", "apps/a.ts", "mm-bot"),
    entry("legacy-file", "../docs/legacy/old.md"),
    entry("runtime-reference", "apps/a.ts", "/run-bot"),
  ]);

  expect(evaluation.findings.map((finding) => `${finding.category}:${finding.path}`)).toEqual([
    "legacy-import:apps/a.ts",
    "legacy-import:apps/z.ts",
    "unsafe-path:../docs/legacy/old.md",
    "unsafe-path:apps/a.ts",
  ]);
});

test("NUL paths fail closed for both entry and target", () => {
  const evaluation = evaluateZeroLegacyContract([
    entry("import", "apps/unsafe\0.ts", "mm-bot"),
    entry("import", "apps/a.ts", "run-bot\0"),
  ]);

  expect(evaluation.findings.map((finding) => finding.category)).toEqual(["unsafe-path", "unsafe-path"]);
  expect(evaluation.status).toBe("fail");
});

test("phase-style labels include separators and retain a word boundary", () => {
  const evaluation = evaluateZeroLegacyContract([
    entry("current-doc-reference", "docs/current.md", "phase_3"),
    entry("current-doc-reference", "docs/current.md", "prephase-27"),
  ]);

  expect(evaluation.findings.map((finding) => finding.category)).toEqual(["legacy-current-doc-reference"]);
});

test("configuration, entries, and results are immutable without a clean pass", () => {
  const entries = [entry("import", "apps/a.ts", "mm-bot")];
  const evaluation = evaluateZeroLegacyContract(entries);

  expect(Object.isFrozen(zeroLegacyScannerConfig)).toBeTrue();
  expect(Object.isFrozen(zeroLegacyScannerConfig.declaredInventoryRoots)).toBeTrue();
  expect(zeroLegacyScannerConfig.excludedDirectoryNames).toEqual([
    "node_modules",
    "dist",
    "build",
    "coverage",
    ".turbo",
  ]);
  expect(zeroLegacyScannerConfig.excludedPathPrefixes).toEqual(["search-best-config/results/"]);
  expect(Object.isFrozen(zeroLegacyScannerConfig.excludedDirectoryNames)).toBeTrue();
  expect(Object.isFrozen(zeroLegacyScannerConfig.excludedPathPrefixes)).toBeTrue();
  expect(Object.isFrozen(entries)).toBeFalse();
  expect(Object.isFrozen(evaluation)).toBeTrue();
  expect(Object.isFrozen(evaluation.findings)).toBeTrue();
  expect(Object.isFrozen(evaluation.findings[0])).toBeTrue();
  expect(entries).toEqual([entry("import", "apps/a.ts", "mm-bot")]);
  expect(evaluation.status).toBe("fail");
  expect(evaluateZeroLegacyContract([]).status).toBe("incomplete");
  expect(evaluateZeroLegacyContract([]).catalogCompleteness).toBe("incomplete");
});
