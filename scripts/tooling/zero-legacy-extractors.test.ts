import { expect, test } from "bun:test";

import { evaluateZeroLegacyContract } from "./zero-legacy-contract.ts";
import { ZeroLegacyExtractorError, extractZeroLegacySemanticEntries } from "./zero-legacy-extractors.ts";
import { appendZeroLegacySyntaxEntries } from "./zero-legacy-syntax-targets.ts";

function targets(path: string, sourceText: string): readonly string[] {
  return extractZeroLegacySemanticEntries(path, sourceText).map(
    (entry) => `${entry.signal}:${entry.target ?? ""}`,
  );
}

test("syntax target appending preserves command and configured-path signals", () => {
  const appended: { signal: string; target: string }[] = [];
  appendZeroLegacySyntaxEntries(
    "evidence",
    (message): never => {
      throw new Error(message);
    },
    () => [
      { signal: "command", start: 0, target: "plans/full-refactor/tool.ts" },
      { signal: "config-reference", start: 4, target: "plans/full-refactor/config.yml" },
    ],
    (signal, target) => {
      appended.push({ signal, target: target.target });
    },
  );
  expect(appended).toEqual([
    { signal: "command", target: "plans/full-refactor/tool.ts" },
    { signal: "config-reference", target: "plans/full-refactor/config.yml" },
  ]);
});

test("TypeScript ignores comments and plain strings while extracting semantic references", () => {
  const sourceText = [
    "// import 'run-bot'",
    "const prose = 'run-bot';",
    "import tool from './run-bot';",
    "export { tool } from 'mm-bot';",
    "await import('search-best-config');",
    "require('headless');",
    "Bun.spawn(['bun', 'run', 'bin']);",
    "Bun.spawnSync({ cmd: ['bun', 'run', 'postinstall'] });",
  ].join("\n");
  const entries = extractZeroLegacySemanticEntries("apps/bot/src/main.ts", sourceText);

  expect(entries.map((entry) => `${entry.signal}:${entry.target ?? ""}`)).toEqual([
    "export:mm-bot",
    "compatibility-shim:mm-bot",
    "runtime-reference:search-best-config",
    "runtime-reference:headless",
    "runtime-reference:bin",
    "runtime-reference:postinstall",
  ]);
  expect(entries.map((entry) => entry.location)).toEqual([
    "apps/bot/src/main.ts:4",
    "apps/bot/src/main.ts:4",
    "apps/bot/src/main.ts:5",
    "apps/bot/src/main.ts:6",
    "apps/bot/src/main.ts:7",
    "apps/bot/src/main.ts:8",
  ]);
});

test("manifest semantics cover scripts, commands, routes, and configuration", () => {
  const sourceText = JSON.stringify(
    {
      scripts: { start: "safe", check: "mm-bot:built" },
      bin: "safe",
      postinstall: "safe",
      route: "search-best-config",
      nested: { evidence: "plans/full-refactor/ARCHITECTURE.md", ignored: "legacy prose" },
    },
    undefined,
    2,
  );

  expect(targets("package.json", sourceText)).toEqual([
    "command:start",
    "command:mm-bot:built",
    "command:bin",
    "command:postinstall",
    "route:search-best-config",
    "config-reference:plans/full-refactor/ARCHITECTURE.md",
  ]);
});

test("configuration values retain semantic signals through escaped and nested data", () => {
  const sourceText = [
    '{"scripts":{"start":"run-bot","check":"mm-bot:built"},',
    '"commands":["bin"],"postinstall":"headless",',
    String.raw`"nested":{"reference":"plans/full-refactor/\u0041RCHITECTURE.md"}}`,
  ].join("\n");
  expect(targets("package.json", sourceText)).toEqual([
    "command:start",
    "command:run-bot",
    "command:mm-bot:built",
    "command:bin",
    "command:postinstall",
    "command:headless",
    "config-reference:plans/full-refactor/ARCHITECTURE.md",
  ]);
});

test("TOML parses strictly and preserves semantic keys", () => {
  const sourceText = [
    'command = "run-bot"',
    'routes = ["bin"]',
    "[nested]",
    'reference = "data/reports/2026/report.html"',
  ].join("\n");
  expect(targets("tooling.toml", sourceText)).toEqual([
    "command:run-bot",
    "route:bin",
    "config-reference:data/reports/2026/report.html",
  ]);
});

test("TOML keeps unquoted non-string values inert and visits nested tables", () => {
  const sourceText = [
    "enabled = true",
    "attempts = 3",
    "[nested]",
    'route = "run-bot"',
    "[nested.deep]",
    'asset = "bin/mm-bot"',
  ].join("\n");
  expect(targets("tooling.toml", sourceText)).toEqual(["route:run-bot", "config-reference:bin/mm-bot"]);
});

test("Markdown and HTML examine destinations and attributes, not prose", () => {
  expect(targets("docs/current.md", "legacy run-bot\n[old](docs/legacy/old.md)\n![old](bin/mm-bot)")).toEqual(
    ["current-doc-reference:docs/legacy/old.md", "served-asset:bin/mm-bot"],
  );
  expect(targets("site.html", "run-bot <a href=\"search-best-config\">x</a><img src='bin/mm-bot'>")).toEqual([
    "served-asset:search-best-config",
    "served-asset:bin/mm-bot",
  ]);
  expect(targets("docs/current.mdx", "[angle](<run-bot>) ![plain](bin/mm-bot)")).toEqual([
    "current-doc-reference:run-bot",
    "served-asset:bin/mm-bot",
  ]);
  expect(targets("site.htm", "<a href='run-bot'>x</a><img src=\"bin/mm-bot\">")).toEqual([
    "served-asset:run-bot",
    "served-asset:bin/mm-bot",
  ]);
});

test("malformed configuration is typed, unknown formats are inert, and unsafe targets fail closed", () => {
  expect(() => extractZeroLegacySemanticEntries("package.json", "{")).toThrow(ZeroLegacyExtractorError);
  expect(() => extractZeroLegacySemanticEntries("tool.toml", "key = [")).toThrow(ZeroLegacyExtractorError);
  expect(extractZeroLegacySemanticEntries("notes.txt", "run-bot")).toEqual([]);
  expect(targets("apps/a.ts", "import x from '../run-bot'\nimport y from './run-bot'")).toEqual([
    "import:run-bot",
  ]);
});

test("module targets resolve relative paths and ignore opaque packages", () => {
  const sourceText = [
    "import safe from '../run-bot';",
    "import unsafe from '../../../run-bot';",
    "import standard from 'typescript';",
    "import scoped from '@scope/package';",
    "import builtIn from 'node:path';",
    "import alias from '#internal';",
    "import legacy from 'mm-bot';",
  ].join("\n");
  expect(targets("apps/a.ts", sourceText)).toEqual([
    "import:run-bot",
    "import:../../run-bot",
    "import:mm-bot",
  ]);
});

test("configuration retains exact commands and relative configured paths, not shell grammar", () => {
  const manifest = JSON.stringify({
    scripts: { start: "bun ../../scripts/install-mm-bot.sh", check: "mm-bot" },
    nested: { evidence: "./plans/full-refactor/ARCHITECTURE.md", legacy: "./run-bot" },
  });
  expect(targets("package.json", manifest)).toEqual([
    "command:start",
    "command:../../scripts/install-mm-bot.sh",
    "command:mm-bot",
    "config-reference:plans/full-refactor/ARCHITECTURE.md",
    "config-reference:run-bot",
  ]);
  expect(
    targets("config/tooling.toml", '[nested]\nevidence = "../plans/full-refactor/ARCHITECTURE.md"'),
  ).toEqual(["config-reference:plans/full-refactor/ARCHITECTURE.md"]);
});

test("static command values tokenize legacy command words and paths while prose stays inert", () => {
  const json = JSON.stringify({
    scripts: { start: "bun run run-bot", config: "bun start --config run-bot/config/default.toml" },
    description: "The legacy run-bot is historical prose.",
  });
  expect(targets("package.json", json)).toEqual([
    "command:start",
    "command:run-bot",
    "command:start",
    "command:run-bot/config/default.toml",
  ]);
  expect(
    targets(
      "tooling.toml",
      ['command = "bun run run-bot"', 'description = "legacy run-bot prose"'].join("\n"),
    ),
  ).toEqual(["command:run-bot"]);
  expect(
    targets(
      "package.json",
      JSON.stringify({ scripts: { config: "bun start --config=run-bot/default.toml" } }),
    ),
  ).toEqual(["command:start", "command:run-bot/default.toml"]);
  expect(() => targets("package.json", JSON.stringify({ scripts: { start: "bun run $COMMAND" } }))).toThrow(
    ZeroLegacyExtractorError,
  );
});

test("Bun spawn argv forms extract static commands and reject dynamic command forms", () => {
  const sourceText = [
    "Bun.spawn(['bun', 'run', 'run-bot']);",
    "Bun.spawnSync({ cmd: ['bun', 'run', 'scripts/install-mm-bot.sh'] });",
  ].join("\n");
  expect(targets("apps/bot/src/main.ts", sourceText)).toEqual([
    "runtime-reference:run-bot",
    "runtime-reference:scripts/install-mm-bot.sh",
  ]);
  expect(() => targets("apps/bot/src/main.ts", "Bun.spawn(command); ")).toThrow(ZeroLegacyExtractorError);
  expect(() => targets("apps/bot/src/main.ts", "Bun.spawn(['bun', command]); ")).toThrow(
    ZeroLegacyExtractorError,
  );
});

test("shell syntax extracts active command paths while comments and echo prose stay inert", () => {
  const shell = [
    "# bun run run-bot",
    "echo 'run-bot is historical prose'",
    'REPO_ROOT="/workspace"',
    'bun run apps/bot/src/index.ts start --config="$REPO_ROOT/run-bot/config/default.toml" >logs/start.log 2>&1 &',
  ].join("\n");
  expect(targets("scripts/dev.sh", shell)).toEqual(["command:start", "command:run-bot/config/default.toml"]);
  expect(() => targets("scripts/dev.sh", "bun run $COMMAND")).toThrow(ZeroLegacyExtractorError);
});

test("YAML syntax extracts active workflow values without treating prose as commands", () => {
  const workflow = [
    "name: run-bot historical prose",
    "jobs:",
    "  check:",
    "    steps:",
    "      - run: bun run run-bot",
    "      - uses: run-bot/action@v1",
    "      - config: run-bot/config/default.toml",
    "      - run:",
    "          - bun",
    "          - run",
    "          - scripts/install-mm-bot.sh",
  ].join("\n");
  expect(targets(".github/workflows/check.yml", workflow)).toEqual([
    "command:run-bot",
    "command:run-bot/action@v1",
    "config-reference:run-bot/config/default.toml",
    "command:scripts/install-mm-bot.sh",
  ]);
  expect(() =>
    targets(".github/workflows/check.yaml", "jobs:\n  check:\n    run: ${{ matrix.command }}"),
  ).toThrow(ZeroLegacyExtractorError);
  expect(() =>
    targets(".github/workflows/check.yaml", "jobs:\n  check:\n    run: |\n      bun run run-bot"),
  ).toThrow(ZeroLegacyExtractorError);
});

test("evidence-only execution reproductions preserve command and configured-path signals", () => {
  const packageEntries = extractZeroLegacySemanticEntries(
    "package.json",
    JSON.stringify({
      scripts: { evidence: "bun plans/full-refactor/tool.ts" },
      evidencePath: "plans/full-refactor/tool.ts",
    }),
  );
  const tomlEntries = extractZeroLegacySemanticEntries(
    "tooling.toml",
    'command = "bun plans/full-refactor/tool.ts"',
  );
  const shellEntries = extractZeroLegacySemanticEntries(
    "scripts/evidence.sh",
    "bun plans/full-refactor/tool.ts",
  );
  const yamlEntries = extractZeroLegacySemanticEntries(
    ".github/workflows/evidence.yml",
    [
      "run: bun plans/full-refactor/tool.ts",
      "uses: plans/full-refactor/action",
      "config: plans/full-refactor/config.yml",
      "path: plans/full-refactor/artifact.json",
    ].join("\n"),
  );

  expect(packageEntries.map((entry) => `${entry.signal}:${entry.target ?? ""}`)).toEqual([
    "command:plans/full-refactor/tool.ts",
    "config-reference:plans/full-refactor/tool.ts",
  ]);
  expect(tomlEntries.map((entry) => entry.signal)).toEqual(["command"]);
  expect(shellEntries.map((entry) => entry.signal)).toEqual(["command"]);
  expect(yamlEntries.map((entry) => entry.signal)).toEqual([
    "command",
    "command",
    "config-reference",
    "config-reference",
  ]);
  expect(
    evaluateZeroLegacyContract([
      ...packageEntries,
      ...tomlEntries,
      ...shellEntries,
      ...yamlEntries,
    ]).findings.map((finding) => finding.category),
  ).toEqual([
    "evidence-path-configured",
    "evidence-path-configured",
    "evidence-path-configured",
    "evidence-path-executed",
    "evidence-path-executed",
    "evidence-path-executed",
    "evidence-path-executed",
    "evidence-path-executed",
  ]);
  expect(
    extractZeroLegacySemanticEntries(
      "plans/full-refactor/evidence/source.md",
      "bun plans/full-refactor/tool.ts",
    ),
  ).toEqual([]);
  expect(evaluateZeroLegacyContract([]).status).toBe("incomplete");
});

test("document destinations canonicalize local paths and ignore external references", () => {
  const markdown = [
    "[relative](../plans/full-refactor/ARCHITECTURE.md?view=1#section)",
    "[root](/run-bot#start)",
    "[web](https://example.test/run-bot)",
    "[mail](mailto:a@example.test)",
    "[data](data:text/plain,run-bot)",
    "[host](//example.test/run-bot)",
    "[fragment](#run-bot)",
  ].join("\n");
  expect(targets("docs/guide.md", markdown)).toEqual([
    "current-doc-reference:plans/full-refactor/ARCHITECTURE.md",
    "current-doc-reference:run-bot",
  ]);
  expect(
    targets(
      "docs/site.html",
      '<img src="/bin/mm-bot?raw=1#x"><a href="../plans/full-refactor/ARCHITECTURE.md">x</a>',
    ),
  ).toEqual(["served-asset:bin/mm-bot", "served-asset:plans/full-refactor/ARCHITECTURE.md"]);
});

test("document normalization and unsafe encoded targets fail closed", () => {
  expect(targets("docs/site.md", "[normalized](/./run-bot) [empty](?)")).toEqual([
    "current-doc-reference:run-bot",
  ]);
  const unsafeEntries = [
    ...extractZeroLegacySemanticEntries("apps/a.ts", String.raw`import backslash from "run-bot\\compat";`),
    ...extractZeroLegacySemanticEntries("package.json", JSON.stringify({ nested: { target: "run-bot\0" } })),
  ];
  expect(unsafeEntries.map((entry) => entry.target)).toEqual([String.raw`run-bot\compat`, "run-bot\0"]);
  expect(evaluateZeroLegacyContract(unsafeEntries).findings.map((finding) => finding.category)).toEqual([
    "unsafe-path",
    "unsafe-path",
  ]);
});

test("entries and arrays are immutable", () => {
  const entries = extractZeroLegacySemanticEntries("apps/a.ts", "import x from 'mm-bot'");
  expect(Object.isFrozen(entries)).toBeTrue();
  expect(Object.isFrozen(entries[0])).toBeTrue();
});
