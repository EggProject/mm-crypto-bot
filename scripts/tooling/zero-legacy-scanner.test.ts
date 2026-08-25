import { expect, test } from "bun:test";
import path from "node:path";

import type { ZeroLegacyScannerConfig } from "./zero-legacy-config.ts";
import {
  runZeroLegacyScannerCli,
  scanRepoForLegacyReferences as scanZeroLegacyRepo,
  type ZeroLegacyPathMetadata,
  type ZeroLegacyPathKind,
  type ZeroLegacyScannerPort,
} from "./zero-legacy-scanner.ts";

interface FixtureNode {
  readonly children?: readonly string[];
  readonly content?: string;
  readonly kind: ZeroLegacyPathKind;
}

interface FixtureOptions {
  readonly canonicalFailurePaths?: readonly string[];
  readonly canonicalPaths?: ReadonlyMap<string, string>;
  readonly gitTopLevel?: string;
  readonly inspectFailurePaths?: readonly string[];
  readonly inspectOverride?: (absolutePath: string) => ZeroLegacyPathMetadata | undefined;
  readonly readDirectoryFailurePaths?: readonly string[];
  readonly readFailurePaths?: readonly string[];
}

const repoRoot = "/fixture/repository";

const scannerConfig: ZeroLegacyScannerConfig = Object.freeze({
  schemaVersion: "zero-legacy-scanner@1",
  catalogCompleteness: "incomplete",
  incompleteReasons: Object.freeze(["catalog is intentionally incomplete"]),
  declaredInventoryRoots: Object.freeze(["apps", "docs", "package.json", "site.html", "tool.toml", "plans"]),
  excludedDirectoryNames: Object.freeze(["node_modules", "dist", "build", "coverage", ".turbo"]),
  excludedPathPrefixes: Object.freeze(["search-best-config/results/"]),
  evidenceOnlyPrefixes: Object.freeze(["plans/full-refactor/", "data/reports/"]),
  evidenceOnlyPaths: Object.freeze(["AGENTS.md", ".codex/ENGINEERING-STANDARDS.md"]),
  terminalAbsentPaths: Object.freeze(["docs/legacy", "bin", "run-bot", "search-best-config"]),
  knownLegacyPaths: Object.freeze(["scripts/install-mm-bot.sh", "bin/mm-bot"]),
  knownLegacyIdentifiers: Object.freeze([
    "mm-bot",
    "run-bot",
    "search-best-config",
    "mm-bot:built",
    "start",
    "headless",
    "bot:*",
    "bin",
    "postinstall",
  ]),
});

function fixturePath(relativePath: string): string {
  return path.join(repoRoot, relativePath);
}

function createPort(
  nodes: ReadonlyMap<string, FixtureNode>,
  options: FixtureOptions = {},
): {
  readonly port: ZeroLegacyScannerPort;
  readonly stderr: string[];
  readonly stdout: string[];
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const canonicalFailures = new Set(options.canonicalFailurePaths);
  const inspectFailures = new Set(options.inspectFailurePaths);
  const readdirFailures = new Set(options.readDirectoryFailurePaths);
  const readFailures = new Set(options.readFailurePaths);
  const unsealedPort: ZeroLegacyScannerPort = {
    canonicalize: (absolutePath) => {
      if (canonicalFailures.has(absolutePath)) {
        return Promise.reject(new Error("canonicalization failure"));
      }
      return Promise.resolve(options.canonicalPaths?.get(absolutePath) ?? absolutePath);
    },
    getGitTopLevel: () => Promise.resolve(options.gitTopLevel ?? repoRoot),
    inspectPath: (_repoRoot, absolutePath) => {
      if (inspectFailures.has(absolutePath)) {
        return Promise.reject(new Error("secure inspection failure"));
      }
      if (options.inspectOverride !== undefined) {
        return Promise.resolve(options.inspectOverride(absolutePath));
      }
      const node = nodes.get(absolutePath);
      return Promise.resolve(node === undefined ? undefined : Object.freeze({ kind: node.kind }));
    },
    readDirectory: (_repoRoot, absolutePath) => {
      if (readdirFailures.has(absolutePath)) {
        return Promise.reject(new Error("directory failure"));
      }
      const node = nodes.get(absolutePath);
      if (node?.kind !== "directory") {
        return Promise.reject(new Error("not a directory"));
      }
      return Promise.resolve(Object.freeze(node.children === undefined ? [] : [...node.children]));
    },
    readUtf8: (_repoRoot, absolutePath) => {
      if (readFailures.has(absolutePath)) {
        return Promise.reject(new Error("read failure"));
      }
      const node = nodes.get(absolutePath);
      if (node?.kind !== "file" || node.content === undefined) {
        return Promise.reject(new Error("not a readable file"));
      }
      return Promise.resolve(node.content);
    },
    writeStderr: (message) => {
      stderr.push(message);
    },
    writeStdout: (message) => {
      stdout.push(message);
    },
  };
  const port: ZeroLegacyScannerPort = Object.freeze(unsealedPort);
  return Object.freeze({ port, stderr, stdout });
}

function regularFile(content: string): FixtureNode {
  return Object.freeze({ content, kind: "file" });
}

function directory(...children: string[]): FixtureNode {
  return Object.freeze({ children: Object.freeze(children), kind: "directory" });
}

function rootNodes(...nodes: readonly [string, FixtureNode][]): ReadonlyMap<string, FixtureNode> {
  const names = nodes.map(([name]) => name);
  const root = names.length === 0 ? directory() : directory(...names);
  const entries: [string, FixtureNode][] = [[repoRoot, root]];
  for (const [name, node] of nodes) {
    entries.push([fixturePath(name), node]);
  }
  return new Map(entries);
}

test("scanner requires an absolute Git-top-level repository root", async () => {
  const fixture = createPort(rootNodes());
  const relativeResult = await scanZeroLegacyRepo("relative", fixture.port, scannerConfig);
  expect(relativeResult.findings[0]?.category).toBe("unreadable-target");

  const mismatch = createPort(rootNodes(), { gitTopLevel: "/fixture/other" });
  const mismatchResult = await scanZeroLegacyRepo(repoRoot, mismatch.port, scannerConfig);
  expect(mismatchResult.findings[0]?.location).toBe("repository-root:verification");
});

test("scanner sorts traversal and integrates TypeScript, JSON, TOML, Markdown, and HTML extraction", async () => {
  const nodes = rootNodes(
    ["apps", directory("z.ts", "a.ts")],
    ["apps/a.ts", regularFile("import tool from 'mm-bot';")],
    ["apps/z.ts", regularFile("await import('plans/full-refactor/ARCHITECTURE.md');")],
    ["docs", directory("current.md")],
    ["docs/current.md", regularFile("[old](docs/legacy/old.md)")],
    ["package.json", regularFile('{"scripts":{"check":"mm-bot:built"}}')],
    ["site.html", regularFile('<a href="search-best-config">x</a>')],
    ["tool.toml", regularFile('command = "run-bot"')],
    ["plans", directory("full-refactor")],
    ["plans/full-refactor", directory("ARCHITECTURE.md")],
    ["plans/full-refactor/ARCHITECTURE.md", regularFile("[ignored](mm-bot)")],
  );
  const result = await scanZeroLegacyRepo(repoRoot, createPort(nodes).port, scannerConfig);

  expect(result.findings.map((finding) => `${finding.category}:${finding.path}`)).toEqual([
    "evidence-path-executed:apps/z.ts",
    "legacy-command:package.json",
    "legacy-command:tool.toml",
    "legacy-current-doc-reference:docs/current.md",
    "legacy-import:apps/a.ts",
    "legacy-served-asset:site.html",
  ]);
  expect(result.status).toBe("fail");
});

test("missing declared roots are harmless while present terminal files and directories fail", async () => {
  const nodes = rootNodes(
    ["docs", directory("legacy")],
    ["docs/legacy", directory("old.md")],
    ["docs/legacy/old.md", regularFile("old")],
    ["run-bot", regularFile("obsolete")],
  );
  const result = await scanZeroLegacyRepo(repoRoot, createPort(nodes).port, scannerConfig);

  expect(result.findings.map((finding) => `${finding.category}:${finding.path}`)).toEqual([
    "legacy-directory:docs/legacy",
    "legacy-file:docs/legacy/old.md",
    "legacy-file:run-bot",
  ]);
});

test("evidence content is inert but active imports of evidence remain findings", async () => {
  const nodes = rootNodes(
    ["apps", directory("main.ts")],
    ["apps/main.ts", regularFile("import plan from 'plans/full-refactor/ARCHITECTURE.md';")],
    ["plans", directory("full-refactor")],
    ["plans/full-refactor", directory("ARCHITECTURE.md")],
    ["plans/full-refactor/ARCHITECTURE.md", regularFile("import old from 'mm-bot';")],
  );
  const result = await scanZeroLegacyRepo(repoRoot, createPort(nodes).port, scannerConfig);

  expect(result.findings.map((finding) => finding.category)).toEqual(["evidence-path-imported"]);
});

test("excluded dependency, build, and configured result paths are skipped before inspection", async () => {
  const exclusionOnlyConfig: ZeroLegacyScannerConfig = Object.freeze({
    ...scannerConfig,
    declaredInventoryRoots: Object.freeze(["apps", "packages", "search-best-config"]),
    terminalAbsentPaths: Object.freeze([]),
  });
  const nodes = rootNodes(
    ["apps", directory("node_modules")],
    ["apps/node_modules", directory("old.ts")],
    ["apps/node_modules/old.ts", regularFile("import old from 'mm-bot';")],
    ["packages", directory("x")],
    ["packages/x", directory("dist")],
    ["packages/x/dist", directory("old.ts")],
    ["packages/x/dist/old.ts", regularFile("import old from 'mm-bot';")],
    ["search-best-config", directory("results")],
    ["search-best-config/results", directory("old.ts")],
    ["search-best-config/results/old.ts", regularFile("import old from 'mm-bot';")],
  );
  const result = await scanZeroLegacyRepo(repoRoot, createPort(nodes).port, exclusionOnlyConfig);

  expect(result.findings).toEqual([]);
  expect(result.status).toBe("incomplete");
});

test("symlinks, special files, secure inspection, read failures, and readdir failures fail closed", async () => {
  const failureCases: readonly [string, ReadonlyMap<string, FixtureNode>, FixtureOptions][] = [
    ["symlink", rootNodes(["apps", Object.freeze({ kind: "symlink" })]), {}],
    ["special", rootNodes(["apps", Object.freeze({ kind: "other" })]), {}],
    [
      "read",
      rootNodes(["apps", directory("a.ts")], ["apps/a.ts", regularFile("import a from 'mm-bot';")]),
      { readFailurePaths: [fixturePath("apps/a.ts")] },
    ],
    [
      "readdir",
      rootNodes(["apps", directory("a.ts")], ["apps/a.ts", regularFile("ok")]),
      { readDirectoryFailurePaths: [fixturePath("apps")] },
    ],
    [
      "secure inspection",
      rootNodes(["apps", directory("a.ts")], ["apps/a.ts", regularFile("ok")]),
      { inspectFailurePaths: [fixturePath("apps")] },
    ],
  ];
  for (const [_label, nodes, options] of failureCases) {
    const result = await scanZeroLegacyRepo(repoRoot, createPort(nodes, options).port, scannerConfig);
    expect(result.findings.some((finding) => finding.category === "unreadable-target")).toBeTrue();
  }
});

test("scanner distinguishes read and parse failures without exposing parser details", async () => {
  const readNodes = rootNodes(
    ["apps", directory("main.ts")],
    ["apps/main.ts", regularFile("import legacy from 'mm-bot';")],
  );
  const readResult = await scanZeroLegacyRepo(
    repoRoot,
    createPort(readNodes, { readFailurePaths: [fixturePath("apps/main.ts")] }).port,
    scannerConfig,
  );
  expect(readResult.findings).toContainEqual({
    category: "unreadable-target",
    path: "package.json",
    location: "apps/main.ts:read",
  });

  const parseNodes = rootNodes(
    ["apps", directory("broken.json", "dynamic.ts")],
    ["apps/broken.json", regularFile("{")],
    ["apps/dynamic.ts", regularFile("const command = 'mm-bot'; Bun.spawn(command);")],
  );
  const parseResult = await scanZeroLegacyRepo(repoRoot, createPort(parseNodes).port, scannerConfig);
  expect(parseResult.findings).toEqual([
    { category: "unparseable-source", path: "package.json", location: "apps/broken.json:parse" },
    { category: "unparseable-source", path: "package.json", location: "apps/dynamic.ts:parse" },
  ]);
  expect(parseResult.findings.every((finding) => finding.target === undefined)).toBeTrue();
  expect(parseResult.status).toBe("fail");
});

test("unsafe inventory and child paths plus a non-directory ancestor fail closed", async () => {
  const unsafeInventoryConfig: ZeroLegacyScannerConfig = Object.freeze({
    ...scannerConfig,
    declaredInventoryRoots: Object.freeze(["../outside"]),
    terminalAbsentPaths: Object.freeze([]),
  });
  const unsafeInventory = await scanZeroLegacyRepo(
    repoRoot,
    createPort(rootNodes()).port,
    unsafeInventoryConfig,
  );
  expect(unsafeInventory.findings[0]?.category).toBe("unreadable-target");

  const unsafeChildNodes = rootNodes(["apps", directory("../child")]);
  const unsafeChildConfig: ZeroLegacyScannerConfig = Object.freeze({
    ...scannerConfig,
    declaredInventoryRoots: Object.freeze(["apps"]),
    terminalAbsentPaths: Object.freeze([]),
  });
  const unsafeChild = await scanZeroLegacyRepo(
    repoRoot,
    createPort(unsafeChildNodes).port,
    unsafeChildConfig,
  );
  expect(unsafeChild.findings[0]?.category).toBe("unreadable-target");

  const nodes = rootNodes(["apps", directory("child")], ["apps/child", regularFile("ok")]);
  const replacedAncestor = await scanZeroLegacyRepo(
    repoRoot,
    createPort(nodes, {
      inspectFailurePaths: [fixturePath("apps/child")],
    }).port,
    Object.freeze({
      ...scannerConfig,
      declaredInventoryRoots: Object.freeze(["apps"]),
      terminalAbsentPaths: Object.freeze([]),
    }),
  );
  expect(replacedAncestor.findings[0]?.category).toBe("unreadable-target");

  const topFileConfig: ZeroLegacyScannerConfig = Object.freeze({
    ...scannerConfig,
    declaredInventoryRoots: Object.freeze(["tool.ts"]),
    terminalAbsentPaths: Object.freeze([]),
  });
  const topFileNodes = rootNodes(["tool.ts", regularFile("import tool from 'mm-bot';")]);
  const topFile = await scanZeroLegacyRepo(repoRoot, createPort(topFileNodes).port, topFileConfig);
  expect(topFile.findings.map((finding) => finding.category)).toEqual(["legacy-import"]);
});

test("result DTO is deterministic and deeply frozen", async () => {
  const nodes = rootNodes(
    ["apps", directory("b.ts", "a.ts")],
    ["apps/a.ts", regularFile("import x from 'mm-bot';")],
    ["apps/b.ts", regularFile("import x from 'run-bot';")],
  );
  const fixture = createPort(nodes);
  const first = await scanZeroLegacyRepo(repoRoot, fixture.port, scannerConfig);
  const second = await scanZeroLegacyRepo(repoRoot, fixture.port, scannerConfig);

  expect(first).toEqual(second);
  expect(Object.isFrozen(first)).toBeTrue();
  expect(Object.isFrozen(first.findings)).toBeTrue();
  expect(Object.isFrozen(first.findings[0])).toBeTrue();
  expect(Object.isFrozen(first.incompleteReasons)).toBeTrue();
  expect(first.schemaVersion).toBe("zero-legacy-scan-result@1");
});

test("parse-only scanner CLI failure uses the stable fail-closed exit and stderr", async () => {
  const fixture = createPort(
    rootNodes(["apps", directory("main.ts")], ["apps/main.ts", regularFile("Bun.spawn(command);")]),
  );
  const result = await runZeroLegacyScannerCli(["--repository-root", repoRoot], fixture.port);

  expect(result.result.findings).toEqual([
    { category: "unparseable-source", path: "package.json", location: "apps/main.ts:parse" },
  ]);
  expect(result.exitCode).toBe(2);
  expect(fixture.stderr).toEqual(["zero-legacy scanner could not safely complete\n"]);
  expect(fixture.stdout).toHaveLength(1);
});

test("CLI emits exactly one DTO and never returns zero", async () => {
  const fixture = createPort(rootNodes());
  const incomplete = await runZeroLegacyScannerCli(["--repository-root", repoRoot], fixture.port);
  expect(incomplete.exitCode).toBe(2);
  expect(fixture.stdout).toHaveLength(1);
  expect(JSON.parse(fixture.stdout[0] ?? "")).toEqual(incomplete.result);
  expect(fixture.stderr).toEqual([]);

  const invalid = await runZeroLegacyScannerCli(["--repository-root"], createPort(rootNodes()).port);
  expect(invalid.exitCode).toBe(2);

  const failureFixture = createPort(
    rootNodes(["apps", directory("a.ts")], ["apps/a.ts", regularFile("import x from 'mm-bot';")]),
  );
  const failure = await scanZeroLegacyRepo(repoRoot, failureFixture.port, scannerConfig);
  expect(failure.status).toBe("fail");
  expect(failure.findings.some((finding) => finding.category === "unreadable-target")).toBeFalse();
  expect("writeFile" in failureFixture.port).toBeFalse();
});
