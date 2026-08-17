import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const baselineCommit = "2c4e6f3fc103c9c2f2a49fe9bdaf9cac84e02f8a";
const baselineFiles = [
  "packages/backtest/src/engine.test.ts",
  "packages/backtest/src/engine-helpers.test.ts",
  "packages/backtest/src/engine-windowing.test.ts",
  "packages/backtest/src/engine-precomputed-indicators.test.ts",
];
const currentFiles = [
  ...baselineFiles,
  "packages/backtest/src/engine-confidence.test.ts",
  "packages/backtest/src/engine-execution-outcomes.test.ts",
  "packages/backtest/src/engine-strategy-callbacks.test.ts",
];

function fail(message) {
  throw new Error(message);
}

function rejectSelector(message, exitCode) {
  console.error(message);
  process.exit(exitCode);
}

function baselineSource(file) {
  const result = spawnSync("git", ["show", `${baselineCommit}:${file}`], { encoding: "utf8" });
  if (result.status !== 0) {
    fail(`Cannot read baseline source: ${file}`);
  }
  return result.stdout;
}

function testNames(source, file) {
  const names = [];
  for (const [offset, line] of source.split("\n").entries()) {
    if (!/^\s*(?:it|test)\s*\(/.test(line)) {
      continue;
    }
    const literal = /^\s*(?:it|test)\s*\(\s*"((?:\\.|[^"\\])*)"/.exec(line);
    if (literal === null) {
      fail(`Unsupported dynamic test name at ${file}:${offset + 1}`);
    }
    names.push(literal[1]);
  }
  if (names.length === 0) {
    fail(`No literal test names found in declared scope file: ${file}`);
  }
  return names;
}

function sources(selector) {
  if (selector === "--baseline") {
    return baselineFiles.map((file) => [file, baselineSource(file)]);
  }
  if (selector === "--current") {
    return currentFiles.map((file) => [file, readFileSync(file, "utf8")]);
  }
  fail(`Unexpected validated selector: ${selector}`);
}

const selectors = process.argv.slice(2);
if (selectors.length === 0) {
  rejectSelector("Expected exactly one selector: --baseline or --current.", 64);
}
if (selectors.length > 1) {
  rejectSelector("Expected exactly one selector; extra arguments are forbidden.", 65);
}

const [selector] = selectors;
if (selector !== "--baseline" && selector !== "--current") {
  rejectSelector("Selector must be exactly --baseline or --current.", 66);
}

for (const [file, source] of sources(selector)) {
  for (const name of testNames(source, file)) {
    process.stdout.write(`${name}\n`);
  }
}
