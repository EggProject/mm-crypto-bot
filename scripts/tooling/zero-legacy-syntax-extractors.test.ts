import { expect, test } from "bun:test";

import { extractStaticCommandTokens } from "./zero-legacy-command-parser.ts";
import {
  extractHtmlDocumentTargets,
  extractMarkdownDocumentTargets,
} from "./zero-legacy-document-extractors.ts";
import {
  extractShellSyntaxTargets,
  extractYamlSyntaxTargets,
  type ZeroLegacySyntaxExtractorOptions,
} from "./zero-legacy-shell-yaml-extractors.ts";

const syntaxOptions: ZeroLegacySyntaxExtractorOptions = Object.freeze({
  error: (message: string): never => {
    throw new Error(message);
  },
});

const commandOptions = Object.freeze({
  allowRepositoryRootVariable: true,
  error: syntaxOptions.error,
});

test("static command parsing recognizes assignments, redirections, pipelines, and inert echo payloads", () => {
  expect(
    extractStaticCommandTokens(
      "CONFIG=run-bot --config=docs/legacy echo hidden; printf hidden | bun run run-bot 2>> logs/out",
      10,
      commandOptions,
    ),
  ).toEqual([
    { start: 17, target: "run-bot" },
    { start: 34, target: "docs/legacy" },
    { start: 46, target: "echo" },
    { start: 59, target: "printf" },
    { start: 75, target: "bun" },
    { start: 79, target: "run" },
    { start: 83, target: "run-bot" },
    { start: 95, target: "logs/out" },
  ]);
  expect(extractStaticCommandTokens(" ".repeat(3), 0, commandOptions)).toEqual([]);
  expect(extractStaticCommandTokens("CONFIG= echo 'quoted' \"also quoted\"", 0, commandOptions)).toEqual([
    { start: 0, target: "CONFIG=" },
    { start: 8, target: "echo" },
    { start: 13, target: "quoted" },
    { start: 22, target: "also quoted" },
  ]);
  expect(extractStaticCommandTokens('echo "single \' remains literal"', 0, commandOptions)).toEqual([
    { start: 0, target: "echo" },
  ]);
  expect(extractStaticCommandTokens("$REPO_ROOT/run-bot", 0, commandOptions)).toEqual([
    { start: 0, target: "run-bot" },
  ]);
});

test("static command parsing fails closed for dynamic, escaped, and unterminated forms", () => {
  for (const command of ["run $VALUE", "run `date`", String.raw`run \value`, "run 'unfinished"]) {
    expect(() => extractStaticCommandTokens(command, 0, commandOptions)).toThrow(Error);
  }
  expect(() => extractStaticCommandTokens("run $REPO_ROOT/one$TWO", 0, commandOptions)).toThrow(Error);
});

test("document extractors preserve syntactic destinations and freeze their output", () => {
  const markdown = extractMarkdownDocumentTargets("[plain](run-bot 'title') ![asset](<bin/mm-bot>)");
  expect(markdown).toEqual([
    { signal: "current-doc-reference", start: 0, target: "run-bot" },
    { signal: "served-asset", start: 25, target: "bin/mm-bot" },
  ]);
  const html = extractHtmlDocumentTargets("<a href='run-bot'><img src=\"bin/mm-bot\">");
  expect(html).toEqual([
    { signal: "served-asset", start: 3, target: "run-bot" },
    { signal: "served-asset", start: 23, target: "bin/mm-bot" },
  ]);
  expect(Object.isFrozen(markdown)).toBeTrue();
  expect(Object.isFrozen(markdown[0])).toBeTrue();
  expect(Object.isFrozen(html)).toBeTrue();
});

test("shell syntax keeps control and supported dynamic fragments inert while rejecting unsafe dynamics", () => {
  const shell = [
    'if [ -n "$HOME" ]; then',
    '! [ -n "$HOME" ]',
    'echo "single \' remains literal"',
    "  echo $VALUE",
    "  cd $WORKSPACE",
    "  VALUE=$VALUE",
    "  $(<fixture)",
    "  do",
    "fi",
    "bun run run-bot # comment",
  ].join("\n");
  expect(extractShellSyntaxTargets(shell, syntaxOptions)).toEqual([
    { signal: "command", start: shell.indexOf('echo "single'), target: "echo" },
    { signal: "command", start: shell.lastIndexOf("bun"), target: "bun" },
    { signal: "command", start: shell.lastIndexOf("run-bot") - 4, target: "run" },
    { signal: "command", start: shell.lastIndexOf("run-bot"), target: "run-bot" },
  ]);
  expect(() => extractShellSyntaxTargets("bun run $VALUE", syntaxOptions)).toThrow(Error);
});

test("shell syntax inspects static tails after dynamic assignments and fails closed for ambiguous controls", () => {
  const assignmentPrefixed = "X=$DYNAMIC bun run run-bot";
  expect(extractShellSyntaxTargets(assignmentPrefixed, syntaxOptions)).toEqual([
    { signal: "command", start: assignmentPrefixed.indexOf("bun"), target: "bun" },
    { signal: "command", start: assignmentPrefixed.indexOf("run"), target: "run" },
    { signal: "command", start: assignmentPrefixed.lastIndexOf("run-bot"), target: "run-bot" },
  ]);
  const multipleAssignments = "X=$DYNAMIC CONFIG=run-bot bun run run-bot";
  expect(extractShellSyntaxTargets(multipleAssignments, syntaxOptions)).toEqual([
    { signal: "command", start: multipleAssignments.indexOf("run-bot"), target: "run-bot" },
    { signal: "command", start: multipleAssignments.indexOf("bun"), target: "bun" },
    {
      signal: "command",
      start: multipleAssignments.indexOf("run", multipleAssignments.indexOf("bun")),
      target: "run",
    },
    { signal: "command", start: multipleAssignments.lastIndexOf("run-bot"), target: "run-bot" },
  ]);
  expect(extractShellSyntaxTargets("X=$DYNAMIC", syntaxOptions)).toEqual([]);
  expect(extractShellSyntaxTargets('if [ -n "$VALUE" ]; then', syntaxOptions)).toEqual([]);
  expect(
    extractShellSyntaxTargets("CONFIG=run-bot bun run", syntaxOptions).map((target) => target.target),
  ).toEqual(["run-bot", "bun", "run"]);
  expect(extractShellSyntaxTargets('X="\'value" bun', syntaxOptions)).toHaveLength(2);
  expect(extractShellSyntaxTargets(String.raw`X='\value' bun`, syntaxOptions)).toHaveLength(2);
  for (const fragment of [
    'if [ -n "$VALUE" ]; then bun run run-bot; fi',
    "for value in one; do bun run run-bot; done",
    "case value in one) bun run run-bot ;; esac",
    "{ bun run run-bot; }",
    "1X=value bun run run-bot",
    "X=`value bun",
    "X='broken bun",
  ]) {
    expect(() => extractShellSyntaxTargets(fragment, syntaxOptions)).toThrow(Error);
  }
});

test("shell command-substitution reads are inert only without a command tail", () => {
  expect(extractShellSyntaxTargets("$(<fixture)", syntaxOptions)).toEqual([]);
  for (const fragment of ["X=$(<fixture) bun run run-bot", "$(<fixture) bun run run-bot"]) {
    expect(extractShellSyntaxTargets(fragment, syntaxOptions)).toEqual([
      { signal: "command", start: fragment.indexOf("bun"), target: "bun" },
      { signal: "command", start: fragment.indexOf("run", fragment.indexOf("bun")), target: "run" },
      { signal: "command", start: fragment.lastIndexOf("run-bot"), target: "run-bot" },
    ]);
  }
  for (const fragment of [
    "$(<fixture)bun run run-bot",
    "$(<fixture bun run run-bot",
    "$(<fi$xture) bun run run-bot",
    "X=$(date) bun run run-bot",
  ]) {
    expect(() => extractShellSyntaxTargets(fragment, syntaxOptions)).toThrow(Error);
  }
});

test("YAML syntax supports commands and paths, then rejects ambiguous grammar", () => {
  const yaml = [
    "jobs:",
    "  run: 'bun run run-bot'",
    "  config: run-bot/config.toml",
    "  commands:",
    "    - bun run scripts/install-mm-bot.sh",
  ].join("\n");
  expect(extractYamlSyntaxTargets(yaml, syntaxOptions)).toEqual([
    { signal: "command", start: 13, target: "bun" },
    { signal: "command", start: 17, target: "run" },
    { signal: "command", start: 21, target: "run-bot" },
    { signal: "config-reference", start: 41, target: "run-bot/config.toml" },
    { signal: "command", start: 79, target: "bun" },
    { signal: "command", start: 83, target: "run" },
    { signal: "command", start: 87, target: "scripts/install-mm-bot.sh" },
  ]);
  for (const yamlValue of [
    "run:\n  -",
    "run:    ",
    "run: |",
    "run: [bun]",
    "run: { command: bun }",
    "run: 'broken",
  ]) {
    expect(() => extractYamlSyntaxTargets(yamlValue, syntaxOptions)).toThrow(Error);
  }
  expect(() => extractYamlSyntaxTargets("\trun: bun", syntaxOptions)).toThrow(Error);
  expect(extractYamlSyntaxTargets("\ninvalid mapping\nkey: value", syntaxOptions)).toEqual([]);
  expect(extractYamlSyntaxTargets(": value\nkey:value\nother:\n  invalid", syntaxOptions)).toEqual([]);
  expect(extractYamlSyntaxTargets('run: "bun run run-bot"', syntaxOptions)).toEqual([
    { signal: "command", start: 5, target: "bun" },
    { signal: "command", start: 9, target: "run" },
    { signal: "command", start: 13, target: "run-bot" },
  ]);
  expect(extractYamlSyntaxTargets("commands:\n  - bun\nnext: value", syntaxOptions)).toEqual([
    { signal: "command", start: 14, target: "bun" },
  ]);
  expect(() => extractYamlSyntaxTargets("run:\n  unsupported grammar", syntaxOptions)).toThrow(Error);
});
