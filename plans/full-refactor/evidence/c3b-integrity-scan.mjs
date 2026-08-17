import { lstatSync, readFileSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repositoryRoot = process.cwd();
const generatedPathPattern =
  /(^|\/)(?:node_modules|coverage|\.turbo|dist|build|data|temp)(?:\/|$)|\.(?:zip|tgz|tar|gz|png|jpg|jpeg|gif|pdf)$/i;
const skipOnlyPattern = /\.(?:skip|only)\s*\(/;
const forbiddenSourcePattern = /\bany\b|\sas\s(?!const\b)|console\./;
const secretRules = [
  ["aws-access-key", /\bAKIA[0-9A-Z]{16}\b/g],
  ["private-key-header", /-----BEGIN(?: [A-Z]+)* PRIVATE KEY-----/g],
  ["github-token", /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g],
  ["slack-token", /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g],
];

class EvidenceError extends Error {
  constructor(message, exitCode) {
    super(message);
    this.exitCode = exitCode;
  }
}

function fail(message, exitCode) {
  throw new EvidenceError(message, exitCode);
}

function parseManifestArgument(arguments_) {
  if (arguments_.length !== 2 || arguments_[0] !== "--manifest") {
    fail("Usage: c3b-integrity-scan.mjs --manifest <repository-relative-path>", 64);
  }
  return arguments_[1];
}

function readManifest(manifestPath) {
  const absolutePath = resolve(repositoryRoot, manifestPath);
  const scopedPath = relative(repositoryRoot, absolutePath);
  if (scopedPath.startsWith("..") || scopedPath === "") {
    fail(`Manifest is unavailable or outside the repository: ${manifestPath}.`, 65);
  }
  const metadata = lstatSyncSafe(absolutePath);
  if (metadata === undefined) {
    fail(`Manifest is unavailable: ${manifestPath}.`, 65);
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    fail(`Manifest must be a regular non-symbolic-link file: ${manifestPath}.`, 66);
  }
  const paths = readTextFile(absolutePath, manifestPath, 65).split("\n").filter(Boolean);
  if (paths.length === 0 || new Set(paths).size !== paths.length) {
    fail("Manifest must contain unique, non-empty paths.", 66);
  }
  return paths.map(validatePath);
}

function lstatSyncSafe(path) {
  try {
    return lstatSync(path);
  } catch {
    return undefined;
  }
}

function validatePath(path) {
  const absolutePath = resolve(repositoryRoot, path);
  const scopedPath = relative(repositoryRoot, absolutePath);
  const metadata = lstatSyncSafe(absolutePath);
  if (
    scopedPath.startsWith("..") ||
    scopedPath === "" ||
    metadata === undefined ||
    !metadata.isFile() ||
    metadata.isSymbolicLink()
  ) {
    fail(`Manifest path is unavailable, outside the repository, or not a regular file: ${path}.`, 67);
  }
  return { absolutePath, path: scopedPath };
}

function readTextFile(path, label, exitCode) {
  const metadata = lstatSyncSafe(path);
  if (metadata === undefined || !metadata.isFile() || metadata.isSymbolicLink()) {
    fail(`Regular file is unavailable before read: ${label}.`, exitCode);
  }
  try {
    return readFileSync(path, "utf8");
  } catch {
    fail(`Regular file cannot be read: ${label}.`, exitCode);
  }
}

function runWhitespaceCheck(files) {
  for (const file of files) {
    const result = spawnSync("git", ["diff", "--no-index", "--check", "/dev/null", file.path], {
      encoding: "utf8",
    });
    if (result.status !== 1 || result.stdout.length > 0 || result.stderr.length > 0) {
      fail(`Whitespace validation failed for ${file.path}.`, 68);
    }
  }
  const result = spawnSync("git", ["diff", "--check", "--", ...files.map((file) => file.path)], {
    encoding: "utf8",
  });
  if (result.status !== 0 || result.stdout.length > 0 || result.stderr.length > 0) {
    fail("Tracked diff whitespace validation failed.", 68);
  }
}

function scanIntegrity(files) {
  let skipOnlyCount = 0;
  let forbiddenSourceCount = 0;
  let generatedBinaryCount = 0;
  let secretCount = 0;
  for (const file of files) {
    const content = readTextFile(file.absolutePath, file.path, 67);
    if (generatedPathPattern.test(file.path) || content.includes("\0")) {
      generatedBinaryCount += 1;
      console.log(`generated-or-binary\t${file.path}\t1`);
    }
    if (skipOnlyPattern.test(content)) {
      skipOnlyCount += 1;
      console.log(`skip-or-only\t${file.path}\t1`);
    }
    if (
      file.path.startsWith("packages/backtest/src/") &&
      !file.path.endsWith(".test.ts") &&
      forbiddenSourcePattern.test(content)
    ) {
      forbiddenSourceCount += 1;
      console.log(`forbidden-source-pattern\t${file.path}\t1`);
    }
    for (const [category, expression] of secretRules) {
      const count = (content.match(expression) ?? []).length;
      if (count > 0) {
        secretCount += count;
        console.log(`${category}\t${file.path}\t${count}`);
      }
    }
  }
  if (skipOnlyCount + forbiddenSourceCount + generatedBinaryCount + secretCount > 0) {
    fail("Integrity scan found one or more violations.", 69);
  }
}

function main() {
  const manifestPath = parseManifestArgument(process.argv.slice(2));
  const files = readManifest(manifestPath);
  runWhitespaceCheck(files);
  scanIntegrity(files);
  console.log(`manifest-files\t${files.length}`);
  console.log("tracked-and-untracked-whitespace\t0");
  console.log("skip-or-only\t0");
  console.log("forbidden-source-pattern\t0");
  console.log("generated-or-binary\t0");
  console.log("secret-material\t0");
}

try {
  main();
} catch (error) {
  if (error instanceof EvidenceError) {
    console.error(error.message);
    process.exit(error.exitCode);
  }
  console.error("Unexpected integrity helper failure.");
  process.exit(70);
}
