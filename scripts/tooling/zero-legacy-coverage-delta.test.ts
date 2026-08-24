import { expect, test } from "bun:test";
import path from "node:path";

import { zeroLegacyScannerConfig, type ZeroLegacyScannerConfig } from "./zero-legacy-config.ts";
import { evaluateZeroLegacyContract, type ZeroLegacySemanticEntry } from "./zero-legacy-contract.ts";
import { ZeroLegacyExtractorError, extractZeroLegacySemanticEntries } from "./zero-legacy-extractors.ts";
import {
  runZeroLegacyScannerCli,
  scanRepoForLegacyReferences as scanZeroLegacyRepo,
  type ZeroLegacyPathKind,
  type ZeroLegacyScannerPort,
} from "./zero-legacy-scanner.ts";

interface FixtureNode {
  readonly children?: readonly string[];
  readonly content?: string;
  readonly kind: ZeroLegacyPathKind;
}

const fixtureRoot = "/fixture/repository";

function entry(
  signal: ZeroLegacySemanticEntry["signal"],
  path_: string,
  location: string,
  target?: string,
): ZeroLegacySemanticEntry {
  return Object.freeze({ signal, path: path_, location, ...(target !== undefined && { target }) });
}

function directory(...children: readonly string[]): FixtureNode {
  return Object.freeze({ children: Object.freeze([...children]), kind: "directory" });
}

function file(content: string): FixtureNode {
  return Object.freeze({ content, kind: "file" });
}

function scannerConfig(
  roots: readonly string[],
  excludedPrefixes: readonly string[] = [],
): ZeroLegacyScannerConfig {
  return Object.freeze({
    ...zeroLegacyScannerConfig,
    declaredInventoryRoots: Object.freeze([...roots]),
    excludedPathPrefixes: Object.freeze([...excludedPrefixes]),
    terminalAbsentPaths: Object.freeze([]),
  });
}

function fixturePath(relativePath: string): string {
  return path.join(fixtureRoot, relativePath);
}

function createPort(nodes: ReadonlyMap<string, FixtureNode>): {
  readonly port: ZeroLegacyScannerPort;
  readonly stderr: string[];
  readonly stdout: string[];
} {
  const stderr: string[] = [];
  const stdout: string[] = [];
  return Object.freeze({
    port: Object.freeze({
      canonicalize: (absolutePath: string) => Promise.resolve(absolutePath),
      getGitTopLevel: () => Promise.resolve(fixtureRoot),
      inspectPath: (_repoRoot: string, absolutePath: string) => {
        const node = nodes.get(absolutePath);
        return Promise.resolve(node === undefined ? undefined : Object.freeze({ kind: node.kind }));
      },
      readDirectory: (_repoRoot: string, absolutePath: string) => {
        const node = nodes.get(absolutePath);
        return node?.kind === "directory"
          ? Promise.resolve(Object.freeze([...(node.children ?? [])]))
          : Promise.reject(new Error("not a directory"));
      },
      readUtf8: (_repoRoot: string, absolutePath: string) => {
        const node = nodes.get(absolutePath);
        return node?.kind === "file" && node.content !== undefined
          ? Promise.resolve(node.content)
          : Promise.reject(new Error("not a file"));
      },
      writeStderr: (message: string) => {
        stderr.push(message);
      },
      writeStdout: (message: string) => {
        stdout.push(message);
      },
    }),
    stderr,
    stdout,
  });
}

test("contract comparator resolves every stable tie-breaker in both directions", () => {
  const byPath = evaluateZeroLegacyContract([
    entry("import", "apps/z.ts", "same", "mm-bot"),
    entry("import", "apps/a.ts", "same", "mm-bot"),
  ]);
  expect(byPath.findings.map((finding) => finding.path)).toEqual(["apps/a.ts", "apps/z.ts"]);

  const byLocation = evaluateZeroLegacyContract([
    entry("import", "apps/a.ts", "apps/a.ts:z", "mm-bot"),
    entry("import", "apps/a.ts", "apps/a.ts:a", "mm-bot"),
  ]);
  expect(byLocation.findings.map((finding) => finding.location)).toEqual(["apps/a.ts:a", "apps/a.ts:z"]);

  const byTarget = evaluateZeroLegacyContract([
    entry("import", "mm-bot", "same", "run-bot"),
    entry("import", "mm-bot", "same"),
    entry("import", "mm-bot", "same", "mm-bot"),
  ]);
  expect(byTarget.findings.map((finding) => finding.target)).toEqual([undefined, "mm-bot", "run-bot"]);
});

test("extractor covers typed errors and every configured candidate category without global-word matching", () => {
  const withoutCause = new ZeroLegacyExtractorError("fixture", "failed");
  expect(withoutCause.message).toBe("fixture: failed");
  expect(withoutCause.cause).toBeUndefined();

  const sourceText = [
    "import unsafe from '../run-bot';",
    "import terminal from 'docs/legacy/old.md';",
    "import legacyFile from 'scripts/install-mm-bot.sh';",
    "import governing from 'AGENTS.md';",
    "import evidence from 'plans/full-refactor/ARCHITECTURE.md';",
    "import identifier from 'mm-bot';",
    "import phase from 'phase-7-ready';",
    "import safe from 'ordinary-module';",
    "export { safe };",
    "export { safe as safeAgain } from 'ordinary-module';",
    "export { legacy } from 'run-bot';",
    "require();",
    "require(identifier);",
    "launch('run-bot');",
    "Bun.other('run-bot');",
    "Bun.spawn(identifier);",
  ].join("\n");
  expect(() => extractZeroLegacySemanticEntries("APPS/MAIN.TS", sourceText)).toThrow(
    ZeroLegacyExtractorError,
  );
  const entries = extractZeroLegacySemanticEntries(
    "APPS/MAIN.TS",
    sourceText.replace("Bun.spawn(identifier);", ""),
  );
  expect(entries.map((item) => `${item.signal}:${item.target ?? ""}`)).toEqual([
    "import:run-bot",
    "import:docs/legacy/old.md",
    "import:scripts/install-mm-bot.sh",
    "import:AGENTS.md",
    "import:plans/full-refactor/ARCHITECTURE.md",
    "import:mm-bot",
    "import:phase-7-ready",
    "export:run-bot",
    "compatibility-shim:run-bot",
  ]);
  expect(() => extractZeroLegacySemanticEntries("apps/main.ts", "Bun.spawn();")).toThrow(
    ZeroLegacyExtractorError,
  );
});

test("extractor traverses JSON and TOML values and rejects top-level primitive documents", () => {
  expect(() => extractZeroLegacySemanticEntries("config.json", "[]")).toThrow(ZeroLegacyExtractorError);
  const jsonEntries = extractZeroLegacySemanticEntries(
    "config.json",
    '{"routes":["run-bot",3,null],"scripts":{"bot:*":["safe","mm-bot"]},"nested":false}',
  );
  expect(jsonEntries.map((item) => `${item.signal}:${item.target ?? ""}`)).toEqual([
    "route:run-bot",
    "command:bot:*",
    "command:mm-bot",
  ]);
  const tomlEntries = extractZeroLegacySemanticEntries(
    "config.toml",
    ['routes = ["run-bot", "ordinary"]', "[nested]", 'value = "phase-8"', "flag = true"].join("\n"),
  );
  expect(tomlEntries.map((item) => `${item.signal}:${item.target ?? ""}`)).toEqual([
    "route:run-bot",
    "config-reference:phase-8",
  ]);
});

test("extractor handles recognized extensions and only semantic document destinations", () => {
  expect(
    extractZeroLegacySemanticEntries(
      "current.MDX",
      "[legacy](<docs/legacy/old.md>) [missing]() prose run-bot",
    ),
  ).toEqual([expect.objectContaining({ signal: "current-doc-reference", target: "docs/legacy/old.md" })]);
  expect(extractZeroLegacySemanticEntries("site.HTM", '<a href="ordinary">x</a>')).toEqual([]);
  expect(extractZeroLegacySemanticEntries("site.HTML", '<a href="run-bot">x</a>')).toEqual([
    expect.objectContaining({ signal: "served-asset", target: "run-bot" }),
  ]);
  expect(extractZeroLegacySemanticEntries("unknown.extension", "run-bot")).toEqual([]);
});

test("scanner fails closed when secure root inspection reports replacement", async () => {
  const output: string[] = [];
  const port: ZeroLegacyScannerPort = Object.freeze({
    canonicalize: (absolutePath: string) => Promise.resolve(absolutePath),
    getGitTopLevel: () => Promise.resolve(fixtureRoot),
    inspectPath: (_repoRoot: string, absolutePath: string) => {
      if (absolutePath === fixtureRoot) {
        return Promise.reject(new Error("root identity replacement"));
      }
      return Promise.resolve(undefined);
    },
    readDirectory: () => Promise.resolve(Object.freeze([])),
    readUtf8: () => Promise.resolve(""),
    writeStderr: (message: string) => {
      output.push(message);
    },
    writeStdout: (message: string) => {
      output.push(message);
    },
  });
  const result = await scanZeroLegacyRepo(fixtureRoot, port, scannerConfig(["apps"]));
  expect(result.findings[0]?.category).toBe("unreadable-target");
  expect(output).toEqual([]);
});

test("scanner rejects a non-directory root before inventory traversal", async () => {
  const output: string[] = [];
  const port: ZeroLegacyScannerPort = Object.freeze({
    canonicalize: (absolutePath: string) => Promise.resolve(absolutePath),
    getGitTopLevel: () => Promise.resolve(fixtureRoot),
    inspectPath: () => Promise.resolve(Object.freeze({ kind: "file" })),
    readDirectory: () => Promise.resolve(Object.freeze([])),
    readUtf8: () => Promise.resolve(""),
    writeStderr: (message: string) => {
      output.push(message);
    },
    writeStdout: (message: string) => {
      output.push(message);
    },
  });
  const result = await scanZeroLegacyRepo(fixtureRoot, port, scannerConfig(["apps"]));
  expect(result.findings[0]?.location).toBe("repository-root:verification");
  expect(output).toEqual([]);
});

test("scanner excludes a prefix without a trailing slash and CLI safe failures exit one without stderr", async () => {
  const excludedNodes = new Map<string, FixtureNode>([
    [fixtureRoot, directory("apps")],
    [fixturePath("apps"), directory("cache")],
    [fixturePath("apps/cache"), directory("old.ts")],
    [fixturePath("apps/cache/old.ts"), file("import legacy from 'mm-bot';")],
  ]);
  const excludedResult = await scanZeroLegacyRepo(
    fixtureRoot,
    createPort(excludedNodes).port,
    scannerConfig(["apps"], ["apps/cache"]),
  );
  expect(excludedResult.findings).toEqual([]);

  const failingNodes = new Map<string, FixtureNode>([
    [fixtureRoot, directory("apps")],
    [fixturePath("apps"), directory("main.ts")],
    [fixturePath("apps/main.ts"), file("import legacy from 'mm-bot';")],
  ]);
  const fixture = createPort(failingNodes);
  const result = await runZeroLegacyScannerCli(["--repository-root", fixtureRoot], fixture.port);
  expect(result.exitCode).toBe(1);
  expect(fixture.stderr).toEqual([]);
  expect(fixture.stdout).toHaveLength(1);
});
